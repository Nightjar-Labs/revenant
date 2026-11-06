import { describe, expect, it } from 'vitest';

import { moduleLabel } from './labels.js';

describe('moduleLabel', () => {
  it('appends the plain name in parentheses to a bare themed label', () => {
    expect(moduleLabel({ themedLabel: 'Banish', plainLabel: 'Filter' })).toBe('Banish (Filter)');
  });

  it('keeps a themed label that already includes the plain name', () => {
    expect(moduleLabel({ themedLabel: 'Summon (Fetch Feed)', plainLabel: 'Fetch Feed' })).toBe(
      'Summon (Fetch Feed)',
    );
  });

  it('does not duplicate identical labels', () => {
    expect(moduleLabel({ themedLabel: 'Truncate', plainLabel: 'Truncate' })).toBe('Truncate');
  });
});
