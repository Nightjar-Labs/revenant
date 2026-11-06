import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SingleFlight } from './single-flight.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  it('runs the function once for concurrent calls with the same key', async () => {
    const flights = new SingleFlight<number>();
    const gate = deferred<number>();
    let calls = 0;
    const fn = () => {
      calls++;
      return gate.promise;
    };
    const all = Promise.all([flights.do('k', fn), flights.do('k', fn), flights.do('k', fn)]);
    gate.resolve(7);
    expect(await all).toEqual([7, 7, 7]);
    expect(calls).toBe(1);
  });

  it('runs different keys independently', async () => {
    const flights = new SingleFlight<string>();
    const results = await Promise.all([
      flights.do('a', () => 'A'),
      flights.do('b', () => Promise.resolve('B')),
    ]);
    expect(results).toEqual(['A', 'B']);
  });

  it('runs again once the previous call has settled', async () => {
    const flights = new SingleFlight<number>();
    let calls = 0;
    const fn = () => ++calls;
    expect(await flights.do('k', fn)).toBe(1);
    expect(await flights.do('k', fn)).toBe(2);
  });

  it('gives every waiter the same rejection and releases the key afterwards', async () => {
    const flights = new SingleFlight<number>();
    const gate = deferred<number>();
    const first = flights.do('k', () => gate.promise);
    const second = flights.do('k', () => 99);
    gate.reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    expect(await flights.do('k', () => 5)).toBe(5);
  });

  it('turns a synchronous throw into a rejection and releases the key', async () => {
    const flights = new SingleFlight<number>();
    await expect(
      flights.do('k', () => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    expect(await flights.do('k', () => 1)).toBe(1);
  });

  // Property 23: concurrent requests for one key trigger a single execution
  it('executes once for any number of concurrent callers (Property 23)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50 }), async (callers) => {
        const flights = new SingleFlight<number>();
        const gate = deferred<number>();
        let calls = 0;
        const pending = Array.from({ length: callers }, () =>
          flights.do('k', () => {
            calls++;
            return gate.promise;
          }),
        );
        gate.resolve(42);
        const results = await Promise.all(pending);
        return calls === 1 && results.every((r) => r === 42);
      }),
      { numRuns: 100 },
    );
  });
});
