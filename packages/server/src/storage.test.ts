import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineGraph } from '@revenant/engine';
import { createModuleRegistry } from './module-registry.js';
import { PipelineValidationError, createPipeStorage } from './storage.js';
import type { PipeStorage } from './storage.js';

function makeGraph(id: string, name = `Pipe ${id}`): PipelineGraph {
  return {
    nodes: [
      {
        id: 'src',
        type: 'fetch-feed',
        config: { url: 'https://example.com/feed.xml' },
        position: { x: 0, y: 0 },
      },
      { id: 'out', type: 'output', config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [{ source: 'src', sourcePort: 'out', target: 'out', targetPort: 'items' }],
    meta: { id, name },
  };
}

describe('pipe storage', () => {
  let dir: string;
  let storage: PipeStorage;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'revenant-storage-'));
    storage = createPipeStorage(dir, createModuleRegistry());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('savePipe writes a formatted file and loadPipe reads and validates it', async () => {
    const graph = makeGraph('my-pipe');
    await storage.savePipe(graph);

    const text = await readFile(path.join(dir, 'my-pipe.pipe.json'), 'utf8');
    expect(text).toContain('\n  "nodes"');
    expect(await storage.loadPipe('my-pipe')).toEqual(graph);
  });

  it('savePipe creates the directory when it does not exist', async () => {
    const nested = path.join(dir, 'a', 'b');
    const nestedStorage = createPipeStorage(nested, createModuleRegistry());
    await nestedStorage.savePipe(makeGraph('deep'));
    expect(await nestedStorage.loadPipe('deep')).not.toBeNull();
  });

  it('savePipe rejects an invalid pipeline and writes nothing', async () => {
    const bad = makeGraph('bad');
    bad.nodes[0] = { id: 'src', type: 'no-such-module', config: {}, position: { x: 0, y: 0 } };
    await expect(storage.savePipe(bad)).rejects.toBeInstanceOf(PipelineValidationError);
    expect(await storage.listPipes()).toEqual([]);
  });

  it('loadPipe returns null for a non-existent file', async () => {
    expect(await storage.loadPipe('missing')).toBeNull();
  });

  it('loadPipe returns null for ids that are not slugs (no path traversal)', async () => {
    expect(await storage.loadPipe('../outside')).toBeNull();
    expect(await storage.loadPipe('a/b')).toBeNull();
  });

  it('loadPipe throws PipelineValidationError for a corrupt or invalid file', async () => {
    await writeFile(path.join(dir, 'broken.pipe.json'), '{not json', 'utf8');
    await writeFile(path.join(dir, 'invalid.pipe.json'), '{"nodes":[]}', 'utf8');
    await expect(storage.loadPipe('broken')).rejects.toBeInstanceOf(PipelineValidationError);
    await expect(storage.loadPipe('invalid')).rejects.toBeInstanceOf(PipelineValidationError);
  });

  it('listPipes returns id and name of every pipe, skipping other and malformed files', async () => {
    await storage.savePipe(makeGraph('beta', 'Beta'));
    await storage.savePipe(makeGraph('alpha', 'Alpha'));
    await writeFile(path.join(dir, 'notes.txt'), 'ignore me', 'utf8');
    await writeFile(path.join(dir, 'garbage.pipe.json'), '{not json', 'utf8');

    expect(await storage.listPipes()).toEqual([
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
    ]);
  });

  it('listPipes returns an empty array when the directory does not exist', async () => {
    const missing = createPipeStorage(path.join(dir, 'nope'), createModuleRegistry());
    expect(await missing.listPipes()).toEqual([]);
  });

  it('deletePipe removes the file and reports whether anything was deleted', async () => {
    await mkdir(dir, { recursive: true });
    await storage.savePipe(makeGraph('gone'));
    expect(await storage.deletePipe('gone')).toBe(true);
    expect(await storage.loadPipe('gone')).toBeNull();
    expect(await storage.deletePipe('gone')).toBe(false);
    expect(await storage.deletePipe('../x')).toBe(false);
  });
});
