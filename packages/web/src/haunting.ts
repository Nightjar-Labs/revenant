/** Output formats a Haunting is served in (Req 8): the URL extension and the feed format name. */
export const HAUNTING_FORMATS = [
  { extension: 'xml', format: 'RSS 2.0' },
  { extension: 'atom', format: 'Atom' },
  { extension: 'json', format: 'JSON Feed' },
] as const;

export interface HauntingUrl {
  extension: string;
  /** Feed format name shown next to the URL, e.g. "RSS 2.0". */
  format: string;
  /** Absolute URL a feed reader can subscribe to. */
  url: string;
}

/** Absolute Haunting URLs `<origin>/h/<id>.xml|.atom|.json` for a saved pipeline. */
export function hauntingUrls(origin: string, id: string): HauntingUrl[] {
  const base = origin.replace(/\/+$/, '');
  return HAUNTING_FORMATS.map(({ extension, format }) => ({
    extension,
    format,
    url: `${base}/h/${encodeURIComponent(id)}.${extension}`,
  }));
}

/**
 * Copies `text` to the clipboard. Falls back to a hidden textarea and `execCommand` where the
 * async Clipboard API is unavailable (plain-http origins other than localhost). Returns success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or insecure context: try the fallback below.
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
