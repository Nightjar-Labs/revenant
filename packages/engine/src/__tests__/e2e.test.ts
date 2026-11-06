import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registerBuiltinModules } from '../modules/index.js';
import { run } from '../runner/run.js';
import { serializeAtom } from '../serializers/atom.js';
import { serializeJsonFeed } from '../serializers/json-feed.js';
import { serializeRss } from '../serializers/rss.js';
import type {
  ExecutionDeps,
  FeedMeta,
  FetchResult,
  Fetcher,
  Item,
  PipelineGraph,
} from '../types.js';
import { validate } from '../dag/validator.js';
import { isNode, parseXml, textOf, toArray } from './feed-parser.js';

const readFixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const FEED_URL = 'https://example.com/feed.xml';
const FEED_XML = readFixture('feed.xml');

const meta: FeedMeta = {
  title: 'JavaScript News',
  link: 'https://example.com/',
  feedUrl: 'https://example.com/h/e2e-javascript-news.xml',
};

/** guids of the five "JavaScript" items in `feed.xml`, newest first. */
const EXPECTED_GUIDS_NEWEST_FIRST = [
  'feed-item-10',
  'feed-item-8',
  'feed-item-5',
  'feed-item-3',
  'feed-item-1',
];

/** Serves the fixture feed for FEED_URL and records every requested URL. */
function mockFetcher(): Fetcher & { requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    fetch(url: string): Promise<FetchResult> {
      requested.push(url);
      if (url !== FEED_URL) return Promise.reject(new Error(`unexpected fetch: ${url}`));
      return Promise.resolve({
        body: FEED_XML,
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      });
    },
  };
}

function makeDeps(fetcher: Fetcher = mockFetcher()): ExecutionDeps {
  return {
    fetcher,
    clock: { now: () => new Date('2025-01-01T00:00:00.000Z') },
    registry: registerBuiltinModules(),
  };
}

function loadPipeline(deps: ExecutionDeps): PipelineGraph {
  const result = validate(
    JSON.parse(readFixture('e2e-pipeline.pipe.json')) as unknown,
    deps.registry,
  );
  if (!result.success)
    throw new Error(`fixture pipeline is invalid: ${JSON.stringify(result.errors)}`);
  return result.graph;
}

/** Core fields every serializer must preserve. */
const coreFields = (item: Item): Pick<Item, 'title' | 'link' | 'guid' | 'date' | 'content'> => ({
  title: item.title,
  link: item.link,
  guid: item.guid,
  date: item.date,
  content: item.content,
});

function parseRssItems(xml: string): Item[] {
  const rss = parseXml(xml)['rss'];
  if (!isNode(rss) || !isNode(rss['channel'])) throw new Error('missing rss/channel');
  return toArray(rss['channel']['item']).map((raw) => {
    if (!isNode(raw)) throw new Error('item is not an element');
    return {
      title: textOf(raw['title']) ?? '',
      link: textOf(raw['link']) ?? '',
      guid: textOf(raw['guid']) ?? '',
      date: new Date(textOf(raw['pubDate']) ?? '').toISOString(),
      content: textOf(raw['description']),
    };
  });
}

function parseAtomItems(xml: string): Item[] {
  const feed = parseXml(xml)['feed'];
  if (!isNode(feed)) throw new Error('missing feed');
  return toArray(feed['entry']).map((raw) => {
    if (!isNode(raw)) throw new Error('entry is not an element');
    const link = isNode(raw['link']) ? raw['link']['@_href'] : undefined;
    return {
      title: textOf(raw['title']) ?? '',
      link: typeof link === 'string' ? link : '',
      guid: textOf(raw['id']) ?? '',
      date: textOf(raw['updated']) ?? '',
      content: textOf(raw['content']),
    };
  });
}

function parseJsonFeedItems(json: string): Item[] {
  const feed = JSON.parse(json) as { items: Record<string, string>[] };
  return feed.items.map((raw) => ({
    title: raw['title'] ?? '',
    link: raw['url'] ?? '',
    guid: raw['id'] ?? '',
    date: raw['date_published'] ?? '',
    content: raw['content_html'],
  }));
}

