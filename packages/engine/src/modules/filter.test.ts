import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemsArbitrary, isoDateArbitrary } from '../__tests__/arbitraries.js';
import { testDeps } from '../__tests__/deps.js';
import { MAX_FIELD_LENGTH } from '../item-field.js';
import type { Item } from '../types.js';
import { definition } from './filter.js';

const filter = async (items: Item[], config: unknown): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse(config), testDeps)).out;

const item = (guid: string, title: string, extra: Partial<Item> = {}): Item => ({
  title,
  link: `https://example.com/${guid}`,
  guid,
  date: '2025-06-15T12:00:00.000Z',
  ...extra,
});

const guids = (items: Item[]): string[] => items.map((i) => i.guid);

const sample = [
  item('1', 'JavaScript tips'),
  item('2', 'Rust news'),
  item('3', 'javascript and rust'),
];

describe('filter', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('filter');
    expect(definition.category).toBe('operators');
    expect(definition.themedLabel).toBe('Banish');
    expect(definition.plainLabel).toBe('Filter');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  describe('ops', () => {
    it('contains is case-sensitive substring match', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'title', op: 'contains', value: 'JavaScript' }],
      });
      expect(guids(out)).toEqual(['1']);
    });

    it('notContains excludes matching items', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'title', op: 'notContains', value: 'Rust' }],
      });
      expect(guids(out)).toEqual(['1', '3']);
    });

    it('equals requires the whole value to match', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'title', op: 'equals', value: 'Rust news' }],
      });
      expect(guids(out)).toEqual(['2']);
    });

    it('regex matches with the default flags', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'title', op: 'regex', value: '^Rust' }],
      });
      expect(guids(out)).toEqual(['2']);
    });

    it('regex honours custom flags', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'title', op: 'regex', value: 'javascript', flags: 'i' }],
      });
      expect(guids(out)).toEqual(['1', '3']);
    });

    it('regex with the g flag matches every item, not every other one', async () => {
      const same = [item('1', 'abc'), item('2', 'abc'), item('3', 'abc')];
      const out = await filter(same, {
        mode: 'all',
        rules: [{ field: 'title', op: 'regex', value: 'abc' }],
      });
      expect(guids(out)).toEqual(['1', '2', '3']);
    });

    it('dateBefore and dateAfter compare against the date field', async () => {
      const items = [
        item('old', 'a', { date: '2024-01-01T00:00:00.000Z' }),
        item('mid', 'b', { date: '2025-06-15T12:00:00.000Z' }),
        item('new', 'c', { date: '2026-01-01T00:00:00.000Z' }),
      ];
      const before = await filter(items, {
        mode: 'all',
        rules: [{ field: 'date', op: 'dateBefore', value: '2025-06-15T12:00:00.000Z' }],
      });
      expect(guids(before)).toEqual(['old']);
      const after = await filter(items, {
        mode: 'all',
        rules: [{ field: 'date', op: 'dateAfter', value: '2025-06-15T12:00:00.000Z' }],
      });
      expect(guids(after)).toEqual(['new']);
    });

    it('date ops never match a field that is not a date', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'title', op: 'dateAfter', value: '2000-01-01' }],
      });
      expect(out).toEqual([]);
    });

    it('reads custom fields from extra', async () => {
      const items = [item('1', 'a', { extra: { tag: 'ghost' } }), item('2', 'b')];
      const out = await filter(items, {
        mode: 'all',
        rules: [{ field: 'tag', op: 'equals', value: 'ghost' }],
      });
      expect(guids(out)).toEqual(['1']);
    });

    it('treats a missing field as an empty string', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'nope', op: 'notContains', value: 'x' }],
      });
      expect(out).toEqual(sample);
    });

    it('does not resolve prototype members as fields', async () => {
      const out = await filter(sample, {
        mode: 'all',
        rules: [{ field: 'constructor', op: 'contains', value: 'Object' }],
      });
      expect(out).toEqual([]);
    });
  });

  describe('mode', () => {
    const rules = [
      { field: 'title', op: 'contains', value: 'JavaScript' },
      { field: 'title', op: 'contains', value: 'Rust' },
    ];

    it("'all' requires every rule to match", async () => {
      const items = [...sample, item('4', 'JavaScript Rust')];
      expect(guids(await filter(items, { mode: 'all', rules }))).toEqual(['4']);
    });

    it("'any' requires at least one rule to match", async () => {
      expect(guids(await filter(sample, { mode: 'any', rules }))).toEqual(['1', '2']);
    });

    it('with no rules, all keeps everything and any keeps nothing', async () => {
      expect(await filter(sample, { mode: 'all', rules: [] })).toEqual(sample);
      expect(await filter(sample, { mode: 'any', rules: [] })).toEqual([]);
    });
  });

  it('keeps input order and returns the same item objects', async () => {
    const out = await filter(sample, {
      mode: 'any',
      rules: [{ field: 'title', op: 'contains', value: 's' }],
    });
    out.forEach((o) => expect(sample).toContain(o));
    expect(guids(out)).toEqual(['1', '2', '3']);
  });

  it('returns an empty array for empty input', async () => {
    expect(
      await filter([], { mode: 'all', rules: [{ field: 'title', op: 'equals', value: 'x' }] }),
    ).toEqual([]);
  });

  describe('config validation', () => {
    const parse = (rule: object) =>
      definition.configSchema.safeParse({ mode: 'all', rules: [rule] });

    it('rejects an invalid regex pattern with the engine error message', () => {
      const result = parse({ field: 'title', op: 'regex', value: '(' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues[0];
        expect(issue?.path).toEqual(['rules', 0, 'value']);
        expect(issue?.message).toMatch(/Invalid regular expression/);
      }
    });

    it('rejects invalid regex flags', () => {
      expect(parse({ field: 'title', op: 'regex', value: 'a', flags: 'zz' }).success).toBe(false);
    });

    it('accepts a valid regex', () => {
      expect(parse({ field: 'title', op: 'regex', value: '^a+$', flags: 'gi' }).success).toBe(true);
    });

    it('does not validate the value as a regex for other ops', () => {
      expect(parse({ field: 'title', op: 'contains', value: '(' }).success).toBe(true);
    });

    it('rejects an unparsable date bound', () => {
      expect(parse({ field: 'date', op: 'dateBefore', value: 'not a date' }).success).toBe(false);
    });

    it('rejects an unknown op and an unknown mode', () => {
      expect(parse({ field: 'title', op: 'startsWith', value: 'a' }).success).toBe(false);
      expect(definition.configSchema.safeParse({ mode: 'none', rules: [] }).success).toBe(false);
    });
  });

  it('only examines the first 64 KB of a field value', async () => {
    const padding = 'a'.repeat(MAX_FIELD_LENGTH);
    const items = [item('late', padding + 'needle'), item('early', 'needle' + padding)];
    const out = await filter(items, {
      mode: 'all',
      rules: [{ field: 'title', op: 'regex', value: 'needle' }],
    });
    expect(guids(out)).toEqual(['early']);
  });

  // Property 6: Filter output is a subset of the input, in input order
  it('every output item is an input item and order is preserved', async () => {
    const ruleArbitrary = fc.oneof(
      fc.record({
        field: fc.constantFrom('title', 'link', 'guid', 'content', 'date'),
        op: fc.constantFrom('contains' as const, 'notContains' as const, 'equals' as const),
        value: fc.string({ maxLength: 3 }),
      }),
      fc.record({
        field: fc.constantFrom('title', 'link', 'guid', 'content'),
        op: fc.constant('regex' as const),
        value: fc.constantFrom('a', '^x', '\\d+', '.*', '[a-c]{2}'),
        flags: fc.constantFrom('g', 'i', 'gi'),
      }),
      fc.record({
        field: fc.constant('date'),
        op: fc.constantFrom('dateBefore' as const, 'dateAfter' as const),
        value: isoDateArbitrary,
      }),
    );
    await fc.assert(
      fc.asyncProperty(
        itemsArbitrary,
        fc.constantFrom('all' as const, 'any' as const),
        fc.array(ruleArbitrary, { maxLength: 4 }),
        async (items, mode, rules) => {
          const out = await filter(items, { mode, rules });
          expect(out.length).toBeLessThanOrEqual(items.length);
          let cursor = 0;
          for (const o of out) {
            while (cursor < items.length && items[cursor] !== o) cursor++;
            expect(cursor).toBeLessThan(items.length);
            cursor++;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
