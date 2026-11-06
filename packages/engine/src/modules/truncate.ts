import { z } from 'zod';
import type { Item, ModuleDefinition } from '../types.js';

export const TruncateConfigSchema = z.object({
  limit: z.number().int().min(0),
});

export type TruncateConfig = z.infer<typeof TruncateConfigSchema>;

export const definition: ModuleDefinition<TruncateConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'truncate',
  category: 'operators',
  themedLabel: 'Truncate',
  plainLabel: 'Truncate',
  configSchema: TruncateConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs, config) {
    return { out: inputs.items.slice(0, config.limit) };
  },
};
