import { serve } from '@hono/node-server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createModuleRegistry } from './module-registry.js';
import { createPipeStorage } from './storage.js';

const DEFAULT_PORT = 3000;

const registry = createModuleRegistry();
// packages/server/{src,dist} -> repo root, so the default works from any cwd.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = path.resolve(process.env['REVENANT_DATA_DIR'] ?? path.join(repoRoot, 'data/pipes'));
const storage = createPipeStorage(dataDir, registry);
const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
const publicBaseUrl = process.env['REVENANT_PUBLIC_URL'] ?? `http://localhost:${String(port)}`;
const app = createApp({ registry, storage, publicBaseUrl });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`revenant server listening on http://localhost:${info.port}`);
});
