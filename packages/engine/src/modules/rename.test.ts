import { describe, expect, it } from 'vitest';
import { testDeps } from '../__tests__/deps.js';
import type { Item } from '../types.js';
import { definition } from './rename.js';

const rename = async (items: Item[], config: unknown): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse(config), testDeps)).out;

const item = (extra?: Record<string, unknown>): Item => ({
  title: 'T',
  link: 'https://example.com',
  guid: 'g',
  date: '2025-01-01T00:00:00.000Z',
  content: 'C',
  ...(extra === undefined ? {} : { extra }),
});

describe('rename', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('rename');
    expect(definition.category).toBe('operators');
    expect(definition.themedLabel).toBe('Transmute (Rename)');
    expect(definition.plainLabel).toBe('Rename');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('renames a custom field in extra and keeps core fields', async () => {
    const out = await rename([item({ price: 5, tag: 'x' })], { map: { price: 'cost' } });
    expect(out).toEqual([item({ tag: 'x', cost: 5 })]);
  });

  it('is a no-op for unmapped and missing fields', async () => {
    const input = [item({ a: 1 }), item(), item({})];
    expect(await rename(input, { map: { missing: 'other' } })).toEqual(input);
    expect(await rename(input, { map: {} })).toEqual(input);
  });

  it('leaves core fields unchanged even when they are named in the map', async () => {
    const input = [item({ a: 1 })];
    expect(await rename(input, { map: { title: 'headline' } })).toEqual(input);
  });

  it('rejects renaming onto a core field', () => {
    expect(definition.configSchema.safeParse({ map: { a: 'title' } }).success).toBe(false);
  });

  it('applies renames simultaneously so fields can be swapped', async () => {
    const out = await rename([item({ a: 1, b: 2 })], { map: { a: 'b', b: 'a' } });
    expect(out[0]?.extra).toEqual({ a: 2, b: 1 });
  });

  it('does not mutate its input', async () => {
    const input = [item({ a: 1 })];
    await rename(input, { map: { a: 'b' } });
    expect(input[0]?.extra).toEqual({ a: 1 });
  });

  it('preserves item order', async () => {
    const input = [item({ n: 1 }), item({ n: 2 }), item({ n: 3 })];
    const out = await rename(input, { map: { n: 'm' } });
    expect(out.map((i) => i.extra?.['m'])).toEqual([1, 2, 3]);
  });
});
