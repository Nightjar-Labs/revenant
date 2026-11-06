import type { FeedMeta, Item } from '../types.js';
import { escapeXml, parseDate } from './xml.js';

/** Atom `updated` for entries with an unparseable date, and for empty feeds. */
const EPOCH = '1970-01-01T00:00:00.000Z';

/** ISO 8601 form of an item date; the raw string is kept if it cannot be parsed. */
function isoDate(value: string): string {
  return parseDate(value)?.toISOString() ?? value;
}

function entryXml(item: Item): string {
  const lines = [
    `      <title>${escapeXml(item.title)}</title>`,
    `      <id>${escapeXml(item.guid)}</id>`,
    `      <updated>${escapeXml(isoDate(item.date))}</updated>`,
  ];
  if (item.link !== '') {
    lines.push(`      <link rel="alternate" href="${escapeXml(item.link)}"/>`);
  }
  if (item.content !== undefined) {
    lines.push(`      <content type="html">${escapeXml(item.content)}</content>`);
  }
  return `    <entry>\n${lines.join('\n')}\n    </entry>`;
}

/** Serializes items as an Atom 1.0 document. Pure: output depends only on the arguments. */
export function serializeAtom(items: Item[], meta: FeedMeta): string {
  // Atom requires a feed-level `updated`. The newest entry date keeps the output deterministic
  // (no clock) and stable between runs, so ETags only change when the content does.
  let updated: Date | undefined;
  for (const item of items) {
    const date = parseDate(item.date);
    if (date !== undefined && (updated === undefined || date > updated)) updated = date;
  }

  const feedUrl = meta.feedUrl ?? meta.link;
  const header = [
    `  <title>${escapeXml(meta.title)}</title>`,
    `  <id>${escapeXml(feedUrl)}</id>`,
    `  <updated>${updated?.toISOString() ?? EPOCH}</updated>`,
  ];
  if (meta.link !== '') header.push(`  <link rel="alternate" href="${escapeXml(meta.link)}"/>`);
  if (feedUrl !== '') header.push(`  <link rel="self" href="${escapeXml(feedUrl)}"/>`);

  const body = [...header, ...items.map(entryXml)].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n${body}\n</feed>\n`;
}
