import { describe, expect, it } from 'vitest';
import { TtlLruCache } from './cache.js';

const value = (n: number) => ({ etag: `"e${String(n)}"`, body: `body-${String(n)}` });

function cacheWithClock(maxEntries?: number) {
  const clock = { t: 1_000 };
  const cache = new TtlLruCache({ maxEntries, now: () => clock.t });
  return { cache, clock };
}

describe('TtlLruCache', () => {
  it('returns the stored etag and body with an expiry time', () => {
    const { cache } = cacheWithClock();
    cache.set('a', value(1), { ttl: 500 });
    expect(cache.get('a')).toEqual({ ...value(1), expiresAt: 1_500 });
  });

  it('returns undefined for unknown keys', () => {
    expect(cacheWithClock().cache.get('missing')).toBeUndefined();
  });

  it('stops serving an entry once its TTL has elapsed and removes it', () => {
    const { cache, clock } = cacheWithClock();
    cache.set('a', value(1), { ttl: 500 });
    clock.t = 1_499;
    expect(cache.get('a')).toBeDefined();
    clock.t = 1_500;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('overwriting a key replaces the value and restarts the TTL', () => {
    const { cache, clock } = cacheWithClock();
    cache.set('a', value(1), { ttl: 500 });
    clock.t = 1_400;
    cache.set('a', value(2), { ttl: 500 });
    clock.t = 1_600;
    expect(cache.get('a')?.body).toBe('body-2');
    expect(cache.size).toBe(1);
  });

  it('evicts the least recently used entry when full', () => {
    const { cache } = cacheWithClock(2);
    cache.set('a', value(1), { ttl: 1_000 });
    cache.set('b', value(2), { ttl: 1_000 });
    cache.set('c', value(3), { ttl: 1_000 });
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('counts a get as a use, so the read entry survives eviction', () => {
    const { cache } = cacheWithClock(2);
    cache.set('a', value(1), { ttl: 1_000 });
    cache.set('b', value(2), { ttl: 1_000 });
    cache.get('a');
    cache.set('c', value(3), { ttl: 1_000 });
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('holds at most 100 entries by default', () => {
    const cache = new TtlLruCache();
    for (let i = 0; i < 150; i++) cache.set(`k${String(i)}`, value(i), { ttl: 1_000 });
    expect(cache.size).toBe(100);
    expect(cache.get('k0')).toBeUndefined();
    expect(cache.get('k149')).toBeDefined();
  });

  it('invalidate removes one key and clear removes all', () => {
    const { cache } = cacheWithClock();
    cache.set('a', value(1), { ttl: 1_000 });
    cache.set('b', value(2), { ttl: 1_000 });
    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
