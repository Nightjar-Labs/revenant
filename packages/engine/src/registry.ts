import type { ModuleDefinition } from './types.js';

/** Module registry: maps a node `type` (e.g. 'filter') to its definition. */
export type ModuleRegistry = Map<string, ModuleDefinition>;

/**
 * Registers a module definition under its `type`.
 * Throws if a different definition is already registered for that type.
 */
export function registerModule<TConfig, TInput, TOutput>(
  registry: ModuleRegistry,
  definition: ModuleDefinition<TConfig, TInput, TOutput>,
): ModuleRegistry {
  // Definitions are stored type-erased; the runner validates config before calling execute.
  const erased = definition as unknown as ModuleDefinition;
  const existing = registry.get(erased.type);
  if (existing !== undefined && existing !== erased) {
    throw new Error(`Module type already registered: ${erased.type}`);
  }
  registry.set(erased.type, erased);
  return registry;
}
