/**
 * Tiny in-memory cache with TTL and in-flight dedupe for async work.
 */
type CacheEntry<T = any> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};

const store = new Map<string, CacheEntry>();

const now = () => Date.now();

export function getCached<T = any>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T | undefined;
}

export function setCached<T = any>(key: string, value: T, ttlMs: number): T {
  store.set(key, { value, expiresAt: now() + ttlMs });
  return value;
}

export function invalidateByPrefix(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

type MemoOpts<TArgs extends any[]> = {
  ttlMs: number;
  keyFn?: (...args: TArgs) => string;
};

/**
 * Memoize an async function with TTL and in-flight dedupe.
 */
export function memoizeAsync<TArgs extends any[], TOut>(
  fn: (...args: TArgs) => Promise<TOut>,
  opts: MemoOpts<TArgs>
): (...args: TArgs) => Promise<TOut> {
  const { ttlMs, keyFn } = opts;

  return async (...args: TArgs): Promise<TOut> => {
    const key = keyFn ? keyFn(...args) : JSON.stringify(args);
    const existing = store.get(key);
    const t = now();

    if (existing && existing.expiresAt >= t) {
      if (existing.value !== undefined) return existing.value as TOut;
      if (existing.promise) return existing.promise as Promise<TOut>;
    } else if (existing && existing.promise) {
      return existing.promise as Promise<TOut>;
    }

    const p = Promise.resolve()
      .then(() => fn(...args))
      .then((val) => {
        store.set(key, { value: val, expiresAt: now() + ttlMs });
        return val;
      })
      .finally(() => {
        const latest = store.get(key);
        if (latest && latest.promise) latest.promise = undefined;
      });

    store.set(key, { value: existing?.value, expiresAt: t + ttlMs, promise: p });
    return p;
  };
}

// Minimal backward-compatible LRU with TTL (kept for existing imports).
export class LruTtl<K, V> {
  private max: number;
  private ttlMs: number;
  private map = new Map<K, { v: V; t: number }>();

  constructor(max = 64, ttlMs = 30000) {
    this.max = max;
    this.ttlMs = ttlMs;
  }

  get(k: K): V | undefined {
    const e = this.map.get(k);
    if (!e) return;
    if (Date.now() - e.t > this.ttlMs) {
      this.map.delete(k);
      return;
    }
    this.map.delete(k);
    this.map.set(k, { v: e.v, t: e.t });
    return e.v;
  }

  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, { v, t: Date.now() });
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }

  clear() {
    this.map.clear();
  }
}
