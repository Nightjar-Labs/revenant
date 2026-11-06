import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerModule, type ModuleRegistry } from './registry.js';
import type { ModuleDefinition } from './types.js';

const makeDefinition = (type: string): ModuleDefinition => ({
  type,
  themedLabel: 'Ghost',
  plainLabel: 'Stub',
  configSchema: z.object({}),
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute: () => ({}),
});

describe('registerModule', () => {
  it('stores a definition under its type', () => {
    const registry: ModuleRegistry = new Map();
    const definition = makeDefinition('stub');
    registerModule(registry, definition);
    expect(registry.get('stub')).toBe(definition);
  });

  it('allows re-registering the same definition', () => {
    const registry: ModuleRegistry = new Map();
    const definition = makeDefinition('stub');
    registerModule(registry, definition);
    expect(() => registerModule(registry, definition)).not.toThrow();
  });

  it('rejects a different definition for an already registered type', () => {
    const registry: ModuleRegistry = new Map();
    registerModule(registry, makeDefinition('stub'));
    expect(() => registerModule(registry, makeDefinition('stub'))).toThrow(
      'Module type already registered: stub',
    );
  });
});
