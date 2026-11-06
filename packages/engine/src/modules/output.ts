import { z } from 'zod';
import type { Item, ModuleDefinition } from '../types.js';

export const OutputConfigSchema = z.object({});

export type OutputConfig = z.infer<typeof OutputConfigSchema>;

/**
 * The pipeline's single output node. It is the final aggregation point: the runner
 * and validator identify it by `type === 'output'`, and its items feed the serializers.
 */
export const definition: ModuleDefinition<OutputConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'output',
  category: 'output',
  themedLabel: 'Raise Output',
  plainLabel: 'Output',
  configSchema: OutputConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs) {
    return { out: inputs.items };
  },
};
