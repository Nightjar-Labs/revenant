import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isoDateArbitrary } from '../__tests__/arbitraries.js';
import type { ExecutionDeps, FetchResult, Item } from '../types.js';
import { definition } from './fetch-json.js';

const NOW = '2025-01-01T00:00:00.000Z';
const URL_ = 'https://api.example.com/data';

const makeDeps = (
  respond: (url: string) => Promise<FetchResult>,
  now: string = NOW,
): { deps: ExecutionDeps; fetch: ReturnType<typeof vi.fn> } => {
  const fetch = vi.fn(respond);
  return {
    fetch,
    deps: { fetcher: { fetch }, clock: { now: () => new Date(now) }, registry: new Map() },
  };
};

const ok = (body: string, status = 200): Promise<FetchResult> =>
  Promise.resolve({ body, status, headers: {} });

const run = async (
  payload: unknown,
  config: Record<string, unknown>,
  now?: string,
): Promise<{ items: Item[]; fetch: ReturnType<typeof vi.fn> }> => {
  const { deps, fetch } = makeDeps(
    () => ok(typeof payload === 'string' ? payload : JSON.stringify(payload)),
    now,
  );
  const parsed = definition.configSchema.parse({ url: URL_, ...config });
  const { out } = await definition.execute({}, parsed, deps);
  return { items: out, fetch };
};

const MAP = {
  title: '$.name',
  link: '$.html_url',
  guid: '$.id',
  date: '$.published_at',
  content: '$.body',
};

