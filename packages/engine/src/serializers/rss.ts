import type { FeedMeta, Item } from '../types.js';
import { escapeXml, parseDate } from './xml.js';

function itemXml(item: Item): string {
  const lines = [
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
  ];
  // RFC 2822 has no sub-second precision, so milliseconds are dropped here.
  const date = parseDate(item.date);
  if (date !== undefined) lines.push(`      <pubDate>${date.toUTCString()}</pubDate>`);
  if (item.content !== undefined) {
    lines.push(`      <description>${escapeXml(item.content)}</description>`);
  }
  return `    <item>\n${lines.join('\n')}\n    </item>`;
}

/** Serializes items as an RSS 2.0 document. Pure: output depends only on the arguments. */
export function serializeRss(items: Item[], meta: FeedMeta): string {
  const header = [
    `    <title>${escapeXml(meta.title)}</title>`,
    `    <link>${escapeXml(meta.link)}</link>`,
    // RSS requires a channel <description>; the feed title is the closest available text.
    `    <description>${escapeXml(meta.title)}</description>`,
  ];
  const body = [...header, ...items.map(itemXml)].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n${body}\n  </channel>\n</rss>\n`;
}
