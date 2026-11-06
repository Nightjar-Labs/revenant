import {
  addRecordEntry,
  defaultValueFor,
  enumOptions,
  fieldKind,
  isRecord,
  numberFromInput,
  objectProperties,
  removeRecordEntry,
  renameRecordKey,
  requiredKeys,
  stringFromInput,
  type ConfigPath,
  type JsonSchema,
} from '../config-form.js';

/** Called with the location of the edited value; `undefined` removes it. */
export type ConfigChange = (path: ConfigPath, value: unknown) => void;

interface ConfigFormProps {
  /** JSON Schema of the module config (an object schema). */
  schema: JsonSchema;
  config: Record<string, unknown>;
  onChange: ConfigChange;
}

/** Form generated from a module's JSON Schema. Controlled: it only reports edits. */
export function ConfigForm({ schema, config, onChange }: ConfigFormProps) {
  if (objectProperties(schema).length === 0) {
    return <p className="muted">This module has no settings.</p>;
  }
  return (
    <form className="config-form" onSubmit={(event) => event.preventDefault()}>
      <ObjectFields schema={schema} value={config} path={[]} onChange={onChange} />
    </form>
  );
}

interface FieldProps {
  name: string;
  schema: JsonSchema;
  value: unknown;
  path: ConfigPath;
  required: boolean;
  onChange: ConfigChange;
}

function ObjectFields({
  schema,
  value,
  path,
  onChange,
}: {
  schema: JsonSchema;
  value: unknown;
  path: ConfigPath;
  onChange: ConfigChange;
}) {
  const required = requiredKeys(schema);
  const values = isRecord(value) ? value : {};
  return (
    <>
      {objectProperties(schema).map(([key, property]) => (
        <Field
          key={key}
          name={key}
          schema={property}
          value={values[key]}
          path={[...path, key]}
          required={required.has(key)}
          onChange={onChange}
        />
      ))}
    </>
  );
}

function Field(props: FieldProps) {
  const { name, schema, value, path, required, onChange } = props;
  const title = typeof schema['description'] === 'string' ? schema['description'] : undefined;
  const label = required ? name : `${name} (optional)`;

  switch (fieldKind(schema)) {
    case 'string':
      return (
        <label className="config-field" title={title}>
          <span className="config-label">{label}</span>
          <input
            type={name === 'url' ? 'url' : 'text'}
            name={path.join('.')}
            value={typeof value === 'string' ? value : ''}
            placeholder={name === 'url' ? 'https://example.com/feed' : undefined}
            onChange={(event) => onChange(path, stringFromInput(event.target.value, required))}
          />
        </label>
      );
    case 'number':
    case 'integer':
      return (
        <label className="config-field" title={title}>
          <span className="config-label">{label}</span>
          <input
            type="number"
            name={path.join('.')}
            min={typeof schema['minimum'] === 'number' ? schema['minimum'] : undefined}
            step={fieldKind(schema) === 'integer' ? 1 : 'any'}
            value={typeof value === 'number' ? value : ''}
            onChange={(event) =>
              onChange(path, numberFromInput(event.target.value, fieldKind(schema) === 'integer'))
            }
          />
        </label>
      );
    case 'boolean':
      return (
        <label className="config-field config-field-inline" title={title}>
          <input
            type="checkbox"
            name={path.join('.')}
            checked={value === true}
            onChange={(event) => onChange(path, event.target.checked)}
          />
          <span className="config-label">{label}</span>
        </label>
      );
    case 'enum':
      return (
        <label className="config-field" title={title}>
          <span className="config-label">{label}</span>
          <select
            name={path.join('.')}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(path, event.target.value || undefined)}
          >
            {(!required || typeof value !== 'string' || !enumOptions(schema).includes(value)) && (
              <option value="">{required ? 'Choose…' : '(none)'}</option>
            )}
            {enumOptions(schema).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      );
    case 'object':
      return (
        <fieldset className="config-group" title={title}>
          <legend>{label}</legend>
          <ObjectFields schema={schema} value={value} path={path} onChange={onChange} />
        </fieldset>
      );
    case 'array':
      return <ArrayField {...props} label={label} />;
    case 'record':
      return <RecordField {...props} label={label} />;
    default:
      return <p className="muted config-field">{label}: this field type is not editable here.</p>;
  }
}

function ArrayField({ schema, value, path, onChange, label }: FieldProps & { label: string }) {
  const itemSchema = isRecord(schema['items']) ? schema['items'] : {};
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  const isObjectItem = fieldKind(itemSchema) === 'object';

  return (
    <fieldset className="config-group">
      <legend>{label}</legend>
      {items.map((item, index) => (
        <div key={index} className="config-array-row" role="group" aria-label={`Item ${index + 1}`}>
          <div className="config-array-item">
            {isObjectItem ? (
              <ObjectFields
                schema={itemSchema}
                value={item}
                path={[...path, index]}
                onChange={onChange}
              />
            ) : (
              <Field
                name={`#${index + 1}`}
                schema={itemSchema}
                value={item}
                path={[...path, index]}
                required
                onChange={onChange}
              />
            )}
          </div>
          <button
            type="button"
            aria-label={`Remove item ${index + 1}`}
            onClick={() =>
              onChange(
                path,
                items.filter((_, i) => i !== index),
              )
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange(path, [...items, defaultValueFor(itemSchema)])}>
        Add
      </button>
    </fieldset>
  );
}

function RecordField({ schema, value, path, onChange, label }: FieldProps & { label: string }) {
  const valueSchema = isRecord(schema['additionalProperties'])
    ? schema['additionalProperties']
    : {};
  const record = isRecord(value) ? value : {};

  return (
    <fieldset className="config-group">
      <legend>{label}</legend>
      {Object.entries(record).map(([key, entry], index) => (
        <div
          key={index}
          className="config-array-row"
          role="group"
          aria-label={`Entry ${index + 1}`}
        >
          <div className="config-array-item">
            <label className="config-field">
              <span className="config-label">key</span>
              <input
                type="text"
                value={key}
                onChange={(event) =>
                  onChange(path, renameRecordKey(record, key, event.target.value))
                }
              />
            </label>
            <Field
              name="value"
              schema={valueSchema}
              value={entry}
              path={[...path, key]}
              required
              onChange={onChange}
            />
          </div>
          <button
            type="button"
            aria-label={`Remove entry ${index + 1}`}
            onClick={() => onChange(path, removeRecordEntry(record, key))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange(path, addRecordEntry(record, defaultValueFor(valueSchema)))}
      >
        Add
      </button>
    </fieldset>
  );
}
