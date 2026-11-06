import { describe, expect, it } from 'vitest';
import { testDeps } from '../__tests__/deps.js';
import { MAX_FIELD_LENGTH } from '../item-field.js';
import type { Item } from '../types.js';
import { definition } from './regex.js';

const regex = async (items: Item[], config: unknown): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse(config), testDeps)).out;

const item = (overrides: Partial<Item> = {}): Item => ({
  title: 'Hello world, hello moon',
  link: 'https://example.com',
  guid: 'g',
  date: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('regex', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('regex');
    expect(definition.category).toBe('operators');
    expect(definition.themedLabel).toBe('Transmute (Regex)');
    expect(definition.plainLabel).toBe('Regex');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('defaults flags to g', () => {
    const parsed = definition.configSchema.parse({
      field: 'title',
      pattern: 'a',
      replacement: 'b',
    });
    expect(parsed.flags).toBe('g');
  });

  it('replaces every match in the title by default', async () => {
    const out = await regex([item()], { field: 'title', pattern: 'l+', replacement: 'L' });
    expect(out[0]?.title).toBe('HeLo worLd, heLo moon');
  });

  it('honours flags and capture groups', async () => {
    const out = await regex([item()], {
      field: 'title',
      pattern: '(hello) (world)',
      replacement: '$2 $1',
      flags: 'i',
    });
    expect(out[0]?.title).toBe('world Hello, hello moon');
  });

  it('replaces in content', async () => {
    const out = await regex([item({ content: '<p>Hi</p>' })], {
      field: 'content',
      pattern: '<[^>]+>',
      replacement: '',
    });
    expect(out[0]?.content).toBe('Hi');
  });

  it('replaces in a string field of extra', async () => {
    const out = await regex([item({ extra: { tag: 'a-b', n: 1 } })], {
      field: 'tag',
      pattern: '-',
      replacement: '_',
    });
    expect(out[0]?.extra).toEqual({ tag: 'a_b', n: 1 });
  });

  it('passes through items whose field is missing or not a string', async () => {
    const input = [item(), item({ extra: { n: 1 } })];
    expect(await regex(input, { field: 'content', pattern: 'x', replacement: 'y' })).toEqual(input);
    expect(await regex(input, { field: 'n', pattern: '1', replacement: '2' })).toEqual(input);
  });

  it('rejects an invalid pattern with the regex error message', () => {
    const result = definition.configSchema.safeParse({
      field: 'title',
      pattern: '(',
      replacement: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['pattern']);
      expect(result.error.issues[0]?.message).toMatch(
        /Unterminated group|Invalid regular expression/,
      );
    }
  });

  it('rejects invalid flags', () => {
    const result = definition.configSchema.safeParse({
      field: 'title',
      pattern: 'a',
      replacement: '',
      flags: 'zz',
    });
    expect(result.success).toBe(false);
  });

  it('is not affected by lastIndex state with sticky flags between items', async () => {
    const input = [item({ title: 'aaa' }), item({ title: 'aaa' })];
    const out = await regex(input, { field: 'title', pattern: 'a', replacement: 'b', flags: 'y' });
    expect(out.map((i) => i.title)).toEqual(['baa', 'baa']);
  });

  it('matches only the first 64 KB and keeps the rest unchanged', async () => {
    const title = 'a'.repeat(MAX_FIELD_LENGTH) + 'a'.repeat(10);
    const out = await regex([item({ title })], { field: 'title', pattern: 'a', replacement: 'b' });
    expect(out[0]?.title).toBe('b'.repeat(MAX_FIELD_LENGTH) + 'a'.repeat(10));
  });

  it('does not mutate its input and keeps order', async () => {
    const input = [item({ title: 'one' }), item({ title: 'two' })];
    const out = await regex(input, { field: 'title', pattern: 'o', replacement: '0' });
    expect(input.map((i) => i.title)).toEqual(['one', 'two']);
    expect(out.map((i) => i.title)).toEqual(['0ne', 'tw0']);
  });
});
