import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { testDeps } from '../__tests__/deps.js';
import type { Item } from '../types.js';
import { definition } from './truncate.js';

const truncate = async (items: Item[], config: unknown): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse(config), testDeps)).out;

const items = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({
    title: `t${i}`,
    link: '',
    guid: `g${i}`,
    date: '2025-01-01T00:00:00.000Z',
  }));

describe('truncate', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('truncate');
    expect(definition.category).toBe('operators');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('truncates to 5', async () => {
    const input = items(8);
    expect(await truncate(input, { limit: 5 })).toEqual(input.slice(0, 5));
  });

  it('returns everything when the limit exceeds the length', async () => {
    const input = items(3);
    expect(await truncate(input, { limit: 10 })).toEqual(input);
  });

  it('returns nothing for limit 0', async () => {
    expect(await truncate(items(3), { limit: 0 })).toEqual([]);
  });

  it('rejects non-integer, negative and missing limits', () => {
    expect(definition.configSchema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(definition.configSchema.safeParse({ limit: -1 }).success).toBe(false);
    expect(definition.configSchema.safeParse({}).success).toBe(false);
  });

  it('returns the first min(limit, length) items in input order', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArbitrary, fc.nat(50), async (input, limit) => {
        const out = await truncate(input, { limit });
        expect(out).toEqual(input.slice(0, Math.min(limit, input.length)));
      }),
      { numRuns: 100 },
    );
  });
});