describe('engine end-to-end: fetch-feed → filter → sort → output', () => {
  it('has a valid fixture pipeline and a fixture feed with 10 items (5 match)', () => {
    const deps = makeDeps();
    const graph = loadPipeline(deps);
    expect(graph.nodes.map((node) => node.type)).toEqual([
      'fetch-feed',
      'filter',
      'sort',
      'output',
    ]);
    expect(FEED_XML.match(/<item>/g)).toHaveLength(10);
  });

  it('filters to the five JavaScript items and sorts them by date, newest first', async () => {
    const fetcher = mockFetcher();
    const deps = makeDeps(fetcher);
    const result = await run(loadPipeline(deps), deps);

    expect(result.success).toBe(true);
    expect(fetcher.requested).toEqual([FEED_URL]);
    expect(result.nodeResults['feed']?.items).toHaveLength(10);
    expect(result.nodeResults['filter']?.items).toHaveLength(5);

    // Req 11.3: the output matches a fixed snapshot of the fixture data.
    expect(result.outputItems).toHaveLength(5);
    expect(result.outputItems.map((item) => item.guid)).toEqual(EXPECTED_GUIDS_NEWEST_FIRST);
    for (const item of result.outputItems) expect(item.title).toContain('JavaScript');

    const times = result.outputItems.map((item) => Date.parse(item.date));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set(times).size).toBe(5);

    expect(result.outputItems[2]).toEqual({
      title: 'Modern JavaScript Bundlers Compared',
      link: 'https://example.com/posts/5',
      guid: 'feed-item-5',
      date: '2025-03-09T18:45:00.000Z',
      content: 'Speed, output size and configuration effort.',
      extra: {},
    });
  });

  it('preserves core fields through RSS, Atom and JSON Feed serialization', async () => {
    const deps = makeDeps();
    const { outputItems } = await run(loadPipeline(deps), deps);
    const expected = outputItems.map(coreFields);

    // Property 14: RSS round-trip. The title with "&" also covers XML escaping.
    expect(parseRssItems(serializeRss(outputItems, meta)).map(coreFields)).toEqual(expected);
    // Property 15: Atom round-trip.
    expect(parseAtomItems(serializeAtom(outputItems, meta)).map(coreFields)).toEqual(expected);
    // Property 16: JSON Feed round-trip.
    expect(parseJsonFeedItems(serializeJsonFeed(outputItems, meta)).map(coreFields)).toEqual(
      expected,
    );

    expect(expected.some((item) => item.title.includes('&'))).toBe(true);
  });

  it('is deterministic: two runs give deeply equal output and identical serializations', async () => {
    // Property 8: same graph, same fetch responses, same clock → same outputItems.
    const first = makeDeps();
    const second = makeDeps();
    const a = await run(loadPipeline(first), first);
    const b = await run(loadPipeline(second), second);

    expect(b.outputItems).toEqual(a.outputItems);
    expect(b.nodeResults).toEqual(a.nodeResults);
    expect(serializeRss(b.outputItems, meta)).toBe(serializeRss(a.outputItems, meta));
    expect(serializeAtom(b.outputItems, meta)).toBe(serializeAtom(a.outputItems, meta));
    expect(serializeJsonFeed(b.outputItems, meta)).toBe(serializeJsonFeed(a.outputItems, meta));

    // The same deps can also be reused for a second run of the same graph.
    const graph = loadPipeline(first);
    const c = await run(graph, first);
    const d = await run(graph, first);
    expect(d.outputItems).toEqual(c.outputItems);
  });
});

describe('integration: real operator modules with a mocked fetcher', () => {
  it('runs fetch-feed → filter → output with the full module registry', async () => {
    const deps = makeDeps();
    const graph: PipelineGraph = {
      meta: { id: 'integration-javascript', name: 'Integration' },
      nodes: [
        {
          id: 'feed',
          type: 'fetch-feed',
          config: { url: FEED_URL },
          position: { x: 0, y: 0 },
        },
        {
          id: 'filter',
          type: 'filter',
          config: {
            mode: 'all',
            rules: [{ field: 'title', op: 'contains', value: 'JavaScript' }],
          },
          position: { x: 200, y: 0 },
        },
        { id: 'output', type: 'output', config: {}, position: { x: 400, y: 0 } },
      ],
      edges: [
        { source: 'feed', sourcePort: 'out', target: 'filter', targetPort: 'items' },
        { source: 'filter', sourcePort: 'out', target: 'output', targetPort: 'items' },
      ],
    };

    // The graph is valid before it is run.
    expect(validate(graph, deps.registry).success).toBe(true);

    const result = await run(graph, deps);

    expect(result.success).toBe(true);
    expect(Object.keys(result.nodeResults).sort()).toEqual(['feed', 'filter', 'output']);
    for (const nodeResult of Object.values(result.nodeResults)) {
      expect(nodeResult.error).toBeUndefined();
    }
    expect(result.nodeResults['feed']?.items).toHaveLength(10);
    expect(result.nodeResults['filter']?.items).toHaveLength(5);
    expect(result.nodeResults['output']?.items).toHaveLength(5);

    expect(result.outputItems).toHaveLength(5);
    for (const item of result.outputItems) expect(item.title).toContain('JavaScript');
    // Without a sort node the filter keeps feed order.
    expect(result.outputItems.map((item) => item.guid)).toEqual([
      'feed-item-1',
      'feed-item-3',
      'feed-item-5',
      'feed-item-8',
      'feed-item-10',
    ]);
  });
});
