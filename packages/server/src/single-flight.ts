/**
 * Collapses concurrent calls that share a key into one execution (Req 12.4).
 * While a call for `key` is running, later callers receive the same promise, so they get the same
 * result or the same error. The key is released when the call settles, so a later call runs again.
 */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  do(key: string, fn: () => Promise<T> | T): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) return existing;

    // The async wrapper turns a synchronous throw from `fn` into a rejection.
    const promise = (async () => fn())().finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}
