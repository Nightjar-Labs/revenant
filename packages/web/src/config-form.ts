/**
 * Pure helpers behind the config panel's form generator. They read the JSON Schema that the
 * server derives from each module's Zod config schema (`GET /api/modules`) and edit config
 * values immutably, so the React components stay thin.
 */

export type JsonSchema = Record<string, unknown>;

/** Location of a value inside a node config: object keys and array indexes. */
export type ConfigPath = readonly (string | number)[];

export type FieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'record'
  | 'unsupported';

const FORBIDDEN_KEYS = new Set(['__proto__']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSchema(value: unknown): JsonSchema | undefined {
  return isRecord(value) ? value : undefined;
}

/** Decides which editor a (sub-)schema gets. */
export function fieldKind(schema: JsonSchema): FieldKind {
  if (Array.isArray(schema['enum'])) return 'enum';
  switch (schema['type']) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      return schema['type'];
    case 'array':
      return asSchema(schema['items']) ? 'array' : 'unsupported';
    case 'object':
      if (asSchema(schema['properties'])) return 'object';
      // A map with arbitrary keys, e.g. the rename module's `map`.
      return asSchema(schema['additionalProperties']) ? 'record' : 'unsupported';
    default:
      return 'unsupported';
  }
}

/** Property schemas of an object schema, in declaration order. */
export function objectProperties(schema: JsonSchema): [string, JsonSchema][] {
  const properties = asSchema(schema['properties']);
  if (!properties) return [];
  const entries: [string, JsonSchema][] = [];
  for (const [key, property] of Object.entries(properties)) {
    const propertySchema = asSchema(property);
    if (propertySchema) entries.push([key, propertySchema]);
  }
  return entries;
}

export function requiredKeys(schema: JsonSchema): ReadonlySet<string> {
  const required = schema['required'];
  return new Set(Array.isArray(required) ? required.filter((k) => typeof k === 'string') : []);
}

export function enumOptions(schema: JsonSchema): string[] {
  const values = schema['enum'];
  return Array.isArray(values) ? values.map(String) : [];
}

/** Value used when a user adds an array item or a record entry. */
export function defaultValueFor(schema: JsonSchema): unknown {
  if ('default' in schema) return structuredClone(schema['default']);
  switch (fieldKind(schema)) {
    case 'enum':
      return Array.isArray(schema['enum']) ? schema['enum'][0] : undefined;
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return typeof schema['minimum'] === 'number' ? schema['minimum'] : 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'record':
      return {};
    case 'object': {
      const required = requiredKeys(schema);
      const value: Record<string, unknown> = {};
      for (const [key, property] of objectProperties(schema)) {
        if (required.has(key) || 'default' in property) value[key] = defaultValueFor(property);
      }
      return value;
    }
    default:
      return undefined;
  }
}

export function getAtPath(root: unknown, path: ConfigPath): unknown {
  let current = root;
  for (const segment of path) {
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current = isRecord(current) ? current[segment] : undefined;
    }
  }
  return current;
}

/**
 * Returns a copy of `root` with `value` stored at `path`, creating missing containers.
 * Passing `undefined` removes the key (or array element) instead of storing it.
 */
export function setAtPath(root: unknown, path: ConfigPath, value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;

  if (typeof head === 'number') {
    const list = Array.isArray(root) ? [...root] : [];
    if (rest.length === 0 && value === undefined) {
      list.splice(head, 1);
    } else {
      list[head] = setAtPath(list[head], rest, value);
    }
    return list;
  }

  if (FORBIDDEN_KEYS.has(head)) return root;
  const object = isRecord(root) ? { ...root } : {};
  if (rest.length === 0 && value === undefined) {
    delete object[head];
  } else {
    object[head] = setAtPath(object[head], rest, value);
  }
  return object;
}

/** Typed wrapper for node configs, which are always objects. */
export function setConfigValue(
  config: Record<string, unknown>,
  path: ConfigPath,
  value: unknown,
): Record<string, unknown> {
  const next = setAtPath(config, path, value);
  return isRecord(next) ? next : config;
}

/**
 * Text typed into a string field. Clearing an optional field removes it from the config so
 * an empty string never reaches a `minLength` constraint; required fields keep the empty string.
 */
export function stringFromInput(text: string, required: boolean): string | undefined {
  return text === '' && !required ? undefined : text;
}

/** Text typed into a number field; blank or non-numeric input clears the value. */
export function numberFromInput(text: string, integer: boolean): number | undefined {
  if (text.trim() === '') return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return undefined;
  return integer ? Math.trunc(parsed) : parsed;
}

/** Renames a record key in place (order preserved). Collisions and reserved keys are ignored. */
export function renameRecordKey(
  record: Record<string, unknown>,
  oldKey: string,
  newKey: string,
): Record<string, unknown> {
  if (oldKey === newKey || FORBIDDEN_KEYS.has(newKey) || newKey in record) return record;
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k === oldKey ? newKey : k, v]));
}

/** Adds an entry under a fresh key (`key`, `key2`, ...), keeping existing entries. */
export function addRecordEntry(
  record: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> {
  let key = 'key';
  for (let n = 2; key in record; n += 1) key = `key${n}`;
  return { ...record, [key]: value };
}

export function removeRecordEntry(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}
