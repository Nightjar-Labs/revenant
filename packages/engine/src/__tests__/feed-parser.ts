import { XMLParser, XMLValidator } from 'fast-xml-parser';

export type XmlNode = Record<string, unknown>;

// Lenient test parser. `trimValues: false` keeps leading/trailing whitespace so round-trips are
// exact; `parseTagValue: false` keeps values such as "123" as strings.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
});

/** Parses XML after asserting it is well-formed. */
export function parseXml(xml: string): XmlNode {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(
      `Not well-formed XML: ${validation.err.msg} (line ${String(validation.err.line)})`,
    );
  }
  return parser.parse(xml) as XmlNode;
}

export const isNode = (value: unknown): value is XmlNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const toArray = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** Text of an element: plain text, or '' when the element has only attributes or is empty. */
export function textOf(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (isNode(value)) {
    const text = value['#text'];
    return typeof text === 'string' ? text : '';
  }
  return undefined;
}
