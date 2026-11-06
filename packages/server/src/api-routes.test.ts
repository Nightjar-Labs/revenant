import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock, FetchResult, Fetcher, PipelineGraph } from '@revenant/engine';
import { slugify, uniqueSlug } from './api-routes.js';
import { createApp } from './app.js';
import { createModuleRegistry } from './module-registry.js';
import { createPipeStorage } from './storage.js';

const FEED_URL = 'https://example.com/feed.xml';
const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>T</title><link>https://example.com</link>
<item><title>One</title><link>https://example.com/1</link><guid>g1</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
<item><title>Two</title><link>https://example.com/2</link><guid>g2</guid><pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate></item>
</channel></rss>`;

/** Fetcher mock: serves the fixture feed and fails for every other URL. */
const mockFetcher: Fetcher = {
  async fetch(url: string): Promise<FetchResult> {
    if (url === FEED_URL) {
      return { body: RSS, status: 200, headers: { 'content-type': 'application/rss+xml' } };
    }
    throw new Error('Blocked: address is not allowed');
  },
};

const fixedClock: Clock = { now: () => new Date('2024-06-01T00:00:00.000Z') };

function pipeBody(
  name: string,
  url = FEED_URL,
): Omit<PipelineGraph, 'meta'> & {
  meta: { name: string; id?: string };
} {
  return {
    nodes: [
      { id: 'src', type: 'fetch-feed', config: { url }, position: { x: 0, y: 0 } },
      { id: 'out', type: 'output', config: {}, position: { x: 200, y: 0 } },
    ],
    edges: [{ source: 'src', sourcePort: 'out', target: 'out', targetPort: 'items' }],
    meta: { name },
  };
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('API routes', () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let invalidated: string[];

  const fileFor = (id: string) => path.join(dir, `${id}.pipe.json`);
  const fileExists = (id: string) =>
    access(fileFor(id)).then(
      () => true,
      () => false,
    );

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'revenant-api-'));
    const registry = createModuleRegistry();
    invalidated = [];
    app = createApp({
      registry,
      storage: createPipeStorage(dir, registry),
      fetcher: mockFetcher,
      clock: fixedClock,
      invalidateHaunting: (id) => invalidated.push(id),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  describe('GET /api/modules', () => {
    it('lists registered modules with labels, ports and a JSON Schema', async () => {
      const res = await app.request('/api/modules');
      expect(res.status).toBe(200);
      const modules = (await res.json()) as Array<Record<string, unknown>>;
      const types = modules.map((m) => m['type']);
      expect(types).toEqual(expect.arrayContaining(['fetch-feed', 'filter', 'output', 'unique']));

      const feed = modules.find((m) => m['type'] === 'fetch-feed');
      expect(feed).toMatchObject({
        category: 'sources',
        themedLabel: expect.any(String),
        plainLabel: expect.any(String),
        inputPorts: expect.any(Array),
        outputPorts: ['out'],
      });
      const schema = feed?.['configSchema'] as { type?: string; properties?: object };
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('url');
    });
  });

  describe('POST /api/pipes', () => {
    it('creates a pipeline with a slug id, writes the file and returns 201', async () => {
      const res = await app.request('/api/pipes', jsonInit('POST', pipeBody('My Great Pipe!')));
      expect(res.status).toBe(201);
      const created = (await res.json()) as PipelineGraph;
      expect(created.meta).toEqual({ id: 'my-great-pipe', name: 'My Great Pipe!' });
      expect(await fileExists('my-great-pipe')).toBe(true);
      const onDisk = JSON.parse(await readFile(fileFor('my-great-pipe'), 'utf8')) as PipelineGraph;
      expect(onDisk).toEqual(created);
    });

    it('keeps ids unique by suffixing a counter', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/api/pipes', jsonInit('POST', pipeBody('Same Name')));
        expect(res.status).toBe(201);
        ids.push(((await res.json()) as PipelineGraph).meta.id);
      }
      expect(ids).toEqual(['same-name', 'same-name-2', 'same-name-3']);
    });

    it('ignores a client supplied meta.id', async () => {
      const body = pipeBody('Real Name');
      body.meta.id = '../../etc/passwd';
      const res = await app.request('/api/pipes', jsonInit('POST', body));
      expect(res.status).toBe(201);
      expect(((await res.json()) as PipelineGraph).meta.id).toBe('real-name');
    });

    it('returns 422 with validation errors for an invalid config and writes nothing', async () => {
      const res = await app.request('/api/pipes', jsonInit('POST', pipeBody('Bad', 'not a url')));
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; errors: Array<{ message: string }> };
      expect(body.errors.length).toBeGreaterThan(0);
      expect(await app.request('/api/pipes').then((r) => r.json())).toEqual([]);
    });

    it('returns 422 when meta.name is missing', async () => {
      const body = { ...pipeBody('x'), meta: {} };
      const res = await app.request('/api/pipes', jsonInit('POST', body));
      expect(res.status).toBe(422);
    });

    it('returns 400 for a body that is not JSON', async () => {
      const res = await app.request('/api/pipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{nope',
      });
      expect(res.status).toBe(400);
    });

    it('returns 413 for an oversized body', async () => {
      const res = await app.request('/api/pipes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 1) }),
      });
      expect(res.status).toBe(413);
    });
  });

  describe('GET /api/pipes and /api/pipes/:id', () => {
    it('lists id and name, and returns a saved pipeline by id', async () => {
      await app.request('/api/pipes', jsonInit('POST', pipeBody('Alpha')));
      await app.request('/api/pipes', jsonInit('POST', pipeBody('Beta')));

      const list = await app.request('/api/pipes');
      expect(await list.json()).toEqual([
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
      ]);

      const one = await app.request('/api/pipes/alpha');
      expect(one.status).toBe(200);
      expect(((await one.json()) as PipelineGraph).meta.name).toBe('Alpha');
    });

    it('returns 404 for an unknown id and for a path traversal attempt', async () => {
      expect((await app.request('/api/pipes/missing')).status).toBe(404);
      expect((await app.request('/api/pipes/..%2F..%2Fsecret')).status).toBe(404);
    });
  });

  describe('PUT /api/pipes/:id', () => {
    it('overwrites the file, returns 200 and invalidates the Haunting cache', async () => {
      await app.request('/api/pipes', jsonInit('POST', pipeBody('Editable')));

      const updated = pipeBody('Editable Renamed');
      updated.meta.id = 'something-else';
      const res = await app.request('/api/pipes/editable', jsonInit('PUT', updated));
      expect(res.status).toBe(200);
      expect(((await res.json()) as PipelineGraph).meta).toEqual({
        id: 'editable',
        name: 'Editable Renamed',
      });

      const onDisk = JSON.parse(await readFile(fileFor('editable'), 'utf8')) as PipelineGraph;
      expect(onDisk.meta.name).toBe('Editable Renamed');
      expect(await fileExists('something-else')).toBe(false);
      expect(invalidated).toEqual(['editable']);
    });

    it('returns 422 for an invalid pipeline and leaves the file unchanged', async () => {
      await app.request('/api/pipes', jsonInit('POST', pipeBody('Keep Me')));
      const res = await app.request(
        '/api/pipes/keep-me',
        jsonInit('PUT', pipeBody('Keep Me', 'ftp://example.com/x')),
      );
      expect(res.status).toBe(422);
      const onDisk = JSON.parse(await readFile(fileFor('keep-me'), 'utf8')) as PipelineGraph;
      expect(onDisk.nodes[0]?.config).toEqual({ url: FEED_URL });
      expect(invalidated).toEqual([]);
    });

    it('returns 404 and creates no file for an unknown id', async () => {
      const res = await app.request('/api/pipes/ghost', jsonInit('PUT', pipeBody('Ghost')));
      expect(res.status).toBe(404);
      expect(await fileExists('ghost')).toBe(false);
    });
  });

  describe('DELETE /api/pipes/:id', () => {
    it('deletes the file and returns 204', async () => {
      await app.request('/api/pipes', jsonInit('POST', pipeBody('Doomed')));
      const res = await app.request('/api/pipes/doomed', { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(await fileExists('doomed')).toBe(false);
      expect(invalidated).toEqual(['doomed']);
    });

    it('returns 404 for an unknown id', async () => {
      expect((await app.request('/api/pipes/nothing', { method: 'DELETE' })).status).toBe(404);
    });
  });

  describe('POST /api/pipes/:id/run', () => {
    it('runs a saved pipeline with the injected fetcher and returns nodeResults', async () => {
      await app.request('/api/pipes', jsonInit('POST', pipeBody('Runner')));
      const res = await app.request('/api/pipes/runner/run', { method: 'POST' });
      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        success: boolean;
        nodeResults: Record<string, { items: Array<{ title: string }> }>;
        outputItems: Array<{ title: string }>;
      };
      expect(result.success).toBe(true);
      expect(result.nodeResults['src']?.items.map((i) => i.title)).toEqual(['One', 'Two']);
      expect(result.outputItems.map((i) => i.title)).toEqual(['One', 'Two']);
    });

    it('returns 404 for an unknown pipeline', async () => {
      expect((await app.request('/api/pipes/nope/run', { method: 'POST' })).status).toBe(404);
    });

    it('returns 422 when the stored file no longer validates', async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        fileFor('broken'),
        '{"nodes":[],"edges":[],"meta":{"id":"broken","name":"B"}}',
      );
      const res = await app.request('/api/pipes/broken/run', { method: 'POST' });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toContain('broken');
    });

    it('marks nodes as aborted when the run timeout elapses', async () => {
      const registry = createModuleRegistry();
      const slowApp = createApp({
        registry,
        storage: createPipeStorage(dir, registry),
        fetcher: { fetch: () => new Promise<FetchResult>(() => undefined) },
        clock: fixedClock,
        runTimeoutMs: 20,
      });
      await slowApp.request('/api/pipes', jsonInit('POST', pipeBody('Slow')));
      const res = await slowApp.request('/api/pipes/slow/run', { method: 'POST' });
      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        success: boolean;
        nodeResults: Record<string, { error?: { message: string } }>;
      };
      expect(result.success).toBe(false);
      expect(result.nodeResults['src']?.error?.message).toMatch(/abort/i);
    });
  });

  describe('POST /api/pipes/preview', () => {
    it('runs an unsaved pipeline without persisting it', async () => {
      const res = await app.request('/api/pipes/preview', jsonInit('POST', pipeBody('Draft')));
      expect(res.status).toBe(200);
      const result = (await res.json()) as { success: boolean; outputItems: unknown[] };
      expect(result.success).toBe(true);
      expect(result.outputItems).toHaveLength(2);
      expect(await app.request('/api/pipes').then((r) => r.json())).toEqual([]);
    });

    it('returns 200 with success false and the error in nodeResults on a fetch error', async () => {
      const res = await app.request(
        '/api/pipes/preview',
        jsonInit('POST', pipeBody('Draft', 'https://example.com/other.xml')),
      );
      expect(res.status).toBe(200);
      const result = (await res.json()) as {
        success: boolean;
        nodeResults: Record<string, { items: unknown[]; error?: { message: string } }>;
        outputItems: unknown[];
      };
      expect(result.success).toBe(false);
      expect(result.nodeResults['src']?.error?.message).toContain('Blocked');
      expect(result.outputItems).toEqual([]);
    });

    it('returns 422 for an invalid pipeline', async () => {
      const body = {
        ...pipeBody('Draft'),
        edges: [{ source: 'src', sourcePort: 'nope', target: 'out', targetPort: 'items' }],
      };
      const res = await app.request('/api/pipes/preview', jsonInit('POST', body));
      expect(res.status).toBe(422);
      const json = (await res.json()) as { errors: Array<{ message: string }> };
      expect(json.errors.some((e) => e.message.includes('nope'))).toBe(true);
    });

    it('returns 400 for a body that is not JSON', async () => {
      const res = await app.request('/api/pipes/preview', { method: 'POST', body: 'x' });
      expect(res.status).toBe(400);
    });
  });
});

describe('slug helpers', () => {
  it('slugify lowercases, strips accents and collapses separators', () => {
    expect(slugify('  Héllo,  Wörld!! ')).toBe('hello-world');
    expect(slugify('日本語')).toBe('pipe');
    expect(slugify('a'.repeat(100))).toHaveLength(64);
  });

  it('uniqueSlug appends the first free counter', () => {
    expect(uniqueSlug('a', new Set())).toBe('a');
    expect(uniqueSlug('a', new Set(['a', 'a-2']))).toBe('a-3');
    const long = 'x'.repeat(64);
    const result = uniqueSlug(long, new Set([long]));
    expect(result).toHaveLength(64);
    expect(result.endsWith('-2')).toBe(true);
  });
});