const RELEASES = {
  results: [
    {
      id: 101,
      name: 'v1.0',
      html_url: 'https://example.com/r/1',
      published_at: '2025-03-01T10:00:00Z',
      body: 'Notes 1',
      draft: false,
    },
    {
      id: 102,
      name: 'v1.1',
      html_url: 'https://example.com/r/2',
      published_at: '2025-03-02T10:00:00+02:00',
      body: 'Notes 2',
      author: { login: 'octo' },
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetch-json', () => {
  it('declares its identity and ports', () => {
    expect(definition.type).toBe('fetch-json');
    expect(definition.category).toBe('sources');
    expect(definition.themedLabel).toBe('Summon (Fetch JSON)');
    expect(definition.plainLabel).toBe('Fetch JSON');
    expect(definition.inputPorts).toEqual([]);
    expect(definition.outputPorts).toEqual(['out']);
  });

  describe('config', () => {
    it('requires url and itemsPath', () => {
      expect(definition.configSchema.safeParse({ itemsPath: '$[*]' }).success).toBe(false);
      expect(definition.configSchema.safeParse({ url: URL_ }).success).toBe(false);
      expect(definition.configSchema.safeParse({ url: URL_, itemsPath: '$[*]' }).success).toBe(
        true,
      );
    });

    it.each([
      ['a file: URL', { url: 'file:///etc/passwd' }],
      ['a URL with credentials', { url: 'https://u:p@example.com/x' }],
      ['an unknown fieldMap key', { fieldMap: { author: '$.a' } }],
      ['an unparseable default date', { defaults: { date: 'whenever' } }],
    ])('rejects %s', (_label, override) => {
      const config = { url: URL_, itemsPath: '$[*]', ...override };
      expect(definition.configSchema.safeParse(config).success).toBe(false);
    });
  });

  describe('mapping', () => {
    it('maps candidates to items and keeps unmapped top-level keys in extra', async () => {
      const { items, fetch } = await run(RELEASES, { itemsPath: '$.results[*]', fieldMap: MAP });
      expect(fetch).toHaveBeenCalledExactlyOnceWith(URL_);
      expect(items).toEqual([
        {
          title: 'v1.0',
          link: 'https://example.com/r/1',
          guid: '101',
          date: '2025-03-01T10:00:00.000Z',
          content: 'Notes 1',
          extra: { draft: false },
        },
        {
          title: 'v1.1',
          link: 'https://example.com/r/2',
          guid: '102',
          date: '2025-03-02T08:00:00.000Z',
          content: 'Notes 2',
          extra: { author: { login: 'octo' } },
        },
      ]);
    });

    it('uses the elements of an array when itemsPath selects the array itself', async () => {
      const a = await run(RELEASES, { itemsPath: '$.results', fieldMap: MAP });
      const b = await run(RELEASES, { itemsPath: '$.results[*]', fieldMap: MAP });
      expect(a.items).toEqual(b.items);
    });

    it('supports a root array and nested field paths', async () => {
      const { items } = await run(
        [{ user: { name: 'Ada' }, url: 'https://e.com/1', t: '2025-04-01T00:00:00Z' }],
        { itemsPath: '$[*]', fieldMap: { title: '$.user.name', link: '$.url', date: '$.t' } },
      );
      expect(items[0]).toMatchObject({
        title: 'Ada',
        link: 'https://e.com/1',
        guid: 'https://e.com/1',
        // `user` is only partly consumed by the nested path, so it stays in extra.
        extra: { user: { name: 'Ada' } },
      });
    });

    it('converts numbers to text and numeric dates to ISO', async () => {
      const { items } = await run([{ n: 7, ts: 1_700_000_000, ms: 1_700_000_000_000 }], {
        itemsPath: '$[*]',
        fieldMap: { title: '$.n', date: '$.ts' },
      });
      expect(items[0]?.title).toBe('7');
      expect(items[0]?.date).toBe('2023-11-14T22:13:20.000Z');

      const millis = await run([{ ms: 1_700_000_000_000 }], {
        itemsPath: '$[*]',
        fieldMap: { date: '$.ms' },
      });
      expect(millis.items[0]?.date).toBe('2023-11-14T22:13:20.000Z');
    });

    it('applies defaults when a path matches nothing or the value is null', async () => {
      const { items } = await run([{ name: null, id: 5 }], {
        itemsPath: '$[*]',
        fieldMap: MAP,
        defaults: { title: 'Untitled', link: 'https://example.com/', content: 'n/a' },
      });
      expect(items[0]).toMatchObject({
        title: 'Untitled',
        link: 'https://example.com/',
        content: 'n/a',
        guid: '5',
      });
    });

    it('falls back from defaults.date to the injected clock', async () => {
      const withDefault = await run([{}], {
        itemsPath: '$[*]',
        fieldMap: { date: '$.d' },
        defaults: { date: '2020-02-03T04:05:06Z' },
      });
      expect(withDefault.items[0]?.date).toBe('2020-02-03T04:05:06.000Z');

      const withClock = await run(
        [{ d: 'not a date' }],
        { itemsPath: '$[*]', fieldMap: { date: '$.d' } },
        '2031-01-02T03:04:05.000Z',
      );
      expect(withClock.items[0]?.date).toBe('2031-01-02T03:04:05.000Z');
    });

    it('derives a stable hash guid when there is no guid and no link', async () => {
      const first = await run([{ name: 'x' }], {
        itemsPath: '$[*]',
        fieldMap: { title: '$.name' },
      });
      const second = await run([{ name: 'x' }], {
        itemsPath: '$[*]',
        fieldMap: { title: '$.name' },
      });
      expect(first.items[0]?.guid).toMatch(/^[0-9a-f]{40}$/);
      expect(second.items[0]?.guid).toBe(first.items[0]?.guid);
    });

    it('works without a fieldMap, keeping every key in extra', async () => {
      const { items } = await run([{ a: 1, b: 'two' }], { itemsPath: '$[*]' });
      expect(items[0]).toMatchObject({ title: '', link: '', date: NOW, extra: { a: 1, b: 'two' } });
    });

    it('keeps a __proto__ key as plain data', async () => {
      const { items } = await run('[{"__proto__": {"polluted": true}, "a": 1}]', {
        itemsPath: '$[*]',
      });
      expect(items).toHaveLength(1);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('skips candidates that are not objects and warns with a count', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { items } = await run([1, 'two', null, [3], { name: 'ok' }], {
        itemsPath: '$[*]',
        fieldMap: { title: '$.name' },
      });
      expect(items.map((i) => i.title)).toEqual(['ok']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('4 candidate(s)');
    });
  });

  describe('empty results', () => {
    it.each([
      ['a missing path', { itemsPath: '$.nope[*]' }],
      ['an empty array', { itemsPath: '$.results[*]' }],
    ])('returns an empty array for %s', async (_label, config) => {
      const { items } = await run({ results: [] }, config);
      expect(items).toEqual([]);
    });
  });

  describe('errors', () => {
    it('throws a descriptive error when the fetch fails, without leaking the URL', async () => {
      const { deps } = makeDeps(() => Promise.reject(new Error('Response too large')));
      const config = definition.configSchema.parse({
        url: 'https://api.example.com/x?key=s3cret',
        itemsPath: '$[*]',
      });
      const error = await definition.execute({}, config, deps).catch((e: unknown) => e);
      expect((error as Error).message).toBe('fetch-json: fetch failed: Response too large');
      expect((error as Error).message).not.toContain('s3cret');
    });

    it('throws on a non-2xx response', async () => {
      const { deps } = makeDeps(() => ok('{}', 500));
      const config = definition.configSchema.parse({ url: URL_, itemsPath: '$[*]' });
      await expect(definition.execute({}, config, deps)).rejects.toThrow(
        'fetch-json: fetch failed: HTTP status 500',
      );
    });

    it.each([
      ['plain text', 'not json'],
      ['an empty body', ''],
      ['truncated JSON', '{"results": ['],
    ])('throws for invalid JSON: %s', async (_label, body) => {
      await expect(run(body, { itemsPath: '$[*]' })).rejects.toThrow(
        'fetch-json: response is not valid JSON',
      );
    });

    it('rejects filter scripts instead of executing them', async () => {
      const marker = vi.fn();
      (globalThis as Record<string, unknown>)['__fetchJsonMarker'] = marker;
      await run([{ a: 1 }], { itemsPath: '$[?(globalThis.__fetchJsonMarker())]' }).catch(
        () => undefined,
      );
      delete (globalThis as Record<string, unknown>)['__fetchJsonMarker'];
      expect(marker).not.toHaveBeenCalled();
    });

    it('supports safe filter expressions in itemsPath', async () => {
      const { items } = await run(
        [
          { n: 'a', keep: true },
          { n: 'b', keep: false },
        ],
        { itemsPath: '$[?(@.keep==true)]', fieldMap: { title: '$.n' } },
      );
      expect(items.map((i) => i.title)).toEqual(['a']);
    });
  });

  describe('properties', () => {
    const wordArbitrary = fc.stringMatching(/^[A-Za-z0-9]{1,20}$/);

    // Property 10: the module fetches exactly once, through the injected fetcher, with config.url
    it('fetches exactly once through the injected fetcher', async () => {
      await fc.assert(
        fc.asyncProperty(fc.webUrl(), async (url) => {
          const { deps, fetch } = makeDeps(() => ok('[]'));
          await definition.execute(
            {},
            definition.configSchema.parse({ url, itemsPath: '$[*]' }),
            deps,
          );
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(fetch).toHaveBeenCalledWith(url);
        }),
        { numRuns: 100 },
      );
    });

    // Property 9: a missing date is always taken from the injected clock
    it('uses the injected clock for every missing date', async () => {
      await fc.assert(
        fc.asyncProperty(
          isoDateArbitrary,
          fc.array(wordArbitrary, { maxLength: 10 }),
          async (now, names) => {
            const { items } = await run(
              names.map((name) => ({ name })),
              { itemsPath: '$[*]', fieldMap: { title: '$.name', date: '$.when' } },
              now,
            );
            expect(items.map((i) => i.date)).toEqual(names.map(() => now));
          },
        ),
        { numRuns: 100 },
      );
    });

    // Property 3 (source form): one item per object candidate, in order, deterministic output
    it('emits one item per candidate in order and is deterministic', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.record({ name: wordArbitrary, id: fc.integer() }), { maxLength: 15 }),
          async (candidates) => {
            const config = { itemsPath: '$[*]', fieldMap: { title: '$.name', guid: '$.id' } };
            const first = (await run(candidates, config)).items;
            const second = (await run(candidates, config)).items;
            expect(first.map((i) => [i.title, i.guid])).toEqual(
              candidates.map((c) => [c.name, String(c.id)]),
            );
            expect(second).toEqual(first);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
