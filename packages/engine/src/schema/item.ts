import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Item } from '../types.js';

/**
 * Zod schema for the item model every operator consumes and produces (Req 3.1).
 *
 * - `link` is deliberately relaxed (no `.url()`): the guid falls back to a hash when it is empty (Req 3.4).
 * - `date` must be an ISO 8601 date-time string; offsets such as `+02:00` are accepted.
 * - `content` is optional and may be empty.
 * - `extra` is optional on input and coerced to `{}` when absent.
 */
export const ItemSchema = z.object({
  title: z.string(),
  link: z.string(),
  guid: z.string(),
  date: z.iso.datetime({ offset: true }),
  content: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional().default({}),
});

/** Compile-time guarantee that parsed items satisfy the public `Item` interface. */
export const _itemSchemaMatchesItem = (parsed: z.output<typeof ItemSchema>): Item => parsed;

/**
 * Derive a stable GUID for an item (Req 3.4).
 *
 * Priority: the source's own `guid`/`id`, then `link`, then a SHA-1 hex digest of `title + date`.
 * Empty strings count as absent. The result depends only on the input, so it is stable across runs.
 */
export function deriveGuid(item: {
  guid?: string | undefined;
  link?: string | undefined;
  title: string;
  date: string;
}): string {
  if (item.guid) return item.guid;
  if (item.link) return item.link;
  return createHash('sha1')
    .update(item.title + item.date)
    .digest('hex');
}
