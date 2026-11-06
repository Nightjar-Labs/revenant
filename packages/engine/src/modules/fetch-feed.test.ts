import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isoDateArbitrary } from '../__tests__/arbitraries.js';
import { deriveGuid } from '../types.js';
import type { ExecutionDeps, FetchResult, Item } from '../types.js';
import { definition } from './fetch-feed.js';

const NOW = '2025-01-01T00:00:00.000Z';
const URL_ = 'https://example.com/feed.xml';

const makeDeps = (
  respond: (url: string) => Promise<FetchResult>,
  now: string = NOW,
): { deps: ExecutionDeps; fetch: ReturnType<typeof vi.fn> } => {
  const fetch = vi.fn(respond);
  return {
    fetch,
    deps: { fetcher: { fetch }, clock: { now: () => new Date(now) }, registry: new Map() },
  };
};

const ok = (body: string, status = 200): Promise<FetchResult> =>
  Promise.resolve({ body, status, headers: {} });

const run = async (
  body: string,
  now?: string,
): Promise<{ items: Item[]; fetch: ReturnType<typeof vi.fn> }> => {
  const { deps, fetch } = makeDeps(() => ok(body), now);
  const { out } = await definition.execute({}, definition.configSchema.parse({ url: URL_ }), deps);
  return { items: out, fetch };
};

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Blog</title>
    <item>
      <title>First post</title>
      <link>https://example.com/1</link>
      <guid isPermaLink="false">post-1</guid>
      <pubDate>Mon, 06 Jan 2025 10:00:00 GMT</pubDate>
      <description>Short</description>
      <content:encoded><![CDATA[<p>Full body</p>]]></content:encoded>
    </item>
    <item>
      <title>Second post</title>
      <link>https://example.com/2</link>
      <pubDate>Tue, 07 Jan 2025 10:00:00 +0000</pubDate>
      <description>Only a description</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Blog</title>
  <entry>
    <title type="html">Atom one</title>
    <link rel="self" href="https://example.com/atom/1.atom"/>
    <link rel="alternate" href="https://example.com/atom/1"/>
    <id>urn:uuid:1</id>
    <updated>2025-02-03T04:05:06Z</updated>
    <summary>Summary text</summary>
    <content type="html">Content text</content>
  </entry>
  <entry>
    <title>Atom two</title>
    <link href="https://example.com/atom/2"/>
    <id>urn:uuid:2</id>
    <updated>2025-02-04T04:05:06+02:00</updated>
    <summary>Only summary</summary>
  </entry>
