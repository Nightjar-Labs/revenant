import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { testDeps } from '../__tests__/deps.js';
import type { Item } from '../types.js';
import { definition } from './reverse.js';

const reverse = async (items: Item[]): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse({}), testDeps)).out;

const item = (n: number): Item => ({
  title: `t${n}`,
  link: `https://example.com/${n}`,
  guid: `g${n}`,
  date: '2025-01-01T00:00:00.000Z',
});

describe('reverse', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('reverse');
    expect(definition.category).toBe('operators');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('reverses a non-empty array', async () => {
    const [a, b, c] = [item(1), item(2), item(3)];
    expect(await reverse([a, b, c])).toEqual([c, b, a]);
  });

  it('returns an empty array for empty input', async () => {
    expect(await reverse([])).toEqual([]);
  });

  it('does not mutate its input', async () => {
    const items = [item(1), item(2)];
    await reverse(items);
    expect(items.map((i) => i.guid)).toEqual(['g1', 'g2']);
  });

  it('accepts an empty config', () => {
    expect(definition.configSchema.safeParse({}).success).toBe(true);
  });

  // Property 7: Reverse is an involution
  it('reverse(reverse(items)) equals items', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArbitrary, async (items) => {
        expect(await reverse(await reverse(items))).toEqual(items);
      }),
      { numRuns: 100 },
    );
  });
});
