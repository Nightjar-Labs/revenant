import type { FeedMeta, Item } from '../types.js';

export const JSON_FEED_VERSION = 'https://jsonfeed.org/version/1.1';

/** Serializes items as a JSON Feed 1.1 document. Pure: output depends only on the arguments. */
export function serializeJsonFeed(items: Item[], meta: FeedMeta): string {
  const feedUrl = meta.feedUrl ?? meta.link;
  return JSON.stringify({
    version: JSON_FEED_VERSION,
    title: meta.title,
    // Empty URLs are not valid in JSON Feed, so they are omitted.
    ...(meta.link === '' ? {} : { home_page_url: meta.link }),
    ...(feedUrl === '' ? {} : { feed_url: feedUrl }),
    items: items.map((item) => ({
      id: item.guid,
      ...(item.link === '' ? {} : { url: item.link }),
      title: item.title,
      // JSON Feed 1.1 requires content_html or content_text on every item.
      content_html: item.content ?? '',
      date_published: item.date,
    })),
  });
}
