/** Whether a code point is allowed in an XML 1.0 document. */
function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

/**
 * Escapes text for use in XML element content or a double-quoted attribute value.
 * Characters that XML 1.0 forbids (most control characters, lone surrogates) are dropped,
 * because no escape can represent them and a single one makes the whole document unparseable.
 */
export function escapeXml(value: string): string {
  let out = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (!isXmlChar(codePoint)) continue;
    switch (char) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      case '\r':
        // Parsers normalise a literal CR to LF; a character reference survives.
        out += '&#13;';
        break;
      default:
        out += char;
    }
  }
  return out;
}

/** The valid `Date` for an ISO string, or `undefined` if it cannot be parsed. */
export function parseDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
