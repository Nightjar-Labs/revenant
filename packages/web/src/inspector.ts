import type { Item } from './types.js';

/** Largest number of items rendered in the Ghost Inspector table. */
export const MAX_INSPECTOR_ITEMS = 20;

/** Items to render and how many were left out. */
export function visibleItems(items: readonly Item[]): { shown: Item[]; hidden: number } {
  return {
    shown: items.slice(0, MAX_INSPECTOR_ITEMS),
    hidden: Math.max(0, items.length - MAX_INSPECTOR_ITEMS),
  };
}

/** Formats an ISO date for display; falls back to the raw text when it does not parse. */
export function formatItemDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleString();
}

/**
 * Returns the link only when it is an http(s) URL, so item data from remote feeds can never
 * become a `javascript:` or other scripted href.
 */
export function safeHref(link: string): string | undefined {
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
