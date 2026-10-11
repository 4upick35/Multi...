import AsyncStorage from '@react-native-async-storage/async-storage';
import {STORAGE_KEYS} from '../config/constants';
import type {AcceptTemplate} from '../infrastructure/api/bpm';

// In-memory кэш: accountId → AcceptTemplate
let memoryCache: Map<string, AcceptTemplate> | null = null;

/** Старые ключи хранилища были URL (baseUrl) — такие записи отбрасываются. */
function isLegacyUrlKey(key: string): boolean {
  return key.startsWith('http://') || key.startsWith('https://');
}

/**
 * Загрузить кэш из AsyncStorage в память (лениво, один раз).
 * Легаси-записи с ключом-URL отбрасываются, хранилище перезаписывается без них.
 */
async function ensureLoaded(): Promise<Map<string, AcceptTemplate>> {
  if (memoryCache !== null) {
    return memoryCache;
  }
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.acceptTemplates);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, AcceptTemplate>;
      const entries = Object.entries(parsed).filter(
        ([key]) => !isLegacyUrlKey(key),
      );
      memoryCache = new Map(entries);
      if (entries.length !== Object.keys(parsed).length) {
        // Разовая уборка легаси: перезаписываем хранилище без URL-ключей
        await persistToStorage();
      }
    } else {
      memoryCache = new Map();
    }
  } catch {
    memoryCache = new Map();
  }
  return memoryCache;
}

/**
 * Сохранить весь кэш из памяти в AsyncStorage.
 */
async function persistToStorage(): Promise<void> {
  if (!memoryCache) {
    return;
  }
  try {
    const obj: Record<string, AcceptTemplate> = {};
    for (const [key, value] of memoryCache) {
      obj[key] = value;
    }
    await AsyncStorage.setItem(STORAGE_KEYS.acceptTemplates, JSON.stringify(obj));
  } catch {
    // Тихо — кэш не должен ломать приём заявки
  }
}

/**
 * Получить кэшированный шаблон для данного accountId.
 */
export async function getCachedAcceptTemplate(
  accountId: string,
): Promise<AcceptTemplate | null> {
  const cache = await ensureLoaded();
  return cache.get(accountId) ?? null;
}

/**
 * Сохранить шаблон в кэш для данного accountId.
 */
export async function setCachedAcceptTemplate(
  accountId: string,
  template: AcceptTemplate,
): Promise<void> {
  const cache = await ensureLoaded();
  cache.set(accountId, template);
  await persistToStorage();
}

/**
 * Очистить весь кэш шаблонов (память + AsyncStorage).
 */
export async function clearAcceptTemplates(): Promise<void> {
  memoryCache = null;
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.acceptTemplates);
  } catch {
    // Тихо
  }
}

/**
 * Удалить только кэш шаблонов указанного аккаунта (память + AsyncStorage).
 * Остальные аккаунты не затрагиваются.
 */
export async function clearAcceptTemplatesForAccount(
  accountId: string,
): Promise<void> {
  const cache = await ensureLoaded();
  if (cache.delete(accountId)) {
    await persistToStorage();
  }
}
