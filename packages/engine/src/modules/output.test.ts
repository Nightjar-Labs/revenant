import { describe, expect, it } from 'vitest';
import { testDeps } from '../__tests__/deps.js';
import type { Item } from '../types.js';
import { definition } from './output.js';

const output = async (items: Item[]): Promise<Item[]> =>
  (await definition.execute({ items }, definition.configSchema.parse({}), testDeps)).out;

const item = (n: number): Item => ({
  title: `t${n}`,
  link: `https://example.com/${n}`,
  guid: `g${n}`,
  date: '2025-01-01T00:00:00.000Z',
  extra: { n },
});

describe('output', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('output');
    expect(definition.category).toBe('output');
    expect(definition.themedLabel).toBe('Raise Output');
    expect(definition.plainLabel).toBe('Output');
    expect(definition.inputPorts).toEqual(['items']);
    expect(definition.outputPorts).toEqual(['out']);
  });

  it('accepts an empty config', () => {
    expect(definition.configSchema.safeParse({}).success).toBe(true);
  });

  it('passes items through unchanged and in order', async () => {
    const items = [item(1), item(2), item(3)];
    const snapshot = structuredClone(items);
    expect(await output(items)).toEqual(snapshot);
    expect(items).toEqual(snapshot);
  });

  it('passes an empty array through', async () => {
    expect(await output([])).toEqual([]);
  });
});
