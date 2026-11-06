import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Clock, Fetcher, ModuleRegistry } from '@revenant/engine';
import { registerApiRoutes } from './api-routes.js';
import { TtlLruCache } from './cache.js';
import { SystemClock } from './clock.js';
import { SSRFFetcher } from './fetcher.js';
import { registerHauntingRoutes } from './routes.js';
import { PipelineValidationError } from './storage.js';
import type { PipeStorage } from './storage.js';

export interface AppDeps {
  registry: ModuleRegistry;
  storage: PipeStorage;
  /** Network access for pipeline runs. Defaults to the SSRF-safe fetcher; tests inject a mock. */
  fetcher?: Fetcher | undefined;
  /** Time source for pipeline runs. Defaults to the system clock. */
  clock?: Clock | undefined;
  /** Run timeout in milliseconds for `/run` and `/preview`. Default 30 s. */
  runTimeoutMs?: number | undefined;
  /** Extra hook called after a pipeline is changed or deleted, in addition to the cache drop. */
  invalidateHaunting?: ((id: string) => void) | undefined;
  /** Haunting cache. Defaults to a 100-entry LRU; tests inject one with a controllable clock. */
  hauntingCache?: TtlLruCache | undefined;
  /** Haunting cache lifetime in milliseconds. Default 5 minutes. */
  hauntingTtlMs?: number | undefined;
  /** Absolute URL of this server, used for links inside served feeds. */
  publicBaseUrl?: string | undefined;
}

export const DEFAULT_PUBLIC_BASE_URL = 'http://localhost:3000';

/**
 * Builds the Hono app with the API routes and the Haunting routes (`/h/<id>.*`).
 * Dependencies are injected so tests can use temp storage and a mock fetcher.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.get('/api/health', (c) => c.json({ ok: true }));

  const fetcher = deps.fetcher ?? new SSRFFetcher();
  const clock = deps.clock ?? new SystemClock();

  const haunting = registerHauntingRoutes(app, {
    registry: deps.registry,
    storage: deps.storage,
    fetcher,
    clock,
    cache: deps.hauntingCache ?? new TtlLruCache(),
    ttlMs: deps.hauntingTtlMs,
    runTimeoutMs: deps.runTimeoutMs,
    publicBaseUrl: deps.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL,
  });

  registerApiRoutes(app, {
    registry: deps.registry,
    storage: deps.storage,
    fetcher,
    clock,
    runTimeoutMs: deps.runTimeoutMs,
    invalidateHaunting: (id) => {
      haunting.invalidate(id);
      deps.invalidateHaunting?.(id);
    },
  });

  app.onError((err, c) => {
    // Framework errors with their own status, e.g. 413 from the body size limit.
    if (err instanceof HTTPException) {
      return c.json({ error: err.message || 'Request failed' }, err.status);
    }
    // A stored pipeline file that no longer validates is a client-visible data problem, not a crash.
    if (err instanceof PipelineValidationError) {
      return c.json({ error: err.message, errors: err.errors }, 422);
    }
    // Details stay in the server log; responses never echo internals.
    console.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
