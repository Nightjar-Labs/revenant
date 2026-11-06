import { z } from 'zod';
import { MAX_FIELD_LENGTH, getItemField, isCoreField } from '../item-field.js';
import type { Item, ModuleDefinition } from '../types.js';

const DEFAULT_FLAGS = 'g';

export const RegexConfigSchema = z
  .object({
    field: z.string().min(1),
    pattern: z.string(),
    replacement: z.string(),
    flags: z.string().default(DEFAULT_FLAGS),
  })
  .superRefine((config, ctx) => {
    try {
      new RegExp(config.pattern, config.flags);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['pattern'],
        message: error instanceof Error ? error.message : 'Invalid regular expression',
      });
    }
  });

export type RegexConfig = z.infer<typeof RegexConfigSchema>;

/** Returns a copy of the item with `field` set to `value`. */
function withField(item: Item, field: string, value: string): Item {
  if (isCoreField(field)) return { ...item, [field]: value };
  return { ...item, extra: { ...item.extra, [field]: value } };
}

export const definition: ModuleDefinition<RegexConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'regex',
  category: 'operators',
  themedLabel: 'Transmute (Regex)',
  plainLabel: 'Regex',
  configSchema: RegexConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs, config) {
    const pattern = new RegExp(config.pattern, config.flags);
    const out = inputs.items.map((item) => {
      const value = getItemField(item, config.field);
      // Only text fields are rewritten; missing and non-string values pass through unchanged.
      if (typeof value !== 'string') return item;
      // Global and sticky regexes keep state between calls; start every item from 0.
      pattern.lastIndex = 0;
      // Only the first 64 KB is matched (ReDoS mitigation); any remainder is kept as is.
      const head = value.slice(0, MAX_FIELD_LENGTH);
      const tail = value.slice(MAX_FIELD_LENGTH);
      return withField(item, config.field, head.replace(pattern, config.replacement) + tail);
    });
    return { out };
  },
};
