import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clock, FetchResult, Fetcher, PipelineGraph } from '@revenant/engine';
import { createApp } from '../app.js';
import { TtlLruCache } from '../cache.js';
import { createModuleRegistry } from '../module-registry.js';
import { createPipeStorage } from '../storage.js';
import type { PipeStorage } from '../storage.js';

const FEED_URL = 'https://example.com/feed.xml';
const BASE_URL = 'https://revenant.test';

const feedWith = (titles: string[]): string =>
  `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Upstream</title><link>https://example.com</link>
${titles
  .map(
    (t, i) =>
      `<item><title>${t}</title><link>https://example.com/${String(i)}</link><guid>g${String(i)}</guid><pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>`,
  )
  .join('\n')}
</channel></rss>`;

const fixedClock: Clock = { now: () => new Date('2024-06-01T00:00:00.000Z') };

const pipeGraph = (id: string, middle?: string): PipelineGraph => ({
  nodes: [
    { id: 'src', type: 'fetch-feed', config: { url: FEED_URL }, position: { x: 0, y: 0 } },
    ...(middle === undefined
      ? []
      : [{ id: 'mid', type: middle, config: {}, position: { x: 100, y: 0 } }]),
    { id: 'out', type: 'output', config: {}, position: { x: 200, y: 0 } },
  ],
  edges:
    middle === undefined
      ? [{ source: 'src', sourcePort: 'out', target: 'out', targetPort: 'items' }]
      : [
          { source: 'src', sourcePort: 'out', target: 'mid', targetPort: 'items' },
          { source: 'mid', sourcePort: 'out', target: 'out', targetPort: 'items' },
        ],
  meta: { id, name: `Pipe ${id}` },
});

describe('Haunting routes', () => {
  let dir: string;
  let storage: PipeStorage;
  let clock: { t: number };
  let feed: string;
  let fetchCount: number;
  let fetchImpl: () => Promise<FetchResult>;
  let app: ReturnType<typeof createApp>;

  const respond = (): Promise<FetchResult> =>
    Promise.resolve({ body: feed, status: 200, headers: {} });

  const fetcher: Fetcher = {
    fetch() {
      fetchCount++;
      return fetchImpl();
    },
  };

  /** Resolves once `fetchCount` reaches `n`, so a test can act while a run is in flight. */
  async function untilFetches(n: number): Promise<void> {
    while (fetchCount < n) await new Promise((resolve) => setTimeout(resolve, 1));
  }

  function build(options: { runTimeoutMs?: number } = {}): void {
    const registry = createModuleRegistry();
    registry.set('boom', {
      type: 'boom',
      category: 'operators',
      themedLabel: 'Boom',
      plainLabel: 'Boom',
      configSchema: z.object({}),
      inputPorts: ['items'],
      outputPorts: ['out'],
      execute() {
        throw new Error('kaboom');
      },
    });
    storage = createPipeStorage(dir, registry);
    app = createApp({
      registry,
      storage,
      fetcher,
      clock: fixedClock,
      runTimeoutMs: options.runTimeoutMs,
      publicBaseUrl: BASE_URL,
      hauntingCache: new TtlLruCache({ now: () => clock.t }),
    });
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'revenant-haunting-'));
    clock = { t: 1_000_000 };
    feed = feedWith(['One', 'Two']);
    fetchCount = 0;
    fetchImpl = respond;
    build();
    await storage.savePipe(pipeGraph('news'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('serving', () => {
    it('returns 200 with an RSS body, ETag and content type', async () => {
      const res = await app.request('/h/news.xml');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/rss+xml');
      expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
      const body = await res.text();
      expect(body).toContain('<rss version="2.0">');
      expect(body).toContain('<title>One</title>');
      expect(body).toContain('<title>Two</title>');
      expect(fetchCount).toBe(1);
    });

    it('serves Atom and JSON Feed from their own URLs', async () => {
      const atom = await app.request('/h/news.atom');
      expect(atom.status).toBe(200);
      expect(atom.headers.get('content-type')).toContain('application/atom+xml');
      expect(await atom.text()).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');

      const json = await app.request('/h/news.json');
      expect(json.status).toBe(200);
      expect(json.headers.get('content-type')).toContain('application/feed+json');
      const doc = (await json.json()) as {
        version: string;
        title: string;
        feed_url: string;
        items: Array<{ title: string }>;
      };
      expect(doc.version).toBe('https://jsonfeed.org/version/1.1');
      expect(doc.title).toBe('Pipe news');
      expect(doc.feed_url).toBe(`${BASE_URL}/h/news.json`);
      expect(doc.items.map((i) => i.title)).toEqual(['One', 'Two']);
    });

    it('builds feed links from the configured base URL, not the request Host', async () => {
      const res = await app.request('http://evil.example/h/news.xml', {
        headers: { host: 'evil.example' },
      });
      const body = await res.text();
      expect(body).toContain(BASE_URL);
      expect(body).not.toContain('evil.example');
    });
  });

  describe('caching and ETag', () => {
    it('answers a matching If-None-Match with 304 and no body, without re-running', async () => {
      const first = await app.request('/h/news.xml');
      const etag = first.headers.get('etag') ?? '';
      const second = await app.request('/h/news.xml', { headers: { 'if-none-match': etag } });
      expect(second.status).toBe(304);
      expect(second.headers.get('etag')).toBe(etag);
      expect(await second.text()).toBe('');
      expect(fetchCount).toBe(1);
    });

    it('accepts weak validators and validator lists', async () => {
      const etag = (await app.request('/h/news.xml')).headers.get('etag') ?? '';
      for (const header of [`W/${etag}`, `"other", ${etag}`, '*']) {
        const res = await app.request('/h/news.xml', { headers: { 'if-none-match': header } });
        expect(res.status).toBe(304);
      }
    });

    it('returns 200 when If-None-Match does not match', async () => {
      await app.request('/h/news.xml');
      const res = await app.request('/h/news.xml', { headers: { 'if-none-match': '"nope"' } });
      expect(res.status).toBe(200);
    });

    it('serves the cached body and ETag within the TTL without re-running', async () => {
      const first = await app.request('/h/news.xml');
      clock.t += 299_000;
      const second = await app.request('/h/news.xml');
      expect(second.headers.get('etag')).toBe(first.headers.get('etag'));
      expect(await second.text()).toBe(await first.text());
      expect(fetchCount).toBe(1);
    });

    it('re-runs after the TTL expires and returns a new ETag when the content changed', async () => {
      const first = await app.request('/h/news.xml');
      const oldEtag = first.headers.get('etag') ?? '';
      feed = feedWith(['One', 'Two', 'Three']);
      clock.t += 300_001;

      const res = await app.request('/h/news.xml', { headers: { 'if-none-match': oldEtag } });
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).not.toBe(oldEtag);
      expect(await res.text()).toContain('<title>Three</title>');
      expect(fetchCount).toBe(2);
    });

    it('keeps the same ETag after a re-run that produces identical content', async () => {
      const first = await app.request('/h/news.xml');
      clock.t += 300_001;
      const second = await app.request('/h/news.xml', {
        headers: { 'if-none-match': first.headers.get('etag') ?? '' },
      });
      expect(second.status).toBe(304);
      expect(fetchCount).toBe(2);
    });

    it('caches each format separately', async () => {
      await app.request('/h/news.xml');
      await app.request('/h/news.atom');
      await app.request('/h/news.xml');
      await app.request('/h/news.atom');
      expect(fetchCount).toBe(2);
    });

    it('drops the cache when the pipeline is updated through the API', async () => {
      const first = await app.request('/h/news.xml');
      const put = await app.request('/api/pipes/news', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pipeGraph('news', 'reverse')),
      });
      expect(put.status).toBe(200);
      const second = await app.request('/h/news.xml');
      expect(fetchCount).toBe(2);
      expect(second.headers.get('etag')).not.toBe(first.headers.get('etag'));
    });

    it('does not cache a result computed before the pipeline was updated', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fetchImpl = async () => {
        await gate;
        return respond();
      };
      const inFlight = app.request('/h/news.xml');
      await untilFetches(1);
      const put = await app.request('/api/pipes/news', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pipeGraph('news')),
      });
      expect(put.status).toBe(200);
      release();
      expect((await inFlight).status).toBe(200);

      fetchImpl = respond;
      await app.request('/h/news.xml');
      expect(fetchCount).toBe(2);
    });
  });

  describe('single-flight', () => {
    // Property 23: concurrent requests share one execution
    it('runs the pipeline once for concurrent requests and gives all the same result', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fetchImpl = async () => {
        await gate;
        return respond();
      };

      const requests = Array.from({ length: 5 }, () => app.request('/h/news.xml'));
      await untilFetches(1);
      await new Promise((resolve) => setImmediate(resolve));
      release();
      const responses = await Promise.all(requests);

      expect(fetchCount).toBe(1);
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      const bodies = await Promise.all(responses.map((r) => r.text()));
      expect(new Set(bodies).size).toBe(1);
      expect(new Set(responses.map((r) => r.headers.get('etag'))).size).toBe(1);
    });

    it('shares a failure between concurrent requests and retries on the next one', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fetchImpl = async () => {
        await gate;
        throw new Error('Request timeout');
      };
      const requests = Array.from({ length: 3 }, () => app.request('/h/news.xml'));
      await untilFetches(1);
      await new Promise((resolve) => setImmediate(resolve));
      release();
      const responses = await Promise.all(requests);
      expect(responses.map((r) => r.status)).toEqual([502, 502, 502]);
      expect(fetchCount).toBe(1);

      fetchImpl = respond;
      expect((await app.request('/h/news.xml')).status).toBe(200);
      expect(fetchCount).toBe(2);
    });
  });

  describe('errors', () => {
    it('returns 404 for an unknown pipeline', async () => {
      const res = await app.request('/h/missing.xml');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Pipeline not found' });
    });

    it('returns 404 for unsupported extensions and malformed ids', async () => {
      for (const url of ['/h/news.txt', '/h/news', '/h/News.xml', '/h/..%2Fsecret.xml']) {
        const res = await app.request(url);
        expect(res.status, url).toBe(404);
        expect(await res.json()).toEqual({ error: 'Pipeline not found' });
      }
      expect(fetchCount).toBe(0);
    });

    it('returns 422 when the stored pipeline fails validation', async () => {
      const broken = { ...pipeGraph('broken'), edges: [] };
      broken.nodes = broken.nodes.filter((n) => n.type !== 'output');
      await writeFile(path.join(dir, 'broken.pipe.json'), JSON.stringify(broken), 'utf8');
      const res = await app.request('/h/broken.xml');
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('broken');
      expect(fetchCount).toBe(0);
    });

    it('returns 422 when the stored file is not JSON', async () => {
      await writeFile(path.join(dir, 'junk.pipe.json'), '{nope', 'utf8');
      expect((await app.request('/h/junk.xml')).status).toBe(422);
    });

    it('returns 504 with the timeout message when the run exceeds the limit', async () => {
      build({ runTimeoutMs: 30 });
      fetchImpl = () => new Promise<FetchResult>(() => undefined);
      const res = await app.request('/h/news.xml');
      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({ error: 'Pipeline execution timeout' });
    });

    it('returns 502 when the upstream fetch fails, without caching the failure', async () => {
      fetchImpl = () => Promise.reject(new Error('Request timeout'));
      const res = await app.request('/h/news.xml');
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Upstream fetch failed');
      expect(body.error).toContain('Request timeout');

      fetchImpl = respond;
      const retry = await app.request('/h/news.xml');
      expect(retry.status).toBe(200);
      expect(fetchCount).toBe(2);
    });

    it('returns 502 when the upstream response is not a feed', async () => {
      feed = 'definitely not xml';
      expect((await app.request('/h/news.xml')).status).toBe(502);
    });

    it('returns 500 when a non-source node fails', async () => {
      await storage.savePipe(pipeGraph('broken-op', 'boom'));
      const res = await app.request('/h/broken-op.xml');
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'kaboom' });
    });
  });
});
