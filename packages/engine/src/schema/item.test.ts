import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary } from '../__tests__/arbitraries.js';
import { ItemSchema, deriveGuid } from './item.js';

const validItem = {
  title: 'Hello',
  link: 'https://example.com/a',
  guid: 'g-1',
  date: '2025-10-31T12:00:00.000Z',
};

describe('ItemSchema', () => {
  it('accepts an item with only the required fields', () => {
    const result = ItemSchema.safeParse(validItem);
    expect(result.success).toBe(true);
  });

  it.each(['title', 'link', 'guid', 'date'] as const)(
    'rejects an item missing required field %s',
    (field) => {
      const { [field]: _omitted, ...rest } = validItem;
      void _omitted;
      expect(ItemSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('rejects wrongly typed required fields', () => {
    expect(ItemSchema.safeParse({ ...validItem, title: 42 }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...validItem, guid: null }).success).toBe(false);
  });

  it('rejects dates that are not ISO 8601 date-times', () => {
    expect(ItemSchema.safeParse({ ...validItem, date: 'yesterday' }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...validItem, date: '2025-10-31' }).success).toBe(false);
  });

  it('accepts ISO 8601 dates with a UTC offset', () => {
    expect(ItemSchema.safeParse({ ...validItem, date: '2025-10-31T12:00:00+02:00' }).success).toBe(
      true,
    );
  });

  it('accepts an empty link (guid falls back per Req 3.4)', () => {
    expect(ItemSchema.safeParse({ ...validItem, link: '' }).success).toBe(true);
  });

  it('coerces a missing extra to an empty object', () => {
    const parsed = ItemSchema.parse(validItem);
    expect(parsed.extra).toEqual({});
  });

  it('leaves a missing content undefined and keeps an empty content', () => {
    expect(ItemSchema.parse(validItem).content).toBeUndefined();
    expect(ItemSchema.parse({ ...validItem, content: '' }).content).toBe('');
  });

  it('rejects non-string content', () => {
    expect(ItemSchema.safeParse({ ...validItem, content: 5 }).success).toBe(false);
  });

  it('passes extra through unchanged', () => {
    const extra = { author: 'A', tags: ['x', 'y'], nested: { n: 1 } };
    expect(ItemSchema.parse({ ...validItem, extra }).extra).toEqual(extra);
  });

  it('rejects an extra that is not an object', () => {
    expect(ItemSchema.safeParse({ ...validItem, extra: 'nope' }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...validItem, extra: [1] }).success).toBe(false);
  });
});

describe('deriveGuid', () => {
  const base = { title: 'T', date: '2025-10-31T12:00:00.000Z' };

  it('uses the source guid when present', () => {
    expect(deriveGuid({ ...base, guid: 'source-guid', link: 'https://e.com/x' })).toBe(
      'source-guid',
    );
  });

  it('falls back to link when guid is missing', () => {
    expect(deriveGuid({ ...base, link: 'https://e.com/x' })).toBe('https://e.com/x');
  });

  it('treats an empty guid as missing', () => {
    expect(deriveGuid({ ...base, guid: '', link: 'https://e.com/x' })).toBe('https://e.com/x');
  });

  it('falls back to sha1(title + date) when guid and link are missing', () => {
    const expected = createHash('sha1').update('T2025-10-31T12:00:00.000Z').digest('hex');
    expect(deriveGuid(base)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{40}$/);
  });

  it('treats empty guid and empty link as missing', () => {
    expect(deriveGuid({ ...base, guid: '', link: '' })).toBe(deriveGuid(base));
  });

  it('produces different hashes for different titles or dates', () => {
    const a = deriveGuid(base);
    expect(deriveGuid({ ...base, title: 'Other' })).not.toBe(a);
    expect(deriveGuid({ ...base, date: '2025-11-01T00:00:00.000Z' })).not.toBe(a);
  });

  it('is deterministic (property)', () => {
    // Property 8: types support deterministic execution (same input -> same guid, no hidden state)
    fc.assert(
      fc.property(
        fc.record({
          guid: fc.option(fc.string(), { nil: undefined }),
          link: fc.option(fc.string(), { nil: undefined }),
          title: fc.string(),
          date: fc.string(),
        }),
        (input) => {
          expect(deriveGuid(input)).toBe(deriveGuid({ ...input }));
          expect(deriveGuid(input)).not.toBe('');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('shared arbitraries', () => {
  it('itemArbitrary only generates items that ItemSchema accepts and leaves unchanged', () => {
    // Property 8: items are plain serialisable data, so schema round-trips are lossless
    fc.assert(
      fc.property(itemsArbitrary, (items) => {
        for (const item of items) {
          const parsed = ItemSchema.parse(item);
          expect(parsed).toEqual({ ...item, extra: item.extra ?? {} });
        }
      }),
      { numRuns: 100 },
    );
  });
});
