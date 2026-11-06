import { registerModule } from '../registry.js';
import type { ModuleRegistry } from '../registry.js';
import { definition as fetchFeed } from './fetch-feed.js';
import { definition as fetchJson } from './fetch-json.js';
import { definition as filter } from './filter.js';
import { definition as output } from './output.js';
import { definition as regex } from './regex.js';
import { definition as rename } from './rename.js';
import { definition as reverse } from './reverse.js';
import { definition as sort } from './sort.js';
import { definition as truncate } from './truncate.js';
import { definition as union } from './union.js';
import { definition as unique } from './unique.js';

/** Registers every built-in operator definition into `registry` and returns it. */
export function registerBuiltinModules(registry: ModuleRegistry = new Map()): ModuleRegistry {
  registerModule(registry, fetchFeed);
  registerModule(registry, fetchJson);
  registerModule(registry, filter);
  registerModule(registry, output);
  registerModule(registry, regex);
  registerModule(registry, rename);
  registerModule(registry, reverse);
  registerModule(registry, sort);
  registerModule(registry, truncate);
  registerModule(registry, union);
  registerModule(registry, unique);
  return registry;
}
