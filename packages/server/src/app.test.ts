import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createModuleRegistry } from './module-registry.js';
import { createPipeStorage } from './storage.js';

describe('createApp', () => {
  it('serves the health route and 404s unknown paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'revenant-app-'));
    try {
      const registry = createModuleRegistry();
      const app = createApp({ registry, storage: createPipeStorage(dir, registry) });
      const health = await app.request('/api/health');
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
      expect((await app.request('/nope')).status).toBe(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
