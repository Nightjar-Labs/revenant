import { z } from 'zod';
import type { Item, ModuleDefinition } from '../types.js';

export const ReverseConfigSchema = z.object({});

export type ReverseConfig = z.infer<typeof ReverseConfigSchema>;

export const definition: ModuleDefinition<ReverseConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'reverse',
  category: 'operators',
  themedLabel: 'Rewind',
  plainLabel: 'Reverse',
  configSchema: ReverseConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs) {
    return { out: [...inputs.items].reverse() };
  },
};
