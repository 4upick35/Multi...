// ---------------------------------------------------------------------------
// Seen application alerts — хранилище ключей «уже виденных» заявок.
// Ключи имеют вид `${accountId}::${itemId}`.
//
// ЕДИНЫЙ источник в памяти: все потребители (useApplicationAlerts, realtime)
// получают через loadSeenKeys() ОДИН И ТОТ ЖЕ экземпляр Set, поэтому пометка
// из realtime видна хуку и наоборот — без второго (дублирующего) уведомления.
// ---------------------------------------------------------------------------

import AsyncStorage from '@react-native-async-storage/async-storage';
import {STORAGE_KEYS} from '../config/constants';

/** Максимум хранимых ключей (старые отрезаются при сохранении). */
export const MAX_SEEN_KEYS = 500;

/** Общий кеш множества в памяти (null — ещё не загружен). */
let cache: Set<string> | null = null;

/** Общий промис первой загрузки: параллельные вызовы делят его, а не читают storage дважды. */
let loading: Promise<Set<string>> | null = null;

/** Прочитать ключи из AsyncStorage (ошибки глушатся → пустое множество). */
async function readSeenKeysFromStorage(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.seenApplicationAlerts);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      return new Set(arr);
    }
  } catch {
    // ignore
  }
  return new Set();
}

/**
 * Загрузить множество уже виденных ключей.
 * Возвращает ОБЩИЙ экземпляр Set (один и тот же объект при повторных вызовах),
 * параллельные первые вызовы делят один промис чтения.
 */
export function loadSeenKeys(): Promise<Set<string>> {
  if (cache !== null) {
    return Promise.resolve(cache);
  }
  if (loading === null) {
    loading = readSeenKeysFromStorage()
      .then((seen) => {
        loading = null;
        // Кеш мог быть уже записан (persistSeenKeys) во время чтения — не затираем.
        const current = cache === null ? seen : cache;
        cache = current;
        return current;
      })
      .catch(() => {
        loading = null;
        if (cache === null) {
          cache = new Set();
        }
        return cache;
      });
  }
  return loading;
}

/**
 * Сохранить множество ключей в AsyncStorage (с ограничением размера)
 * и сделать его общим кешем для последующих loadSeenKeys().
 * Ошибки не пробрасываются — хранилище не должно ломать хук.
 */
export function persistSeenKeys(seen: Set<string>): void {
  cache = seen;
  const arr = Array.from(seen).slice(-MAX_SEEN_KEYS);
  AsyncStorage.setItem(
    STORAGE_KEYS.seenApplicationAlerts,
    JSON.stringify(arr),
  ).catch(() => {});
}

/**
 * Пометить заявку как «уже уведомлённую» в общем множестве.
 * Best-effort: ошибки глушаются.
 */
export async function markSeenApplicationKey(
  accountId: string,
  id: string,
): Promise<void> {
  if (accountId === '' || id === '') {
    return;
  }
  try {
    const seen = await loadSeenKeys();
    seen.add(`${accountId}::${id}`);
    persistSeenKeys(seen);
  } catch {
    // best-effort: пометка не должна ломать вызывающий поток
  }
}

/**
 * Удалить только ключи указанного аккаунта (`${accountId}::…`),
 * остальные ключи сохранить. Работает с общим множеством.
 */
export async function clearSeenApplicationAlertsForAccount(
  accountId: string,
): Promise<void> {
  const seen = await loadSeenKeys();
  const prefix = `${accountId}::`;
  let changed = false;
  for (const key of Array.from(seen)) {
    if (key.startsWith(prefix)) {
      seen.delete(key);
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  // persistSeenKeys сам выставляет общий кеш и пишет storage с ограничением размера.
  persistSeenKeys(seen);
}
