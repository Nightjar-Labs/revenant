import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Clock, Fetcher } from '@revenant/engine';
import { createApp } from '../app.js';
import { TtlLruCache } from '../cache.js';
import { createModuleRegistry } from '../module-registry.js';
import { createPipeStorage } from '../storage.js';

const SEEDED_ID = 'hacker-news-rust-only';
const HN_RSS_URL = 'https://news.ycombinator.com/rss';
const dataDir = fileURLToPath(new URL('../../../../data/pipes', import.meta.url));

const item = (title: string, day: number): string =>
  `<item><title>${title}</title><link>https://example.com/${title.length}-${day}</link>` +
  `<guid>g-${title.length}-${day}</guid><pubDate>Tue, 0${day} Jul 2025 00:00:00 GMT</pubDate></item>`;

/** A Hacker News-shaped feed: two Rust stories in non-chronological order plus noise. */
const HN_FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Hacker News</title><link>https://news.ycombinator.com/</link>
${item('Rust 2.0 released', 1)}
${item('Show HN: a Go web framework', 2)}
${item('Why we rewrote our parser in Rust', 3)}
${item('Python packaging woes', 4)}
</channel></rss>`;

const clock: Clock = { now: () => new Date('2025-07-10T00:00:00.000Z') };

describe('seeded example pipe: hacker-news-rust-only', () => {
  const registry = createModuleRegistry();
  const storage = createPipeStorage(dataDir, registry);

  const requested: string[] = [];
  const fetcher: Fetcher = {
    fetch(url) {
      requested.push(url);
      return Promise.resolve({ body: HN_FEED, status: 200, headers: {} });
    },
  };
  const app = createApp({
    registry,
    storage,
    fetcher,
    clock,
    publicBaseUrl: 'https://revenant.test',
    hauntingCache: new TtlLruCache({ now: () => 0 }),
  });

  it('loads and validates from data/pipes with the expected name', async () => {
    const graph = await storage.loadPipe(SEEDED_ID);
    expect(graph).not.toBeNull();
    expect(graph?.meta).toEqual({ id: SEEDED_ID, name: 'Hacker News — Rust Only' });
    expect(graph?.nodes.map((n) => n.type)).toEqual(['fetch-feed', 'filter', 'sort', 'output']);
  });

  it('is listed by the pipes API', async () => {
    const res = await app.request('/api/pipes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(JSON.stringify(body)).toContain('Hacker News — Rust Only');
  });

  it('serves RSS with only the Rust items, newest first', async () => {
    const res = await app.request(`/h/${SEEDED_ID}.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/rss+xml');
    const body = await res.text();
    expect(requested).toEqual([HN_RSS_URL]);
    const titles = [...body.matchAll(/<item>\s*<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    expect(titles).toEqual(['Why we rewrote our parser in Rust', 'Rust 2.0 released']);
    expect(body).not.toContain('Go web framework');
    expect(body).not.toContain('Python packaging');
  });

  it('serves the same items as JSON Feed', async () => {
    const res = await app.request(`/h/${SEEDED_ID}.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { items: Array<{ title: string }> };
    expect(doc.items.map((i) => i.title)).toEqual([
      'Why we rewrote our parser in Rust',
      'Rust 2.0 released',
    ]);
  });
});

describe('seeded data directory', () => {
  it('lives at <repo>/data/pipes', () => {
    expect(path.basename(path.dirname(dataDir))).toBe('data');
  });
});
