import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addRecordEntry,
  defaultValueFor,
  fieldKind,
  getAtPath,
  numberFromInput,
  removeRecordEntry,
  renameRecordKey,
  setAtPath,
  setConfigValue,
  stringFromInput,
  type JsonSchema,
} from './config-form.js';

const filterSchema: JsonSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['all', 'any'] },
    rules: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', minLength: 1 },
          op: { type: 'string', enum: ['contains', 'regex'] },
          value: { type: 'string' },
          flags: { type: 'string' },
        },
        required: ['field', 'op', 'value'],
      },
    },
  },
  required: ['mode', 'rules'],
};

describe('fieldKind', () => {
  it('maps JSON Schema fragments to editor kinds', () => {
    expect(fieldKind({ type: 'string' })).toBe('string');
    expect(fieldKind({ type: 'string', enum: ['a'] })).toBe('enum');
    expect(fieldKind({ type: 'integer' })).toBe('integer');
    expect(fieldKind({ type: 'number' })).toBe('number');
    expect(fieldKind({ type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ type: 'array', items: { type: 'string' } })).toBe('array');
    expect(fieldKind({ type: 'object', properties: {} })).toBe('object');
    expect(fieldKind({ type: 'object', additionalProperties: { type: 'string' } })).toBe('record');
  });

  it('flags shapes it cannot edit', () => {
    expect(fieldKind({})).toBe('unsupported');
    expect(fieldKind({ type: 'array' })).toBe('unsupported');
    expect(fieldKind({ type: 'object' })).toBe('unsupported');
    expect(fieldKind({ anyOf: [{ type: 'string' }] })).toBe('unsupported');
  });
});

describe('defaultValueFor', () => {
  it('builds a rule row with required fields filled in', () => {
    const items = (filterSchema['properties'] as Record<string, JsonSchema>)['rules']?.['items'];
    expect(defaultValueFor(items as JsonSchema)).toEqual({
      field: '',
      op: 'contains',
      value: '',
    });
  });

  it('prefers schema defaults and respects minimum', () => {
    expect(defaultValueFor({ type: 'string', default: 'g' })).toBe('g');
    expect(defaultValueFor({ type: 'integer', minimum: 3 })).toBe(3);
    expect(defaultValueFor({ type: 'object', additionalProperties: { type: 'string' } })).toEqual(
      {},
    );
  });
});

describe('setAtPath / getAtPath', () => {
  it('sets nested values without mutating the input', () => {
    const config = { rules: [{ field: 'title', op: 'contains', value: '' }] };
    const snapshot = structuredClone(config);
    const next = setAtPath(config, ['rules', 0, 'value'], 'ghost');
    expect(next).toEqual({ rules: [{ field: 'title', op: 'contains', value: 'ghost' }] });
    expect(config).toEqual(snapshot);
  });

  it('creates missing containers', () => {
    expect(setAtPath({}, ['fieldMap', 'title'], '$.t')).toEqual({ fieldMap: { title: '$.t' } });
    expect(setAtPath(undefined, ['rules', 1], 'x')).toEqual({ rules: [undefined, 'x'] });
  });

  it('removes keys and array elements when the value is undefined', () => {
    expect(setAtPath({ a: 1, b: 2 }, ['a'], undefined)).toEqual({ b: 2 });
    expect(setAtPath({ list: [1, 2, 3] }, ['list', 1], undefined)).toEqual({ list: [1, 3] });
  });

  it('refuses to write the __proto__ key', () => {
    const next = setAtPath({}, ['__proto__', 'polluted'], true) as object;
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(next)).toEqual([]);
  });

  it('setConfigValue keeps the config an object', () => {
    expect(setConfigValue({ url: '' }, ['url'], 'https://a.example')).toEqual({
      url: 'https://a.example',
    });
  });

  // Property: reading back what was written yields the written value.
  it('getAtPath returns what setAtPath stored', () => {
    const segment = fc.oneof(fc.stringMatching(/^[a-z]{1,6}$/), fc.integer({ min: 0, max: 4 }));
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), fc.string(), (path, value) => {
        expect(getAtPath(setAtPath({}, path, value), path)).toBe(value);
      }),
      { numRuns: 100 },
    );
  });
});

describe('input conversion', () => {
  it('stringFromInput drops cleared optional fields only', () => {
    expect(stringFromInput('', false)).toBeUndefined();
    expect(stringFromInput('', true)).toBe('');
    expect(stringFromInput('x', false)).toBe('x');
  });

  it('numberFromInput parses numbers and clears on blank or junk', () => {
    expect(numberFromInput('5', true)).toBe(5);
    expect(numberFromInput('5.9', true)).toBe(5);
    expect(numberFromInput('5.9', false)).toBe(5.9);
    expect(numberFromInput('  ', true)).toBeUndefined();
    expect(numberFromInput('abc', false)).toBeUndefined();
  });
});

describe('record helpers', () => {
  it('renames a key in place and ignores collisions', () => {
    const record = { a: '1', b: '2' };
    expect(Object.entries(renameRecordKey(record, 'a', 'z'))).toEqual([
      ['z', '1'],
      ['b', '2'],
    ]);
    expect(renameRecordKey(record, 'a', 'b')).toBe(record);
    expect(renameRecordKey(record, 'a', '__proto__')).toBe(record);
  });

  it('adds entries under fresh keys and removes by key', () => {
    const once = addRecordEntry({}, '');
    const twice = addRecordEntry(once, '');
    expect(Object.keys(twice)).toEqual(['key', 'key2']);
    expect(removeRecordEntry(twice, 'key')).toEqual({ key2: '' });
  });
});
