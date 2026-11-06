import type { Item } from './types.js';

/** Maximum characters of a field value examined by operators (ReDoS mitigation, Req 6.1). */
export const MAX_FIELD_LENGTH = 64 * 1024;

const CORE_FIELDS: ReadonlySet<string> = new Set(['title', 'link', 'guid', 'date', 'content']);

/** True for the fixed `Item` fields; any other name lives in `extra`. */
export function isCoreField(field: string): boolean {
  return CORE_FIELDS.has(field);
}

/**
 * Reads a field by name: core fields come from the item itself, any other name from `extra`.
 * Only own properties are read, so names like `constructor` never resolve to prototype members.
 */
export function getItemField(item: Item, field: string): unknown {
  if (CORE_FIELDS.has(field)) return (item as unknown as Record<string, unknown>)[field];
  const extra = item.extra;
  if (extra !== undefined && Object.hasOwn(extra, field)) return extra[field];
  return undefined;
}

/** Converts a field value to text: missing values become '', objects become JSON. */
export function fieldToString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  return String(value as number | boolean | bigint | symbol);
}
