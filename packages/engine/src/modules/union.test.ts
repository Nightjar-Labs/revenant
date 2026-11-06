import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { testDeps } from '../__tests__/deps.js';
import type { Item } from '../types.js';
import { definition } from './union.js';

type Inputs = Parameters<typeof definition.execute>[0];

const union = async (inputs: Inputs): Promise<Item[]> =>
  (await definition.execute(inputs, definition.configSchema.parse({}), testDeps)).out;

const item = (guid: string): Item => ({
  title: guid,
  link: '',
  guid,
  date: '2025-01-01T00:00:00.000Z',
});

describe('union', () => {
  it('declares its identity and fixed ports', () => {
    expect(definition.type).toBe('union');
    expect(definition.category).toBe('operators');
    expect(definition.themedLabel).toBe('Séance');
    expect(definition.plainLabel).toBe('Union');
    expect(definition.inputPorts).toEqual(['in1', 'in2', 'in3', 'in4']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('concatenates two arrays', async () => {
    const [a, b, c] = [item('a'), item('b'), item('c')];
    expect(await union({ in1: [a, b], in2: [c] })).toEqual([a, b, c]);
  });

  it('handles empty and missing inputs', async () => {
    const a = item('a');
    expect(await union({})).toEqual([]);
    expect(await union({ in1: [], in2: [] })).toEqual([]);
    expect(await union({ in1: [], in2: [a], in3: [] })).toEqual([a]);
  });

  it('orders by port, not by key order in the inputs object', async () => {
    const [a, b, c, d] = [item('a'), item('b'), item('c'), item('d')];
    expect(await union({ in4: [d], in2: [b], in3: [c], in1: [a] })).toEqual([a, b, c, d]);
  });

  it('preserves order within each input and does not deduplicate', async () => {
    const [a, b] = [item('a'), item('b')];
    expect(await union({ in1: [b, a], in2: [a, b] })).toEqual([b, a, a, b]);
  });

  // Property 1: Union length equals the sum of the input lengths
  it('output length is the sum of input lengths', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArbitrary, itemsArbitrary, itemsArbitrary, async (x, y, z) => {
        const out = await union({ in1: x, in2: y, in4: z });
        expect(out.length).toBe(x.length + y.length + z.length);
        expect(out).toEqual([...x, ...y, ...z]);
      }),
      { numRuns: 100 },
    );
  });
});
