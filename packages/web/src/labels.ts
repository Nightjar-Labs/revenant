import type { ModuleInfo } from './types.js';

/**
 * Returns the display label for a module. Every themed label must also show its plain
 * name in parentheses (product steering), unless the themed label already includes it.
 */
export function moduleLabel(module: Pick<ModuleInfo, 'themedLabel' | 'plainLabel'>): string {
  const { themedLabel, plainLabel } = module;
  if (themedLabel.includes('(') || themedLabel === plainLabel) return themedLabel;
  return `${themedLabel} (${plainLabel})`;
}
