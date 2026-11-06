import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { isNode, parseXml, textOf, toArray } from '../__tests__/feed-parser.js';
import type { Item } from '../types.js';
import { serializeAtom } from './atom.js';

const meta = {
  title: 'My Feed',
  link: 'https://example.com/',
  feedUrl: 'https://example.com/h/x.atom',
};

function feedOf(xml: string): Record<string, unknown> {
  const feed = parseXml(xml)['feed'];
  if (!isNode(feed)) throw new Error('missing feed');
  return feed;
}

/** `href` of the link with the given rel. */
function hrefOf(node: Record<string, unknown>, rel: string): string | undefined {
  for (const link of toArray(node['link'])) {
    if (isNode(link) && link['@_rel'] === rel) return String(link['@_href']);
  }
  return undefined;
}

const parseEntries = (xml: string): (Item & { contentType: unknown })[] =>
  toArray(feedOf(xml)['entry']).map((raw) => {
    if (!isNode(raw)) throw new Error('entry is not an element');
    return {
      title: textOf(raw['title']) ?? '',
      link: hrefOf(raw, 'alternate') ?? '',
      guid: textOf(raw['id']) ?? '',
      date: new Date(textOf(raw['updated']) ?? '').toISOString(),
      ...(raw['content'] === undefined ? {} : { content: textOf(raw['content']) ?? '' }),
      contentType: isNode(raw['content']) ? raw['content']['@_type'] : undefined,
    };
  });

describe('serializeAtom', () => {
  it('serializes a single item to Atom 1.0', () => {
    const xml = serializeAtom(
      [
        {
          title: 'Hello',
          link: 'https://example.com/hello',
          guid: 'urn:g-1',
          date: '2025-03-04T05:06:07.000Z',
          content: '<p>Body</p>',
        },
      ],
      meta,
    );

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const feed = feedOf(xml);
    expect(feed['@_xmlns']).toBe('http://www.w3.org/2005/Atom');
    expect(feed['title']).toBe('My Feed');
    expect(feed['id']).toBe('https://example.com/h/x.atom');
    expect(feed['updated']).toBe('2025-03-04T05:06:07.000Z');
    expect(hrefOf(feed, 'alternate')).toBe('https://example.com/');
    expect(hrefOf(feed, 'self')).toBe('https://example.com/h/x.atom');

    const entry = feed['entry'];
    expect(isNode(entry)).toBe(true);
    if (!isNode(entry)) return;
    expect(entry['title']).toBe('Hello');
    expect(entry['id']).toBe('urn:g-1');
    expect(entry['updated']).toBe('2025-03-04T05:06:07.000Z');
    expect(hrefOf(entry, 'alternate')).toBe('https://example.com/hello');
    expect(isNode(entry['content']) && entry['content']['@_type']).toBe('html');
    expect(textOf(entry['content'])).toBe('<p>Body</p>');
  });

  it('serializes an empty array to a valid feed with no entries and a fixed updated date', () => {
    const feed = feedOf(serializeAtom([], meta));
    expect(feed['title']).toBe('My Feed');
    expect(feed['entry']).toBeUndefined();
    expect(feed['updated']).toBe('1970-01-01T00:00:00.000Z');
  });

  it('uses the newest entry date as the feed updated date', () => {
    const items: Item[] = [
      { title: 'a', link: '', guid: 'a', date: '2025-01-01T00:00:00Z' },
      { title: 'b', link: '', guid: 'b', date: '2025-06-01T00:00:00Z' },
      { title: 'c', link: '', guid: 'c', date: '2025-03-01T00:00:00Z' },
    ];
    expect(feedOf(serializeAtom(items, meta))['updated']).toBe('2025-06-01T00:00:00.000Z');
  });

  it('escapes XML special characters in text and attribute values', () => {
    const nasty = `<b>"Tom" & 'Jerry'</b>`;
    const xml = serializeAtom(
      [
        {
          title: nasty,
          link: `https://e.com/?a="1"&b=<2>`,
          guid: nasty,
          date: '2025-01-01T00:00:00Z',
          content: nasty,
        },
      ],
      { title: nasty, link: 'https://e.com/' },
    );

    expect(xml).not.toContain('<b>');
    expect(xml).toContain('href="https://e.com/?a=&quot;1&quot;&amp;b=&lt;2&gt;"');

    const [parsed] = parseEntries(xml);
    expect(parsed?.title).toBe(nasty);
    expect(parsed?.content).toBe(nasty);
    expect(parsed?.guid).toBe(nasty);
    expect(parsed?.link).toBe(`https://e.com/?a="1"&b=<2>`);
    expect(feedOf(xml)['title']).toBe(nasty);
  });

  it('drops characters XML 1.0 cannot represent instead of producing invalid XML', () => {
    const xml = serializeAtom(
      [{ title: 'a\u0000b\u000bc', link: '', guid: 'g', date: '2025-01-01T00:00:00Z' }],
      meta,
    );
    expect(parseEntries(xml)[0]?.title).toBe('abc');
  });

  it('omits the link and content elements when the item has none', () => {
    const xml = serializeAtom(
      [{ title: 't', link: '', guid: 'g', date: '2025-01-01T00:00:00Z' }],
      meta,
    );
    const entry = feedOf(xml)['entry'];
    expect(isNode(entry) && entry['link']).toBe(undefined);
    expect(isNode(entry) && entry['content']).toBe(undefined);
  });

  it('defaults the feed id and self link to meta.link when feedUrl is omitted', () => {
    const feed = feedOf(serializeAtom([], { title: 't', link: 'https://example.com/' }));
    expect(feed['id']).toBe('https://example.com/');
    expect(hrefOf(feed, 'self')).toBe('https://example.com/');
  });

  // Property 15: Atom round-trip preserves core fields
  it('round-trips title, link, guid and date', () => {
    fc.assert(
      fc.property(itemsArbitrary, (items) => {
        const parsed = parseEntries(serializeAtom(items, meta));
        expect(parsed).toHaveLength(items.length);
        items.forEach((item, index) => {
          const p = parsed[index];
          expect(p?.title).toBe(item.title);
          expect(p?.link).toBe(item.link);
          expect(p?.guid).toBe(item.guid);
          expect(p?.content).toBe(item.content);
          expect(p?.date).toBe(new Date(item.date).toISOString());
          if (item.content !== undefined) expect(p?.contentType).toBe('html');
        });
      }),
      { numRuns: 100 },
    );
  });
});
