import "server-only";

/**
 * Cache em memória com TTL para as consultas ao GA4 (protege a cota da propriedade).
 * Guarda a Promise, então consultas idênticas simultâneas viram uma só chamada à API.
 * Erros não ficam em cache.
 */
type Entry = { expires: number; value: Promise<unknown> };

const MAX_ENTRIES = 1000;
const g = globalThis as typeof globalThis & { __ga4Cache?: Map<string, Entry> };
const store = (g.__ga4Cache ??= new Map());

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const value = fn();
  store.set(key, { expires: now + ttlMs, value });
  value.catch(() => store.delete(key));

  if (store.size > MAX_ENTRIES) {
    for (const k of store.keys()) {
      store.delete(k);
      if (store.size <= MAX_ENTRIES * 0.8) break;
    }
  }
  return value;
}

export function clearCache() {
  store.clear();
}
