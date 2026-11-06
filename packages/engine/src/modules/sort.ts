import { z } from 'zod';
import { fieldToString, getItemField } from '../item-field.js';
import type { Item, ModuleDefinition } from '../types.js';

export const SortConfigSchema = z.object({
  field: z.string().min(1),
  order: z.enum(['asc', 'desc']),
});

export type SortConfig = z.infer<typeof SortConfigSchema>;

/**
 * Sort key of one item. Kinds rank number < string < missing, and the rank is never flipped by
 * `order`, so items without a usable value always sort last.
 */
type SortKey =
  { kind: 'number'; value: number } | { kind: 'string'; value: string } | { kind: 'missing' };

const RANK = { number: 0, string: 1, missing: 2 } as const;

function sortKey(item: Item, field: string): SortKey {
  const raw = getItemField(item, field);
  if (raw === undefined || raw === null) return { kind: 'missing' };
  if (field === 'date') {
    const time = Date.parse(fieldToString(raw));
    return Number.isNaN(time) ? { kind: 'missing' } : { kind: 'number', value: time };
  }
  if (typeof raw === 'number' && !Number.isNaN(raw)) return { kind: 'number', value: raw };
  return { kind: 'string', value: fieldToString(raw) };
}

/** Ascending comparison. Strings compare by UTF-16 code unit, which is locale independent. */
function compareKeys(a: SortKey, b: SortKey, direction: 1 | -1): number {
  if (a.kind !== b.kind) return RANK[a.kind] - RANK[b.kind];
  if (a.kind === 'missing' || b.kind === 'missing') return 0;
  if (a.value === b.value) return 0;
  return (a.value < b.value ? -1 : 1) * direction;
}

export const definition: ModuleDefinition<SortConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'sort',
  category: 'operators',
  themedLabel: 'Arrange',
  plainLabel: 'Sort',
  configSchema: SortConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs, config) {
    const direction = config.order === 'asc' ? 1 : -1;
    const keyed = inputs.items.map((item) => ({ item, key: sortKey(item, config.field) }));
    // Array.prototype.sort is stable (ES2019), and equal keys compare as 0 in both directions,
    // so equal items keep their input order for 'desc' as well.
    keyed.sort((a, b) => compareKeys(a.key, b.key, direction));
    return { out: keyed.map(({ item }) => item) };
  },
};
