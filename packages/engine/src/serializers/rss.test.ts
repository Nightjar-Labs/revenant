import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { isNode, parseXml, textOf, toArray } from '../__tests__/feed-parser.js';
import type { Item } from '../types.js';
import { serializeRss } from './rss.js';

const meta = { title: 'My Feed', link: 'https://example.com/' };

function channelOf(xml: string): Record<string, unknown> {
  const rss = parseXml(xml)['rss'];
  if (!isNode(rss) || !isNode(rss['channel'])) throw new Error('missing rss/channel');
  return rss['channel'];
}

const parseItems = (xml: string): Item[] =>
  toArray(channelOf(xml)['item']).map((raw) => {
    if (!isNode(raw)) throw new Error('item is not an element');
    return {
      title: textOf(raw['title']) ?? '',
      link: textOf(raw['link']) ?? '',
      guid: textOf(raw['guid']) ?? '',
      date: new Date(textOf(raw['pubDate']) ?? '').toISOString(),
      ...(raw['description'] === undefined ? {} : { content: textOf(raw['description']) ?? '' }),
    };
  });

describe('serializeRss', () => {
  it('serializes a single item to RSS 2.0', () => {
    const xml = serializeRss(
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
    );

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = parseXml(xml);
    const rss = root['rss'];
    expect(isNode(rss) && rss['@_version']).toBe('2.0');

    const channel = channelOf(xml);
    expect(channel['title']).toBe('My Feed');
    expect(channel['link']).toBe('https://example.com/');

    const item = channel['item'];
    expect(isNode(item)).toBe(true);
    if (!isNode(item)) return;
    expect(item['title']).toBe('Hello');
    expect(item['link']).toBe('https://example.com/hello');
    expect(textOf(item['guid'])).toBe('g-1');
    expect(isNode(item['guid']) && item['guid']['@_isPermaLink']).toBe('false');
    expect(item['pubDate']).toBe('Tue, 04 Mar 2025 05:06:07 GMT');
    expect(item['description']).toBe('<p>Body</p>');
  });

  it('serializes an empty array to a valid channel with no items', () => {
    const channel = channelOf(serializeRss([], meta));
    expect(channel['title']).toBe('My Feed');
    expect(channel['item']).toBeUndefined();
  });

  it('escapes XML special characters in item and feed text', () => {
    const nasty = `<b>"Tom" & 'Jerry'</b> ]]>`;
    const xml = serializeRss(
      [
        {
          title: nasty,
          link: `https://e.com/?a=1&b=2`,
          guid: nasty,
          date: '2025-01-01T00:00:00Z',
          content: nasty,
        },
      ],
      { title: nasty, link: 'https://e.com/' },
    );

    expect(xml).not.toContain('<b>');
    expect(xml).toContain('&lt;b&gt;&quot;Tom&quot; &amp; &apos;Jerry&apos;&lt;/b&gt;');
    expect(xml).toContain('https://e.com/?a=1&amp;b=2');

    const [parsed] = parseItems(xml);
    expect(parsed?.title).toBe(nasty);
    expect(parsed?.content).toBe(nasty);
    expect(parsed?.guid).toBe(nasty);
    expect(channelOf(xml)['title']).toBe(nasty);
  });

  it('drops characters XML 1.0 cannot represent instead of producing invalid XML', () => {
    const xml = serializeRss(
      [{ title: 'a\u0000b\u0008c\ud800d', link: '', guid: 'g', date: '2025-01-01T00:00:00Z' }],
      meta,
    );
    expect(parseItems(xml)[0]?.title).toBe('abcd');
  });

  it('omits description when content is absent and pubDate when the date is unparseable', () => {
    const xml = serializeRss([{ title: 't', link: '', guid: 'g', date: 'not a date' }], meta);
    const item = channelOf(xml)['item'];
    expect(isNode(item) && item['description']).toBe(undefined);
    expect(isNode(item) && item['pubDate']).toBe(undefined);
  });

  it('is deterministic', () => {
    const items: Item[] = [{ title: 't', link: '', guid: 'g', date: '2025-01-01T00:00:00Z' }];
    expect(serializeRss(items, meta)).toBe(serializeRss(items, meta));
  });

  // Property 14: RSS round-trip preserves core fields.
  // pubDate is RFC 2822, which has no milliseconds, so dates are compared to the second.
  it('round-trips title, link, guid and date', () => {
    fc.assert(
      fc.property(itemsArbitrary, (items) => {
        const parsed = parseItems(serializeRss(items, meta));
        expect(parsed).toHaveLength(items.length);
        items.forEach((item, index) => {
          const p = parsed[index];
          expect(p?.title).toBe(item.title);
          expect(p?.link).toBe(item.link);
          expect(p?.guid).toBe(item.guid);
          expect(p?.content).toBe(item.content);
          expect(Date.parse(p?.date ?? '')).toBe(Math.floor(Date.parse(item.date) / 1000) * 1000);
        });
      }),
      { numRuns: 100 },
    );
  });
});
