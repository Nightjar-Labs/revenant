import { registerBuiltinModules } from '@revenant/engine';
import type { ModuleRegistry } from '@revenant/engine';

/** Creates the server's module registry with every built-in operator registered. */
export function createModuleRegistry(): ModuleRegistry {
  return registerBuiltinModules(new Map());
}
