import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { testDeps } from '../__tests__/deps.js';
import type { Item } from '../types.js';
import { definition } from './sort.js';

const sort = async (items: Item[], config: unknown): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse(config), testDeps)).out;

const item = (guid: string, title: string, date = '2025-01-01T00:00:00.000Z'): Item => ({
  title,
  link: '',
  guid,
  date,
});

const guids = (items: Item[]): string[] => items.map((i) => i.guid);

/** Tags each item with its input position so stability can be checked even for equal items. */
const withSeq = (items: Item[]): Item[] =>
  items.map((i, seq) => ({ ...i, extra: { ...i.extra, seq } }));
const seqOf = (i: Item): number => i.extra?.['seq'] as number;

describe('sort', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('sort');
    expect(definition.category).toBe('operators');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('rejects an invalid order', () => {
    expect(definition.configSchema.safeParse({ field: 'title', order: 'up' }).success).toBe(false);
  });

  it('sorts strings ascending', async () => {
    const out = await sort([item('1', 'b'), item('2', 'c'), item('3', 'a')], {
      field: 'title',
      order: 'asc',
    });
    expect(guids(out)).toEqual(['3', '1', '2']);
  });

  it('sorts strings descending', async () => {
    const out = await sort([item('1', 'b'), item('2', 'c'), item('3', 'a')], {
      field: 'title',
      order: 'desc',
    });
    expect(guids(out)).toEqual(['2', '1', '3']);
  });

  it('sorts the date field chronologically, including offsets', async () => {
    const items = [
      item('late', 'x', '2025-01-02T00:00:00.000Z'),
      // 2025-01-01T23:00Z, earlier than 'late' although its text sorts after it
      item('early', 'x', '2025-01-02T01:00:00+02:00'),
      item('mid', 'x', '2025-01-02T00:30:00.000Z'),
    ];
    expect(guids(await sort(items, { field: 'date', order: 'asc' }))).toEqual([
      'early',
      'late',
      'mid',
    ]);
    expect(guids(await sort(items, { field: 'date', order: 'desc' }))).toEqual([
      'mid',
      'late',
      'early',
    ]);
  });

  it('sorts numeric extra fields numerically', async () => {
    const items: Item[] = [
      { ...item('a', 't'), extra: { n: 10 } },
      { ...item('b', 't'), extra: { n: 9 } },
      { ...item('c', 't'), extra: { n: 100 } },
    ];
    expect(guids(await sort(items, { field: 'n', order: 'asc' }))).toEqual(['b', 'a', 'c']);
  });

  it('puts items without the field last in both directions', async () => {
    const items: Item[] = [
      item('none', 't'),
      { ...item('b', 't'), extra: { k: 'b' } },
      { ...item('a', 't'), extra: { k: 'a' } },
    ];
    expect(guids(await sort(items, { field: 'k', order: 'asc' }))).toEqual(['a', 'b', 'none']);
    expect(guids(await sort(items, { field: 'k', order: 'desc' }))).toEqual(['b', 'a', 'none']);
  });

  it('keeps input order for equal keys, also when descending', async () => {
    const items = [item('1', 'x'), item('2', 'x'), item('3', 'x')];
    expect(guids(await sort(items, { field: 'title', order: 'asc' }))).toEqual(['1', '2', '3']);
    expect(guids(await sort(items, { field: 'title', order: 'desc' }))).toEqual(['1', '2', '3']);
  });

  it('returns an empty array for empty input', async () => {
    expect(await sort([], { field: 'title', order: 'asc' })).toEqual([]);
  });

  it('does not mutate its input', async () => {
    const items = [item('1', 'b'), item('2', 'a')];
    await sort(items, { field: 'title', order: 'asc' });
    expect(guids(items)).toEqual(['1', '2']);
  });

  const orderArbitrary = fc.constantFrom('asc' as const, 'desc' as const);
  const fieldArbitrary = fc.constantFrom('title', 'guid', 'date', 'content');

  // Property 5: Sort is a permutation (length preserved, each item exactly once)
  it('preserves length and contains each item exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(
        itemsArbitrary,
        fieldArbitrary,
        orderArbitrary,
        async (items, field, order) => {
          const tagged = withSeq(items);
          const out = await sort(tagged, { field, order });
          expect(out.length).toBe(tagged.length);
          expect(out.map(seqOf).sort((a, b) => a - b)).toEqual(tagged.map((_, i) => i));
        },
      ),
      { numRuns: 100 },
    );
  });

  // Property 4 (ordering half): output is correctly ordered
  it('produces correctly ordered output', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArbitrary, orderArbitrary, async (items, order) => {
        const byTitle = await sort(items, { field: 'title', order });
        for (let i = 1; i < byTitle.length; i++) {
          const prev = byTitle[i - 1]?.title ?? '';
          const next = byTitle[i]?.title ?? '';
          expect(order === 'asc' ? prev <= next : prev >= next).toBe(true);
        }
        const byDate = await sort(items, { field: 'date', order });
        for (let i = 1; i < byDate.length; i++) {
          const prev = Date.parse(byDate[i - 1]?.date ?? '');
          const next = Date.parse(byDate[i]?.date ?? '');
          expect(order === 'asc' ? prev <= next : prev >= next).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Property 4: Sort is stable
  it('keeps input order among items with equal keys', async () => {
    // A tiny title alphabet makes equal keys common.
    const collidingItems = fc.array(
      fc.record({ title: fc.constantFrom('a', 'b', 'c') }).map(({ title }) => item('g', title)),
      { maxLength: 30 },
    );
    await fc.assert(
      fc.asyncProperty(collidingItems, orderArbitrary, async (items, order) => {
        const out = await sort(withSeq(items), { field: 'title', order });
        for (let i = 1; i < out.length; i++) {
          const prev = out[i - 1];
          const next = out[i];
          if (prev !== undefined && next !== undefined && prev.title === next.title) {
            expect(seqOf(prev)).toBeLessThan(seqOf(next));
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Sorting already-sorted (stable) output changes nothing
  it('is idempotent', async () => {
    await fc.assert(
      fc.asyncProperty(
        itemsArbitrary,
        fieldArbitrary,
        orderArbitrary,
        async (items, field, order) => {
          const once = await sort(items, { field, order });
          expect(await sort(once, { field, order })).toEqual(once);
        },
      ),
      { numRuns: 100 },
    );
  });
});
