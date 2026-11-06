import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { testDeps } from '../__tests__/deps.js';
import type { Item } from '../types.js';
import { definition } from './unique.js';

const unique = async (items: Item[], config: unknown = {}): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse(config), testDeps)).out;

const item = (guid: string, title: string, extra?: Record<string, unknown>): Item => ({
  title,
  link: '',
  guid,
  date: '2025-01-01T00:00:00.000Z',
  ...(extra === undefined ? {} : { extra }),
});

describe('unique', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('unique');
    expect(definition.category).toBe('operators');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('defaults the field to guid', () => {
    expect(definition.configSchema.parse({})).toEqual({ field: 'guid' });
  });

  it('dedupes by guid and keeps the first occurrence', async () => {
    const a = item('1', 'first');
    const b = item('2', 'second');
    const c = item('1', 'third');
    expect(await unique([a, b, c])).toEqual([a, b]);
  });

  it('dedupes by title', async () => {
    const a = item('1', 'same');
    const b = item('2', 'same');
    const c = item('3', 'other');
    expect(await unique([a, b, c], { field: 'title' })).toEqual([a, c]);
  });

  it('dedupes by a field in extra', async () => {
    const a = item('1', 'a', { cat: 'x' });
    const b = item('2', 'b', { cat: 'x' });
    const c = item('3', 'c', { cat: 'y' });
    expect(await unique([a, b, c], { field: 'cat' })).toEqual([a, c]);
  });

  it('keeps items that lack the field', async () => {
    const a = item('1', 'a');
    const b = item('2', 'b');
    expect(await unique([a, b], { field: 'missing' })).toEqual([a, b]);
  });

  it('does not confuse the number 1 with the string "1"', async () => {
    const a = item('1', 'a', { n: 1 });
    const b = item('2', 'b', { n: '1' });
    expect(await unique([a, b], { field: 'n' })).toEqual([a, b]);
  });

  it('returns an empty array for empty input', async () => {
    expect(await unique([])).toEqual([]);
  });

  // Property 2: Unique is idempotent
  it('unique(unique(items)) equals unique(items)', async () => {
    await fc.assert(
      fc.asyncProperty(
        itemsArbitrary,
        fc.constantFrom('guid', 'title', 'link'),
        async (items, field) => {
          const once = await unique(items, { field });
          expect(await unique(once, { field })).toEqual(once);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 3: Unique output is an order-preserving subsequence made of first occurrences
  it('returns the first occurrence of each guid as a subsequence of the input', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArbitrary, async (items) => {
        const out = await unique(items);
        const seen = new Set<string>();
        const expected = items.filter((i) => {
          if (seen.has(i.guid)) return false;
          seen.add(i.guid);
          return true;
        });
        expect(out.length).toBe(expected.length);
        out.forEach((o, index) => expect(o).toBe(expected[index]));

        let cursor = 0;
        for (const o of out) {
          while (cursor < items.length && items[cursor] !== o) cursor++;
          expect(cursor).toBeLessThan(items.length);
          cursor++;
        }
      }),
      { numRuns: 100 },
    );
  });
});
