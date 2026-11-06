import { JSONPath } from 'jsonpath-plus';
import { z } from 'zod';
import { fieldToString } from '../item-field.js';
import { HttpUrlSchema, fetchBody, toIsoDate } from '../source-utils.js';
import { ItemSchema, deriveGuid } from '../types.js';
import type { Clock, Item, ModuleDefinition } from '../types.js';

const LABEL = 'fetch-json';

type FieldName = 'title' | 'link' | 'guid' | 'date' | 'content';

/** Item field -> JSONPath relative to each candidate item (e.g. `$.html_url`). */
const FieldMapSchema = z.strictObject({
  title: z.string().min(1).optional(),
  link: z.string().min(1).optional(),
  guid: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
});

/** Item field -> fallback value used when the mapped path matches nothing. */
const DefaultsSchema = z
  .strictObject({
    title: z.string().optional(),
    link: z.string().optional(),
    guid: z.string().optional(),
    date: z.string().optional(),
    content: z.string().optional(),
  })
  .superRefine((defaults, ctx) => {
    if (defaults.date !== undefined && toIsoDate(defaults.date) === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['date'],
        message: `Invalid date: ${defaults.date}`,
      });
    }
  });

export const FetchJsonConfigSchema = z.object({
  url: HttpUrlSchema,
  /** JSONPath that selects the candidate items, e.g. `$.results[*]`. */
  itemsPath: z.string().min(1),
  fieldMap: FieldMapSchema.optional(),
  defaults: DefaultsSchema.optional(),
});

export type FetchJsonConfig = z.infer<typeof FetchJsonConfigSchema>;

type JsonObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface Match {
  value: unknown;
  pointer: string;
}

/**
 * Evaluates a JSONPath and returns all matches. Filter expressions use jsonpath-plus's `safe`
 * evaluator, which does not execute arbitrary JavaScript.
 */
function query(path: string, json: unknown, what: string): Match[] {
  try {
    return JSONPath({
      path,
      json: json as object,
      wrap: true,
      eval: 'safe',
      resultType: 'all',
    }) as Match[];
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${LABEL}: invalid JSONPath for ${what}: ${reason}`, { cause: error });
  }
}

/** Candidate items: with `$.results` (the array itself) the array's elements are used. */
function selectCandidates(root: unknown, itemsPath: string): unknown[] {
  const matches = query(itemsPath, root, 'itemsPath');
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only !== undefined && Array.isArray(only.value)) return only.value as unknown[];
  return matches.map((match) => match.value);
}

/** A JSON pointer with a single segment (`/title`) names a top-level key. */
function topLevelKey(pointer: string): string | undefined {
  if (!/^\/[^/]*$/.test(pointer)) return undefined;
  return pointer.slice(1).replaceAll('~1', '/').replaceAll('~0', '~');
}

/** Numbers are epoch timestamps: seconds below 1e11, milliseconds above. */
function dateFrom(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = Math.abs(value) < 1e11 ? value * 1000 : value;
    return toIsoDate(new Date(millis).toISOString());
  }
  return toIsoDate(value);
}

function buildItem(
  candidate: JsonObject,
  config: FetchJsonConfig,
  clock: Clock,
): { item: unknown } {
  const fieldMap = config.fieldMap ?? {};
  const defaults = config.defaults ?? {};
  const consumed = new Set<string>();

  const read = (field: FieldName): unknown => {
    const path = fieldMap[field];
    if (path === undefined) return undefined;
    const match = query(path, candidate, `fieldMap.${field}`).find(
      (m) => m.value !== undefined && m.value !== null,
    );
    if (match === undefined) return undefined;
    const key = topLevelKey(match.pointer);
    if (key !== undefined) consumed.add(key);
    return match.value;
  };

  const text = (field: FieldName): string | undefined => {
    const value = read(field);
    return value === undefined ? defaults[field] : fieldToString(value);
  };

  const title = text('title') ?? '';
  const link = text('link') ?? '';
  const content = text('content');
  const date =
    dateFrom(read('date')) ??
    (defaults.date === undefined ? undefined : toIsoDate(defaults.date)) ??
    clock.now().toISOString();
  const guid = deriveGuid({ guid: text('guid'), link, title, date });

  // Own-property copy, so a key such as "__proto__" in the JSON stays plain data.
  const extra = Object.fromEntries(Object.entries(candidate).filter(([key]) => !consumed.has(key)));

  return {
    item: { title, link, guid, date, ...(content === undefined ? {} : { content }), extra },
  };
}

function toItems(candidates: unknown[], config: FetchJsonConfig, clock: Clock): Item[] {
  const items: Item[] = [];
  let skipped = 0;
  let dropped = 0;

  for (const candidate of candidates) {
    if (!isPlainObject(candidate)) {
      skipped += 1;
      continue;
    }
    const parsed = ItemSchema.safeParse(buildItem(candidate, config, clock).item);
    if (parsed.success) items.push(parsed.data);
    else dropped += 1;
  }

  // Counts only: response contents and URLs stay out of the logs.
  if (skipped > 0)
    console.warn(`${LABEL}: skipped ${String(skipped)} candidate(s) that are not JSON objects`);
  if (dropped > 0)
    console.warn(`${LABEL}: dropped ${String(dropped)} item(s) that failed validation`);
  return items;
}

export const definition: ModuleDefinition<
  FetchJsonConfig,
  Record<string, never>,
  { out: Item[] }
> = {
  type: 'fetch-json',
  category: 'sources',
  themedLabel: 'Summon (Fetch JSON)',
  plainLabel: 'Fetch JSON',
  configSchema: FetchJsonConfigSchema,
  inputPorts: [],
  outputPorts: ['out'],
  async execute(_inputs, config, deps) {
    const body = await fetchBody(deps.fetcher, config.url, LABEL);
    let root: unknown;
    try {
      root = JSON.parse(body);
    } catch (error) {
      throw new Error(`${LABEL}: response is not valid JSON`, { cause: error });
    }
    return { out: toItems(selectCandidates(root, config.itemsPath), config, deps.clock) };
  },
};
