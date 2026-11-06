import fc from 'fast-check';
import type { Item } from '../types.js';

/** ISO 8601 UTC date-time strings between 2000 and 2100. */
export const isoDateArbitrary: fc.Arbitrary<string> = fc
  .date({
    min: new Date('2000-01-01T00:00:00.000Z'),
    max: new Date('2100-01-01T00:00:00.000Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

/** Generates valid `ItemSchema` instances. */
export const itemArbitrary: fc.Arbitrary<Item> = fc.record(
  {
    title: fc.string({ maxLength: 80 }),
    link: fc.oneof(fc.webUrl(), fc.constant('')),
    guid: fc.string({ minLength: 1, maxLength: 80 }),
    date: isoDateArbitrary,
    content: fc.string({ maxLength: 200 }),
    // '__proto__' is excluded: zod's record parsing treats it specially, which breaks round-trip checks.
    extra: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 10 }).filter((key) => key !== '__proto__'),
      fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    ),
  },
  { requiredKeys: ['title', 'link', 'guid', 'date'] },
);

/** Arrays of items with reasonable size bounds. */
export const itemsArbitrary: fc.Arbitrary<Item[]> = fc.array(itemArbitrary, { maxLength: 30 });
