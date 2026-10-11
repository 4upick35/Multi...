// ---------------------------------------------------------------------------
// Generic in-memory TTL cache for ELMA service data
// Key format: `${accountId}::${key}` → {value, expiresAt}
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Получить значение из кэша. Возвращает undefined при отсутствии или истечении.
 */
export function cacheGet<T>(accountId: string, key: string): T | undefined {
  const entry = store.get(`${accountId}::${key}`) as CacheEntry<T> | undefined;
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(`${accountId}::${key}`);
    return undefined;
  }
  return entry.value;
}

/**
 * Положить значение в кэш с указанным TTL (мс).
 */
export function cacheSet<T>(accountId: string, key: string, value: T, ttlMs: number): void {
  store.set(`${accountId}::${key}`, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Проверить наличие невышедшего кэша по ключу.
 */
export function cacheHas(accountId: string, key: string): boolean {
  return cacheGet(accountId, key) !== undefined;
}

/**
 * Удалить конкретный ключ из кэша.
 */
export function cacheDelete(accountId: string, key: string): void {
  store.delete(`${accountId}::${key}`);
}

/**
 * Удалить все ключи аккаунта (при выходе/смене аккаунта).
 */
export function cacheClearAccount(accountId: string): void {
  const prefix = `${accountId}::`;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Common TTL constants
// ---------------------------------------------------------------------------

/** 5 минут — основной TTL для служебных проверок */
export const TTL_5MIN_MS = 5 * 60 * 1000;

/** 30 минут — долгий TTL (ported from userNameCache) */
export const TTL_30MIN_MS = 30 * 60 * 1000;

/** 10 минут — TTL для шаблонов визита и дескрипторов форм */
export const TTL_10MIN_MS = 10 * 60 * 1000;
