import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { JSON_FEED_VERSION, serializeJsonFeed } from './json-feed.js';

const meta = {
  title: 'My Feed',
  link: 'https://example.com/',
  feedUrl: 'https://example.com/h/x.json',
};

interface ParsedFeed {
  version: string;
  title: string;
  home_page_url?: string;
  feed_url?: string;
  items: {
    id: string;
    url?: string;
    title: string;
    content_html?: string;
    date_published: string;
  }[];
}

const parse = (json: string): ParsedFeed => JSON.parse(json) as ParsedFeed;

describe('serializeJsonFeed', () => {
  it('serializes a single item to JSON Feed 1.1', () => {
    const feed = parse(
      serializeJsonFeed(
        [
          {
            title: 'Hello',
            link: 'https://example.com/hello',
            guid: 'g-1',
            date: '2025-03-04T05:06:07.000Z',
            content: '<p>Body</p>',
          },
        ],
        meta,
      ),
    );

    expect(feed.version).toBe('https://jsonfeed.org/version/1.1');
    expect(feed.version).toBe(JSON_FEED_VERSION);
    expect(feed.title).toBe('My Feed');
    expect(feed.home_page_url).toBe('https://example.com/');
    expect(feed.feed_url).toBe('https://example.com/h/x.json');
    expect(feed.items).toEqual([
      {
        id: 'g-1',
        url: 'https://example.com/hello',
        title: 'Hello',
        content_html: '<p>Body</p>',
        date_published: '2025-03-04T05:06:07.000Z',
      },
    ]);
  });

  it('serializes an empty array to a valid feed with an empty items array', () => {
    const feed = parse(serializeJsonFeed([], meta));
    expect(feed.items).toEqual([]);
    expect(feed.title).toBe('My Feed');
  });

  it('defaults feed_url to meta.link when feedUrl is omitted', () => {
    const feed = parse(serializeJsonFeed([], { title: 't', link: 'https://example.com/' }));
    expect(feed.feed_url).toBe('https://example.com/');
  });

  it('escapes special characters so the output is valid JSON that parses back unchanged', () => {
    const nasty = `<b>"Tom" & 'Jerry'</b>\n\t\\ \u0000 \u2028`;
    const feed = parse(
      serializeJsonFeed(
        [
          {
            title: nasty,
            link: 'https://e.com/?a=1&b=2',
            guid: nasty,
            date: '2025-01-01T00:00:00Z',
            content: nasty,
          },
        ],
        { title: nasty, link: 'https://e.com/' },
      ),
    );
    expect(feed.title).toBe(nasty);
    expect(feed.items[0]?.title).toBe(nasty);
    expect(feed.items[0]?.id).toBe(nasty);
    expect(feed.items[0]?.content_html).toBe(nasty);
  });

  it('keeps content_html present (required by the spec) and omits empty URLs', () => {
    const feed = parse(
      serializeJsonFeed([{ title: 't', link: '', guid: 'g', date: '2025-01-01T00:00:00Z' }], {
        title: 't',
        link: '',
      }),
    );
    expect(feed.items[0]?.content_html).toBe('');
    expect(feed.items[0]).not.toHaveProperty('url');
    expect(feed).not.toHaveProperty('home_page_url');
    expect(feed).not.toHaveProperty('feed_url');
  });

  // Property 16: JSON Feed round-trip preserves core fields
  it('round-trips title, url, id and date_published', () => {
    fc.assert(
      fc.property(itemsArbitrary, (items) => {
        const feed = parse(serializeJsonFeed(items, meta));
        expect(feed.items).toHaveLength(items.length);
        items.forEach((item, index) => {
          const p = feed.items[index];
          expect(p?.title).toBe(item.title);
          expect(p?.url ?? '').toBe(item.link);
          expect(p?.id).toBe(item.guid);
          expect(p?.date_published).toBe(item.date);
          expect(p?.content_html).toBe(item.content ?? '');
        });
      }),
      { numRuns: 100 },
    );
  });
});
