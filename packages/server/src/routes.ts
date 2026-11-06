import { createHash } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { run, serializeAtom, serializeJsonFeed, serializeRss } from '@revenant/engine';
import type {
  Clock,
  ExecutionDeps,
  FeedMeta,
  Fetcher,
  Item,
  ModuleRegistry,
  PipelineGraph,
  PipelineRunResult,
} from '@revenant/engine';
import { DEFAULT_RUN_TIMEOUT_MS } from './api-routes.js';
import type { CacheValue, TtlLruCache } from './cache.js';
import { SingleFlight } from './single-flight.js';
import { PipelineValidationError } from './storage.js';
import type { PipeStorage } from './storage.js';

/** How long a rendered Haunting is served without re-running the pipeline (Req 8.4). */
export const DEFAULT_HAUNTING_TTL_MS = 300_000;

export const TIMEOUT_MESSAGE = 'Pipeline execution timeout';

interface FormatSpec {
  contentType: string;
  serialize(items: Item[], meta: FeedMeta): string;
}

/** Keyed by the URL extension: `/h/<id>.xml`, `/h/<id>.atom`, `/h/<id>.json`. */
const FORMATS: Record<string, FormatSpec> = {
  xml: { contentType: 'application/rss+xml; charset=utf-8', serialize: serializeRss },
  atom: { contentType: 'application/atom+xml; charset=utf-8', serialize: serializeAtom },
  json: { contentType: 'application/feed+json; charset=utf-8', serialize: serializeJsonFeed },
};

export const HAUNTING_EXTENSIONS = Object.keys(FORMATS);

const FILE_PATTERN = /^([a-z0-9-]+)\.([a-z]+)$/;

export interface HauntingRouteDeps {
  registry: ModuleRegistry;
  storage: PipeStorage;
  fetcher: Fetcher;
  clock: Clock;
  cache: TtlLruCache;
  /** Cache lifetime in milliseconds. Default 5 minutes. */
  ttlMs?: number | undefined;
  /** Per-run timeout in milliseconds. Default 30 s. */
  runTimeoutMs?: number | undefined;
  /**
   * Absolute URL of this server, used for the links inside served feeds. It is configuration, not
   * taken from the request, so a forged `Host` header cannot end up in a cached body.
   */
  publicBaseUrl: string;
}

export interface HauntingRoutes {
  /** Drops cached output for a pipeline and keeps any run already in flight from refilling it. */
  invalidate(id: string): void;
}

/** A failure that maps to a fixed HTTP status and a client-safe message. */
class HauntingError extends Error {
  constructor(
    readonly status: 404 | 422 | 500 | 502 | 504,
    message: string,
  ) {
    super(message);
    this.name = 'HauntingError';
  }
}

const etagOf = (body: string): string => `"${createHash('sha256').update(body).digest('hex')}"`;

/** True if an `If-None-Match` header value matches `etag` (weak comparison, list and `*` aware). */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((candidate) => {
    const tag = candidate.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag;
  });
}

/**
 * Maps a failed run to an HTTP error (Req 8.5, 12.1). A timeout wins over everything else; a
 * failed source node (fetch or parse of the upstream response) is a 502; anything else is a 500.
 */
function classifyFailure(
  result: PipelineRunResult,
  registry: ModuleRegistry,
  signal: AbortSignal,
): HauntingError {
  if (signal.aborted) return new HauntingError(504, TIMEOUT_MESSAGE);
  for (const nodeResult of Object.values(result.nodeResults)) {
    const error = nodeResult.error;
    if (error === undefined) continue;
    const type = error.nodeType === undefined ? undefined : registry.get(error.nodeType);
    if (type?.category === 'sources') {
      return new HauntingError(502, `Upstream fetch failed: ${error.message}`);
    }
  }
  const first = Object.values(result.nodeResults).find((r) => r.error !== undefined)?.error;
  return new HauntingError(500, first?.message ?? 'Pipeline execution failed');
}

/** Mounts `GET /h/<id>.xml|.atom|.json` with ETag/304 handling, a TTL cache and single-flight. */
export function registerHauntingRoutes(app: Hono, deps: HauntingRouteDeps): HauntingRoutes {
  const { registry, storage, cache } = deps;
  const ttlMs = deps.ttlMs ?? DEFAULT_HAUNTING_TTL_MS;
  const runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  const baseUrl = deps.publicBaseUrl.replace(/\/+$/, '');
  const flights = new SingleFlight<CacheValue>();
  /** Bumped on invalidation; part of the single-flight key and checked before caching a result. */
  const generations = new Map<string, number>();
  const generationOf = (id: string): number => generations.get(id) ?? 0;

  const executionDeps = (): ExecutionDeps => ({
    fetcher: deps.fetcher,
    clock: deps.clock,
    registry,
  });

  async function render(id: string, extension: string, format: FormatSpec): Promise<CacheValue> {
    let graph: PipelineGraph | null;
    try {
      graph = await storage.loadPipe(id);
    } catch (err) {
      if (err instanceof PipelineValidationError) throw new HauntingError(422, err.message);
      throw err;
    }
    if (graph === null) throw new HauntingError(404, 'Pipeline not found');

    const signal = AbortSignal.timeout(runTimeoutMs);
    const result = await run(graph, executionDeps(), signal);
    if (!result.success) throw classifyFailure(result, registry, signal);

    const body = format.serialize(result.outputItems, {
      title: graph.meta.name,
      link: baseUrl,
      feedUrl: `${baseUrl}/h/${id}.${extension}`,
    });
    return { etag: etagOf(body), body };
  }

  function lookup(id: string, extension: string, format: FormatSpec): Promise<CacheValue> {
    const key = `${id}.${extension}`;
    const cached = cache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const generation = generationOf(id);
    return flights.do(`${key}#${String(generation)}`, async () => {
      const value = await render(id, extension, format);
      // Skip caching if the pipeline was changed or deleted while this run was in progress.
      if (generation === generationOf(id)) cache.set(key, value, { ttl: ttlMs });
      return value;
    });
  }

  const errorResponse = (c: Context, error: HauntingError) =>
    c.json({ error: error.message }, error.status);

  app.get('/h/:file', async (c) => {
    const match = FILE_PATTERN.exec(c.req.param('file'));
    const id = match?.[1];
    const extension = match?.[2];
    const format = extension === undefined ? undefined : FORMATS[extension];
    if (id === undefined || extension === undefined || format === undefined) {
      return c.json({ error: 'Pipeline not found' }, 404);
    }

    let value: CacheValue;
    try {
      value = await lookup(id, extension, format);
    } catch (err) {
      if (err instanceof HauntingError) return errorResponse(c, err);
      throw err;
    }

    if (matchesEtag(c.req.header('If-None-Match'), value.etag)) {
      return c.body(null, 304, { ETag: value.etag });
    }
    return c.body(value.body, 200, { 'Content-Type': format.contentType, ETag: value.etag });
  });

  return {
    invalidate(id) {
      generations.set(id, generationOf(id) + 1);
      for (const extension of HAUNTING_EXTENSIONS) cache.invalidate(`${id}.${extension}`);
    },
  };
}
