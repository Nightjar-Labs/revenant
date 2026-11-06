import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { run, validate } from '@revenant/engine';
import type {
  Clock,
  ExecutionDeps,
  Fetcher,
  ModuleRegistry,
  PipelineGraph,
  ValidationError,
} from '@revenant/engine';
import { PipelineValidationError } from './storage.js';
import type { PipeStorage } from './storage.js';

/** Per-run timeout for `/run` and `/preview` (Req 12.1 default). */
export const DEFAULT_RUN_TIMEOUT_MS = 30_000;
/** Largest accepted request body. Pipelines are capped at 20 nodes, so this is generous. */
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_SLUG_LENGTH = 64;

export interface ApiRouteDeps {
  registry: ModuleRegistry;
  storage: PipeStorage;
  fetcher: Fetcher;
  clock: Clock;
  /** Run timeout in milliseconds. Default 30 s. */
  runTimeoutMs?: number | undefined;
  /** Called after a pipeline is overwritten so cached Haunting output can be dropped (task 13). */
  invalidateHaunting?: ((id: string) => void) | undefined;
}

/** Turns a pipeline name into a slug: lowercase letters, digits and single hyphens. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'pipe' : slug;
}

/** Returns `base`, or `base-2`, `base-3`, ... until the id is not in `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns a copy of a pipeline body with `meta.id` replaced; non-pipeline bodies pass through. */
function withMetaId(body: unknown, id: string): unknown {
  if (!isRecord(body) || !isRecord(body['meta'])) return body;
  return { ...body, meta: { ...body['meta'], id } };
}

function pipelineName(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body['meta'])) return undefined;
  const name = body['meta']['name'];
  return typeof name === 'string' && name.trim() !== '' ? name : undefined;
}

async function readJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: (await c.req.json()) as unknown };
  } catch {
    return { ok: false };
  }
}

const invalidJson = (c: Context) => c.json({ error: 'Request body must be valid JSON' }, 400);

const invalidPipeline = (c: Context, errors: ValidationError[]) =>
  c.json({ error: 'Pipeline validation failed', errors }, 422);

/** Mounts the pipeline CRUD, run, preview and module-listing routes (Req 9). */
export function registerApiRoutes(app: Hono, deps: ApiRouteDeps): void {
  const { registry, storage } = deps;
  const runTimeoutMs = deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;

  const executionDeps = (): ExecutionDeps => ({
    fetcher: deps.fetcher,
    clock: deps.clock,
    registry,
  });
  const execute = (graph: PipelineGraph) =>
    run(graph, executionDeps(), AbortSignal.timeout(runTimeoutMs));

  app.use('/api/pipes', bodyLimit({ maxSize: MAX_BODY_BYTES }));
  app.use('/api/pipes/*', bodyLimit({ maxSize: MAX_BODY_BYTES }));

  // 9.8
  app.get('/api/modules', (c) =>
    c.json(
      [...registry.values()].map((module) => ({
        type: module.type,
        category: module.category,
        themedLabel: module.themedLabel,
        plainLabel: module.plainLabel,
        inputPorts: module.inputPorts,
        outputPorts: module.outputPorts,
        // `input` describes what an author may write, so defaulted fields are not marked required.
        configSchema: z.toJSONSchema(module.configSchema, { io: 'input', unrepresentable: 'any' }),
      })),
    ),
  );

  // 9.1
  app.get('/api/pipes', async (c) => c.json(await storage.listPipes()));

  // 9.7 (registered before `:id` routes; the method and path shape do not overlap either way)
  app.post('/api/pipes/preview', async (c) => {
    const body = await readJson(c);
    if (!body.ok) return invalidJson(c);
    // A draft may not have a valid slug yet; derive one so only real problems are reported.
    const name = pipelineName(body.value);
    const candidate = name === undefined ? body.value : withMetaId(body.value, slugify(name));
    const result = validate(candidate, registry);
    if (!result.success) return invalidPipeline(c, result.errors);
    return c.json(await execute(result.graph));
  });

  // 9.3
  app.post('/api/pipes', async (c) => {
    const body = await readJson(c);
    if (!body.ok) return invalidJson(c);
    const name = pipelineName(body.value);
    let candidate = body.value;
    if (name !== undefined) {
      const taken = new Set((await storage.listPipes()).map((pipe) => pipe.id));
      candidate = withMetaId(body.value, uniqueSlug(slugify(name), taken));
    }
    const result = validate(candidate, registry);
    if (!result.success) return invalidPipeline(c, result.errors);
    await storage.savePipe(result.graph);
    return c.json(result.graph, 201);
  });

  // 9.2
  app.get('/api/pipes/:id', async (c) => {
    const graph = await storage.loadPipe(c.req.param('id'));
    return graph === null ? c.json({ error: 'Pipeline not found' }, 404) : c.json(graph);
  });

  // 9.4
  app.put('/api/pipes/:id', async (c) => {
    const id = c.req.param('id');
    const body = await readJson(c);
    if (!body.ok) return invalidJson(c);
    // The URL decides which file is written; a mismatching `meta.id` in the body is ignored.
    const result = validate(withMetaId(body.value, id), registry);
    if (!result.success) return invalidPipeline(c, result.errors);
    if (!(await exists(id))) return c.json({ error: 'Pipeline not found' }, 404);
    await storage.savePipe(result.graph);
    deps.invalidateHaunting?.(id);
    return c.json(result.graph);
  });

  // 9.5
  app.delete('/api/pipes/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await storage.deletePipe(id))) return c.json({ error: 'Pipeline not found' }, 404);
    deps.invalidateHaunting?.(id);
    return c.body(null, 204);
  });

  // 9.6
  app.post('/api/pipes/:id/run', async (c) => {
    const graph = await storage.loadPipe(c.req.param('id'));
    if (graph === null) return c.json({ error: 'Pipeline not found' }, 404);
    return c.json(await execute(graph));
  });

  /** True if a file exists for `id`, even if its content no longer validates (so PUT can repair it). */
  async function exists(id: string): Promise<boolean> {
    try {
      return (await storage.loadPipe(id)) !== null;
    } catch (err) {
      if (err instanceof PipelineValidationError) return true;
      throw err;
    }
  }
}
