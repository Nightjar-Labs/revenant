import { describe, expect, it } from 'vitest';

import { formatItemDate, MAX_INSPECTOR_ITEMS, safeHref, visibleItems } from './inspector.js';
import type { Item } from './types.js';

const item = (n: number): Item => ({
  title: `t${String(n)}`,
  link: `https://x.test/${String(n)}`,
  guid: `g${String(n)}`,
  date: '2026-01-01T00:00:00Z',
});

describe('visibleItems', () => {
  it('limits the table to the first 20 items', () => {
    const items = Array.from({ length: 45 }, (_, n) => item(n));
    const { shown, hidden } = visibleItems(items);
    expect(shown).toHaveLength(MAX_INSPECTOR_ITEMS);
    expect(shown[0]?.title).toBe('t0');
    expect(hidden).toBe(25);
  });

  it('shows everything when there are 20 or fewer', () => {
    expect(visibleItems([item(1)])).toEqual({ shown: [item(1)], hidden: 0 });
    expect(visibleItems([])).toEqual({ shown: [], hidden: 0 });
  });
});

describe('formatItemDate', () => {
  it('formats valid dates and keeps unparseable text as is', () => {
    expect(formatItemDate('2026-01-01T00:00:00Z')).toBe(
      new Date('2026-01-01T00:00:00Z').toLocaleString(),
    );
    expect(formatItemDate('not a date')).toBe('not a date');
  });
});

describe('safeHref', () => {
  it('allows http and https only', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('http://example.com/')).toBe('http://example.com/');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('/relative')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
  });
});