</feed>`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetch-feed', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('fetch-feed');
    expect(definition.category).toBe('sources');
    expect(definition.themedLabel).toBe('Summon (Fetch Feed)');
    expect(definition.plainLabel).toBe('Fetch Feed');
    expect(definition.inputPorts).toEqual([]);
    expect(definition.outputPorts).toEqual(['out']);
  });

  describe('config', () => {
    it.each([
      ['a non-URL', 'not a url'],
      ['a file: URL', 'file:///etc/passwd'],
      ['an ftp: URL', 'ftp://example.com/feed'],
      ['a URL with credentials', 'https://user:secret@example.com/feed'],
    ])('rejects %s', (_label, url) => {
      expect(definition.configSchema.safeParse({ url }).success).toBe(false);
    });

    it('accepts http and https URLs', () => {
      expect(definition.configSchema.safeParse({ url: 'http://example.com/a?b=c' }).success).toBe(
        true,
      );
      expect(definition.configSchema.safeParse({ url: URL_ }).success).toBe(true);
    });
  });

  describe('RSS 2.0', () => {
    it('maps entries to items', async () => {
      const { items, fetch } = await run(RSS);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(URL_);
      expect(items).toEqual([
        {
          title: 'First post',
          link: 'https://example.com/1',
          guid: 'post-1',
          date: '2025-01-06T10:00:00.000Z',
          content: '<p>Full body</p>',
          extra: {},
        },
        {
          title: 'Second post',
          link: 'https://example.com/2',
          // No <guid>: falls back to the link.
          guid: 'https://example.com/2',
          date: '2025-01-07T10:00:00.000Z',
          content: 'Only a description',
          extra: {},
        },
      ]);
    });

    it('returns an empty array for a channel without items', async () => {
      const { items } = await run('<rss version="2.0"><channel><title>x</title></channel></rss>');
      expect(items).toEqual([]);
    });

    it('handles a single item (not wrapped in an array)', async () => {
      const { items } = await run(
        '<rss><channel><item><title>Only</title><link>https://e.com/x</link><pubDate>Mon, 06 Jan 2025 10:00:00 GMT</pubDate></item></channel></rss>',
      );
      expect(items.map((i) => i.title)).toEqual(['Only']);
    });

    it('keeps numeric-looking guids as strings', async () => {
      const { items } = await run(
        '<rss><channel><item><title>n</title><guid>0042</guid><pubDate>Mon, 06 Jan 2025 10:00:00 GMT</pubDate></item></channel></rss>',
      );
      expect(items[0]?.guid).toBe('0042');
    });

    it('falls back to clock.now() when pubDate is missing and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { items } = await run(
        '<rss><channel><item><title>t</title><link>https://e.com/1</link></item></channel></rss>',
        '2030-05-06T07:08:09.000Z',
      );
      expect(items[0]?.date).toBe('2030-05-06T07:08:09.000Z');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('1 item(s)');
    });

    it('falls back to clock.now() when pubDate is unparseable', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { items } = await run(
        '<rss><channel><item><title>t</title><pubDate>yesterday-ish</pubDate></item></channel></rss>',
      );
      expect(items[0]?.date).toBe(NOW);
    });

    it('derives a stable hash guid when there is neither guid nor link', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const body = '<rss><channel><item><title>No ids</title></item></channel></rss>';
      const first = (await run(body)).items[0];
      const second = (await run(body)).items[0];
      expect(first?.guid).toBe(deriveGuid({ title: 'No ids', date: NOW }));
      expect(second?.guid).toBe(first?.guid);
    });
  });

  describe('Atom 1.0', () => {
    it('maps entries to items', async () => {
      const { items } = await run(ATOM);
      expect(items).toEqual([
        {
          title: 'Atom one',
          link: 'https://example.com/atom/1',
          guid: 'urn:uuid:1',
          date: '2025-02-03T04:05:06.000Z',
          content: 'Content text',
          extra: {},
        },
        {
          title: 'Atom two',
          // A link without rel defaults to alternate.
          link: 'https://example.com/atom/2',
          guid: 'urn:uuid:2',
          date: '2025-02-04T02:05:06.000Z',
          content: 'Only summary',
          extra: {},
        },
      ]);
    });

    it('returns an empty array for a feed without entries', async () => {
      const { items } = await run(
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>',
      );
      expect(items).toEqual([]);
    });

    it('uses an empty link when no alternate link exists', async () => {
      const { items } = await run(
        '<feed><entry><title>t</title><id>i</id><updated>2025-01-01T00:00:00Z</updated><link rel="self" href="https://e.com/s"/></entry></feed>',
      );
      expect(items[0]?.link).toBe('');
      expect(items[0]?.guid).toBe('i');
    });

    it('falls back to clock.now() when updated is missing', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { items } = await run('<feed><entry><title>t</title><id>i</id></entry></feed>');
      expect(items[0]?.date).toBe(NOW);
    });
  });

  describe('errors', () => {
    it('throws a descriptive error when the fetch fails, without leaking the URL', async () => {
      const { deps } = makeDeps(() => Promise.reject(new Error('Request timeout')));
      const config = definition.configSchema.parse({
        url: 'https://example.com/feed?token=s3cret',
      });
      const error = await definition.execute({}, config, deps).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('fetch-feed: fetch failed: Request timeout');
      expect((error as Error).message).not.toContain('s3cret');
    });

    it('throws on a non-2xx response', async () => {
      const { deps } = makeDeps(() => ok('Not Found', 404));
      await expect(
        definition.execute({}, definition.configSchema.parse({ url: URL_ }), deps),
      ).rejects.toThrow('fetch-feed: fetch failed: HTTP status 404');
    });

    it.each([
      ['text that is not XML', 'definitely not xml'],
      ['an empty body', ''],
      ['mismatched tags', '<rss><channel></rss>'],
    ])('throws a parsing error for %s', async (_label, body) => {
      await expect(run(body)).rejects.toThrow(/^fetch-feed: invalid XML/);
    });

    it('throws when the XML is neither RSS nor Atom', async () => {
      await expect(run('<html><body>hi</body></html>')).rejects.toThrow(
        'not an RSS 2.0 or Atom 1.0 feed',
      );
    });

    it('throws when an RSS document has no channel', async () => {
      await expect(run('<rss version="2.0"></rss>')).rejects.toThrow('no <channel>');
    });
  });

  describe('properties', () => {
    const wordArbitrary = fc.stringMatching(/^[A-Za-z0-9]{1,20}$/);

    // Property 10: the module fetches exactly once, through the injected fetcher, with config.url
    it('fetches exactly once through the injected fetcher', async () => {
      await fc.assert(
        fc.asyncProperty(fc.webUrl(), async (url) => {
          const { deps, fetch } = makeDeps(() => ok('<rss><channel></channel></rss>'));
          await definition.execute({}, definition.configSchema.parse({ url }), deps);
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(fetch).toHaveBeenCalledWith(url);
        }),
        { numRuns: 100 },
      );
    });

    // Property 9: a missing date is always taken from the injected clock
    it('uses the injected clock for every missing date', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await fc.assert(
        fc.asyncProperty(
          isoDateArbitrary,
          fc.array(wordArbitrary, { maxLength: 10 }),
          async (now, titles) => {
            const body = `<rss><channel>${titles
              .map((t) => `<item><title>${t}</title></item>`)
              .join('')}</channel></rss>`;
            const { items } = await run(body, now);
            expect(items.map((i) => i.date)).toEqual(titles.map(() => now));
          },
        ),
        { numRuns: 100 },
      );
    });

    // Property 3 (source form): one item per entry, in document order, with stable guids
    it('emits one item per RSS entry in order with deterministic guids', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ title: wordArbitrary, guid: wordArbitrary }), { maxLength: 15 }),
          async (entries) => {
            const body = `<rss><channel>${entries
              .map(
                (e) =>
                  `<item><title>${e.title}</title><guid>${e.guid}</guid><pubDate>Mon, 06 Jan 2025 10:00:00 GMT</pubDate></item>`,
              )
              .join('')}</channel></rss>`;
            const first = (await run(body)).items;
            const second = (await run(body)).items;
            expect(first.map((i) => [i.title, i.guid])).toEqual(
              entries.map((e) => [e.title, e.guid]),
            );
            expect(second).toEqual(first);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
