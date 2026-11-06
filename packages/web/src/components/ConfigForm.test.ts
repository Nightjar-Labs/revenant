import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { JsonSchema } from '../config-form.js';
import { ConfigForm } from './ConfigForm.js';

function render(schema: JsonSchema, config: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(ConfigForm, { schema, config, onChange: () => {} }));
}

const fetchFeedSchema: JsonSchema = {
  type: 'object',
  properties: { url: { type: 'string' } },
  required: ['url'],
};

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
        },
        required: ['field', 'op', 'value'],
      },
    },
  },
  required: ['mode', 'rules'],
};

describe('ConfigForm', () => {
  it('renders a URL input for fetch modules', () => {
    const html = render(fetchFeedSchema, { url: 'https://example.com/rss' });
    expect(html).toContain('type="url"');
    expect(html).toContain('value="https://example.com/rss"');
  });

  it('renders the filter rule builder with field/op/value rows and add/remove buttons', () => {
    const html = render(filterSchema, {
      mode: 'any',
      rules: [
        { field: 'title', op: 'regex', value: 'ghost' },
        { field: 'content', op: 'contains', value: 'boo' },
      ],
    });
    expect(html).toContain('<select name="mode"');
    expect(html).toContain('<option value="all">all</option>');
    expect(html).toContain('name="rules.0.field"');
    expect(html).toContain('name="rules.1.value"');
    expect(html).toContain('<select name="rules.0.op"');
    expect(html).toContain('aria-label="Remove item 2"');
    expect(html).toContain('>Add</button>');
  });

  it('renders an empty filter config (as created from a fresh node) without crashing', () => {
    const html = render(filterSchema, {});
    expect(html).toContain('<legend>rules</legend>');
    expect(html).not.toContain('Remove item');
  });

  it('renders nested objects as fieldsets and marks optional fields', () => {
    const html = render(
      {
        type: 'object',
        properties: {
          fieldMap: {
            type: 'object',
            properties: { title: { type: 'string', minLength: 1 } },
            additionalProperties: false,
          },
        },
      },
      { fieldMap: { title: '$.name' } },
    );
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend>fieldMap (optional)</legend>');
    expect(html).toContain('value="$.name"');
  });

  it('renders number, record and boolean fields', () => {
    const html = render(
      {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 0 },
          map: { type: 'object', additionalProperties: { type: 'string' } },
          flag: { type: 'boolean' },
        },
        required: ['limit', 'map'],
      },
      { limit: 5, map: { title: 'headline' }, flag: true },
    );
    expect(html).toContain('type="number"');
    expect(html).toContain('value="5"');
    expect(html).toContain('value="title"');
    expect(html).toContain('value="headline"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('says so when a module has no settings', () => {
    expect(render({ type: 'object', properties: {} }, {})).toContain('no settings');
  });
});
