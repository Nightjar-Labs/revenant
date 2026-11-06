import { z } from 'zod';
import { isCoreField } from '../item-field.js';
import type { Item, ModuleDefinition } from '../types.js';

export const RenameConfigSchema = z.object({
  /** Old field name -> new field name. Only fields in `extra` are renamed. */
  map: z.record(z.string().min(1), z.string().min(1)).superRefine((map, ctx) => {
    for (const [from, to] of Object.entries(map)) {
      // A core name in `extra` would be shadowed by the core field when read back.
      if (isCoreField(to)) {
        ctx.addIssue({
          code: 'custom',
          path: [from],
          message: `Cannot rename "${from}" to core field "${to}"`,
        });
      }
    }
  }),
});

export type RenameConfig = z.infer<typeof RenameConfigSchema>;

function renameExtra(
  extra: Record<string, unknown>,
  map: Record<string, string>,
): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  const renamed: [string, unknown][] = [];
  // All renames apply at once, so { a: 'b', b: 'a' } swaps two fields.
  for (const [key, value] of Object.entries(extra)) {
    if (Object.hasOwn(map, key)) {
      const target = map[key];
      if (target !== undefined) renamed.push([target, value]);
    } else {
      entries.push([key, value]);
    }
  }
  // Renamed values come last, so they win over an unmapped field with the same name.
  // fromEntries defines own properties, so a key such as "__proto__" stays plain data.
  return Object.fromEntries([...entries, ...renamed]);
}

export const definition: ModuleDefinition<RenameConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'rename',
  category: 'operators',
  themedLabel: 'Transmute (Rename)',
  plainLabel: 'Rename',
  configSchema: RenameConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs, config) {
    const out = inputs.items.map((item) => {
      // Core fields (title, link, guid, date, content) are never renamed.
      if (item.extra === undefined) return item;
      return { ...item, extra: renameExtra(item.extra, config.map) };
    });
    return { out };
  },
};
