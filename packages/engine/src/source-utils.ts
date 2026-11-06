import { z } from 'zod';
import type { FetchResult } from './types.js';

/**
 * `http:`/`https:` URL without embedded credentials. Pipelines are plain files on disk, so
 * secrets must not be stored in them. The injected fetcher enforces the SSRF rules.
 */
export const HttpUrlSchema = z.string().superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Must be a valid http(s) URL' });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'Only http: and https: URLs are allowed' });
  } else if (url.username !== '' || url.password !== '') {
    ctx.addIssue({ code: 'custom', message: 'URLs must not contain embedded credentials' });
  }
});

/**
 * Converts a date string to ISO 8601 UTC (`toISOString()` form), or returns `undefined` when the
 * value is not a string, cannot be parsed, or falls outside years 0000-9999 (which `ItemSchema`
 * would reject).
 */
export function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return undefined;
  const date = new Date(time);
  const year = date.getUTCFullYear();
  return year >= 0 && year <= 9999 ? date.toISOString() : undefined;
}

/**
 * Runs the injected fetcher and returns the body of a successful (2xx) response.
 * Errors name the module but never the URL, which may carry secrets in its query string.
 */
export async function fetchBody(
  fetcher: { fetch(url: string): Promise<FetchResult> },
  url: string,
  label: string,
): Promise<string> {
  let result: FetchResult;
  try {
    result = await fetcher.fetch(url);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: fetch failed: ${reason}`, { cause: error });
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${label}: fetch failed: HTTP status ${String(result.status)}`);
  }
  return result.body;
}
