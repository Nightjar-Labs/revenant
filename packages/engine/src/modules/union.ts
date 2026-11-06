import { z } from 'zod';
import type { Item, ModuleDefinition } from '../types.js';

export const UnionConfigSchema = z.object({});

export type UnionConfig = z.infer<typeof UnionConfigSchema>;

/** Fixed input ports, in the order their items are concatenated (Req 6.3). */
const INPUT_PORTS = ['in1', 'in2', 'in3', 'in4'] as const;

type UnionInput = Partial<Record<(typeof INPUT_PORTS)[number], Item[]>>;

export const definition: ModuleDefinition<UnionConfig, UnionInput, { out: Item[] }> = {
  type: 'union',
  category: 'operators',
  themedLabel: 'Séance',
  plainLabel: 'Union',
  configSchema: UnionConfigSchema,
  inputPorts: [...INPUT_PORTS],
  outputPorts: ['out'],
  execute(inputs) {
    // No deduplication: use Exorcise (Dedupe) downstream if needed.
    return { out: INPUT_PORTS.flatMap((port) => inputs[port] ?? []) };
  },
};
