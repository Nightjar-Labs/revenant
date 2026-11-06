import { z } from 'zod';
import { fieldToString, getItemField } from '../item-field.js';
import type { Item, ModuleDefinition } from '../types.js';

export const UniqueConfigSchema = z.object({
  field: z.string().min(1).default('guid'),
});

export type UniqueConfig = z.infer<typeof UniqueConfigSchema>;

export const definition: ModuleDefinition<UniqueConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'unique',
  category: 'operators',
  themedLabel: 'Exorcise',
  plainLabel: 'Dedupe',
  configSchema: UniqueConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs, config) {
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const item of inputs.items) {
      const value = getItemField(item, config.field);
      // An item without the field has no value to compare, so it is always kept.
      if (value === undefined || value === null) {
        out.push(item);
        continue;
      }
      // The type prefix keeps the number 1 and the string '1' distinct.
      const key = `${typeof value}:${fieldToString(value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return { out };
  },
};
