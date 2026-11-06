import { describe, expect, it } from 'vitest';
import { createModuleRegistry } from './module-registry.js';

describe('createModuleRegistry', () => {
  it('registers every built-in operator', () => {
    expect([...createModuleRegistry().keys()].sort()).toEqual([
      'fetch-feed',
      'fetch-json',
      'filter',
      'output',
      'regex',
      'rename',
      'reverse',
      'sort',
      'truncate',
      'union',
      'unique',
    ]);
  });
});
