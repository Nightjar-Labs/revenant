import type { ExecutionDeps } from '../types.js';

/** Deterministic deps for pure operators: the fetcher must never be called. */
export const testDeps: ExecutionDeps = {
  fetcher: {
    fetch: () => Promise.reject(new Error('fetcher must not be called by pure operators')),
  },
  clock: { now: () => new Date('2025-01-01T00:00:00.000Z') },
  registry: new Map(),
};
