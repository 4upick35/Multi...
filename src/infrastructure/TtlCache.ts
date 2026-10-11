// ---------------------------------------------------------------------------
// Универсальный in-memory TTL-кэш (ООП-обёртка над elma-cache.ts).
// Ключ формируется как `${accountId}::${key}`.
// НЕ изменяет поведение — просто предоставляет ООП-интерфейс для инъекции.
// ---------------------------------------------------------------------------

import {
  cacheGet,
  cacheSet,
  cacheHas,
  cacheDelete,
  cacheClearAccount,
  TTL_5MIN_MS,
  TTL_30MIN_MS,
} from './elma-cache';

// Реэкспорт констант TTL для удобства
export {TTL_5MIN_MS, TTL_30MIN_MS};

/**
 * ООП-обёртка над функциональным in-memory кэшем.
 * Предоставляет методы-эквиваленты для инъекции в domain-сервисы.
 */
export class TtlCache {
  /**
   * Получить значение из кэша.
   * @returns значение или undefined, если ключ отсутствует или просрочен.
   */
  get<T>(accountId: string, key: string): T | undefined {
    return cacheGet<T>(accountId, key);
  }

  /**
   * Положить значение в кэш с указанным TTL.
   * @param ttlMs Время жизни в миллисекундах.
   */
  set<T>(accountId: string, key: string, value: T, ttlMs: number): void {
    cacheSet(accountId, key, value, ttlMs);
  }

  /**
   * Проверить наличие невышедшего кэша по ключу.
   */
  has(accountId: string, key: string): boolean {
    return cacheHas(accountId, key);
  }

  /**
   * Удалить конкретный ключ из кэша.
   */
  delete(accountId: string, key: string): void {
    cacheDelete(accountId, key);
  }

  /**
   * Удалить все ключи аккаунта (при выходе/смене аккаунта).
   */
  clearAccount(accountId: string): void {
    cacheClearAccount(accountId);
  }
}
