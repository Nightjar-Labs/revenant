import { z } from 'zod';
import { MAX_FIELD_LENGTH, fieldToString, getItemField } from '../item-field.js';
import type { Item, ModuleDefinition } from '../types.js';

const DEFAULT_FLAGS = 'g';

const FilterRuleSchema = z
  .object({
    field: z.string().min(1),
    op: z.enum(['contains', 'notContains', 'equals', 'regex', 'dateBefore', 'dateAfter']),
    value: z.string(),
    /** Regex flags; only used by the `regex` op. Defaults to 'g'. */
    flags: z.string().optional(),
  })
  .superRefine((rule, ctx) => {
    if (rule.op === 'regex') {
      try {
        new RegExp(rule.value, rule.flags ?? DEFAULT_FLAGS);
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: error instanceof Error ? error.message : 'Invalid regular expression',
        });
      }
    } else if (rule.op === 'dateBefore' || rule.op === 'dateAfter') {
      if (Number.isNaN(Date.parse(rule.value))) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: `Invalid date: ${rule.value}`,
        });
      }
    }
  });

export const FilterConfigSchema = z.object({
  mode: z.enum(['all', 'any']),
  rules: z.array(FilterRuleSchema),
});

export type FilterConfig = z.infer<typeof FilterConfigSchema>;
type FilterRule = FilterConfig['rules'][number];

/** Builds a predicate for one rule. Regexes are compiled once per run, not once per item. */
function compileRule(rule: FilterRule): (item: Item) => boolean {
  const text = (item: Item): string =>
    fieldToString(getItemField(item, rule.field)).slice(0, MAX_FIELD_LENGTH);

  switch (rule.op) {
    case 'contains':
      return (item) => text(item).includes(rule.value);
    case 'notContains':
      return (item) => !text(item).includes(rule.value);
    case 'equals':
      return (item) => text(item) === rule.value;
    case 'regex': {
      const pattern = new RegExp(rule.value, rule.flags ?? DEFAULT_FLAGS);
      return (item) => {
        // Global and sticky regexes keep state between calls; start every match from 0.
        pattern.lastIndex = 0;
        return pattern.test(text(item));
      };
    }
    case 'dateBefore':
    case 'dateAfter': {
      const bound = Date.parse(rule.value);
      const before = rule.op === 'dateBefore';
      return (item) => {
        const time = Date.parse(fieldToString(getItemField(item, rule.field)));
        if (Number.isNaN(time)) return false;
        return before ? time < bound : time > bound;
      };
    }
  }
}

export const definition: ModuleDefinition<FilterConfig, { items: Item[] }, { out: Item[] }> = {
  type: 'filter',
  category: 'operators',
  themedLabel: 'Banish',
  plainLabel: 'Filter',
  configSchema: FilterConfigSchema,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute(inputs, config) {
    const predicates = config.rules.map(compileRule);
    // With no rules, 'all' keeps every item (vacuous truth) and 'any' keeps none.
    const out = inputs.items.filter((item) =>
      config.mode === 'all'
        ? predicates.every((matches) => matches(item))
        : predicates.some((matches) => matches(item)),
    );
    return { out };
  },
};
