import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { HttpUrlSchema, fetchBody, toIsoDate } from '../source-utils.js';
import { ItemSchema, deriveGuid } from '../types.js';
import type { Clock, Item, ModuleDefinition } from '../types.js';

export const FetchFeedConfigSchema = z.object({
  url: HttpUrlSchema,
});

export type FetchFeedConfig = z.infer<typeof FetchFeedConfigSchema>;

const LABEL = 'fetch-feed';

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Keep values such as guid "123" as strings instead of coercing them to numbers.
  parseTagValue: false,
});

const isNode = (value: unknown): value is XmlNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** Text of an element: plain text, or the `#text` of an element that also has attributes. */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isNode(value)) {
    const text = value['#text'];
    return typeof text === 'string' ? text : undefined;
  }
  return undefined;
}

/** First non-empty text among the candidates. */
function firstText(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const text = textOf(candidate);
    if (text !== undefined && text !== '') return text;
  }
  return undefined;
}

/** Fields read from a feed entry before the date fallback and guid derivation. */
interface RawEntry {
  title: string | undefined;
  link: string | undefined;
  guid: string | undefined;
  date: string | undefined;
  content: string | undefined;
}

function rssEntry(item: XmlNode): RawEntry {
  return {
    title: textOf(item['title']),
    link: textOf(item['link']),
    guid: textOf(item['guid']),
    date: textOf(item['pubDate']),
    // `content:encoded` carries the full body when a feed provides both.
    content: firstText(item['content:encoded'], item['description']),
  };
}

/** The `rel="alternate"` link (also the default when `rel` is absent). */
function atomLink(entry: XmlNode): string | undefined {
  for (const link of toArray(entry['link'])) {
    if (!isNode(link)) continue;
    const rel = link['@_rel'];
    const href = link['@_href'];
    if ((rel === undefined || rel === 'alternate') && typeof href === 'string') return href;
  }
  return undefined;
}

function atomEntry(entry: XmlNode): RawEntry {
  return {
    title: textOf(entry['title']),
    link: atomLink(entry),
    guid: textOf(entry['id']),
    date: firstText(entry['updated'], entry['published']),
    // Content with `type="xhtml"` has no text node and falls through to the summary.
    content: firstText(entry['content'], entry['summary']),
  };
}

/** Finds the entry list of an RSS 2.0 or Atom 1.0 document, or throws if it is neither. */
function extractEntries(root: XmlNode): RawEntry[] {
  // An element without children or attributes parses to '' rather than an object, so presence
  // is checked by key. Empty feeds are valid and yield no items.
  if (Object.hasOwn(root, 'rss')) {
    const rss = root['rss'];
    if (!isNode(rss) || !Object.hasOwn(rss, 'channel')) {
      throw new Error(`${LABEL}: RSS feed has no <channel> element`);
    }
    const channel = toArray(rss['channel']).find(isNode);
    return channel === undefined ? [] : toArray(channel['item']).filter(isNode).map(rssEntry);
  }
  if (Object.hasOwn(root, 'feed')) {
    const feed = root['feed'];
    return isNode(feed) ? toArray(feed['entry']).filter(isNode).map(atomEntry) : [];
  }
  throw new Error(`${LABEL}: response is not an RSS 2.0 or Atom 1.0 feed`);
}

function parseFeed(body: string): RawEntry[] {
  const validation = XMLValidator.validate(body);
  if (validation !== true) {
    const { msg, line } = validation.err;
    throw new Error(`${LABEL}: invalid XML at line ${String(line)}: ${msg}`);
  }
  return extractEntries(parser.parse(body) as XmlNode);
}

function toItems(entries: RawEntry[], clock: Clock): Item[] {
  const items: Item[] = [];
  let dateFallbacks = 0;
  let dropped = 0;

  for (const entry of entries) {
    let date = toIsoDate(entry.date);
    if (date === undefined) {
      date = clock.now().toISOString();
      dateFallbacks += 1;
    }
    const title = entry.title ?? '';
    const link = entry.link ?? '';
    const parsed = ItemSchema.safeParse({
      title,
      link,
      guid: deriveGuid({ guid: entry.guid, link, title, date }),
      date,
      ...(entry.content === undefined ? {} : { content: entry.content }),
    });
    if (parsed.success) items.push(parsed.data);
    else dropped += 1;
  }

  // Counts only: feed contents and URLs stay out of the logs.
  if (dateFallbacks > 0) {
    console.warn(
      `${LABEL}: ${String(dateFallbacks)} item(s) had a missing or invalid date; used the current time`,
    );
  }
  if (dropped > 0)
    console.warn(`${LABEL}: dropped ${String(dropped)} item(s) that failed validation`);
  return items;
}

export const definition: ModuleDefinition<
  FetchFeedConfig,
  Record<string, never>,
  { out: Item[] }
> = {
  type: 'fetch-feed',
  category: 'sources',
  themedLabel: 'Summon (Fetch Feed)',
  plainLabel: 'Fetch Feed',
  configSchema: FetchFeedConfigSchema,
  inputPorts: [],
  outputPorts: ['out'],
  async execute(_inputs, config, deps) {
    const body = await fetchBody(deps.fetcher, config.url, LABEL);
    return { out: toItems(parseFeed(body), deps.clock) };
  },
};
