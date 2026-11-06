/** What the Haunting routes store per cached feed. */
export interface CacheValue {
  /** Quoted entity tag, ready for the `ETag` header. */
  etag: string;
  body: string;
}

export interface CacheEntry extends CacheValue {
  /** Time (ms, same clock as the cache's `now`) at which the entry stops being served. */
  expiresAt: number;
}

export interface CacheOptions {
  /** Maximum number of entries; the least recently used one is evicted beyond it. Default 100. */
  maxEntries?: number | undefined;
  /** Millisecond clock. Injectable so tests can move time without sleeping. Default `Date.now`. */
  now?: (() => number) | undefined;
}

export const DEFAULT_MAX_CACHE_ENTRIES = 100;

/**
 * In-memory TTL cache with least-recently-used eviction (Req 8.4).
 * A `get` of a live entry marks it as most recently used; expired entries are dropped on access.
 */
export class TtlLruCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    // Map iterates in insertion order, so re-inserting moves the key to the "newest" end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, value: CacheValue, options: { ttl: number }): void {
    this.entries.delete(key);
    this.entries.set(key, {
      etag: value.etag,
      body: value.body,
      expiresAt: this.now() + options.ttl,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
