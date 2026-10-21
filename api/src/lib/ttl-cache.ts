/** Cache en memoria con TTL. Una sola entrada por instancia. */
export function createTtlCache<T>(ttlMs: number) {
  let value: T | undefined;
  let at = 0;
  return {
    get(): T | undefined {
      if (value === undefined) return undefined;
      if (Date.now() - at > ttlMs) {
        value = undefined;
        return undefined;
      }
      return value;
    },
    set(next: T) {
      value = next;
      at = Date.now();
    },
    clear() {
      value = undefined;
      at = 0;
    },
  };
}
