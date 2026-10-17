// ---------------------------------------------------------------------------
// Сервис метаданных приложения customer_service.
// Загружает и кэширует:
//   (а) маппинг id → {name, color} статусов
//   (б) маппинг code поля → {namespace, code} для полей SYS_COLLECTION
//   (в) резолв имён ссылочных полей по UUID
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {cacheGet, cacheSet, TTL_30MIN_MS} from '../infrastructure/elma-cache';
import {logDiag} from '../diag/accept-log';
import {
  fetchAppMetadata as apiFetchAppMetadata,
  fetchCollectionItemsByIds,
  fetchCollectionKeyFields,
  AppStatusDesc,
  AppFieldMeta,
} from './elma-api';

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export interface StatusInfo {
  name: string;
  color: string;
}

export interface FieldCollectionTarget {
  namespace: string;
  code: string;
}

// ---------------------------------------------------------------------------
// Ключи кэша
// ---------------------------------------------------------------------------

const CACHE_KEY_STATUS_MAP = 'app_metadata::statusMap';
const CACHE_KEY_FIELD_MAP = 'app_metadata::fieldCollectionMap';

// ---------------------------------------------------------------------------
// Загрузка и кэш маппинга статусов
// ---------------------------------------------------------------------------

/**
 * Получить маппинг id статуса → {name, color}.
 * Результат кэшируется на 30 минут.
 */
export async function getStatusMap(
  account: ElmaAccount,
): Promise<Map<number, StatusInfo>> {
  const cached = cacheGet<Map<number, StatusInfo>>(account.id, CACHE_KEY_STATUS_MAP);
  if (cached) {
    return cached;
  }

  const {metadata} = await apiFetchAppMetadata(account);
  const map = new Map<number, StatusInfo>();

  if (metadata) {
    // Пытаемся найти массив статусов по разным ключам
    const statusArr = findStatusArray(metadata);
    if (statusArr) {
      for (const s of statusArr) {
        if (typeof s.id === 'number' && s.name) {
          map.set(s.id, {name: s.name, color: s.color || ''});
        }
      }
    }
  }

  cacheSet(account.id, CACHE_KEY_STATUS_MAP, map, TTL_30MIN_MS);
  return map;
}

/**
 * Получить маппинг code поля → {namespace, code} целевой коллекции.
 * Результат кэшируется на 30 минут.
 */
export async function getFieldCollectionMap(
  account: ElmaAccount,
): Promise<Map<string, FieldCollectionTarget>> {
  const cached = cacheGet<Map<string, FieldCollectionTarget>>(account.id, CACHE_KEY_FIELD_MAP);
  if (cached) {
    return cached;
  }

  const {metadata} = await apiFetchAppMetadata(account);
  const map = new Map<string, FieldCollectionTarget>();

  if (metadata) {
    const fieldsArr = findFieldsArray(metadata);
    if (fieldsArr) {
      for (const f of fieldsArr) {
        if (
          f.type === 'SYS_COLLECTION' &&
          f.data?.namespace &&
          f.data?.code &&
          f.code
        ) {
          map.set(f.code, {namespace: f.data.namespace, code: f.data.code});
        }
      }
    }
  }

  cacheSet(account.id, CACHE_KEY_FIELD_MAP, map, TTL_30MIN_MS);
  return map;
}

/**
 * Резолв статуса по числовому id.
 * Если id не найден — возвращает null.
 */
export function resolveStatus(
  statusId: number | undefined | null,
  statusMap: Map<number, StatusInfo>,
): StatusInfo | null {
  if (statusId == null) {
    return null;
  }
  return statusMap.get(statusId) ?? null;
}

/**
 * Извлечь числовое id статуса из сырого объекта.
 * Поддерживает форматы: {status: 3}, {order:0, status:3}
 */
export function extractStatusId(raw: Record<string, unknown>): number | null {
  const s = raw.__status;
  if (s && typeof s === 'object') {
    const obj = s as Record<string, unknown>;
    if (typeof obj.status === 'number') {
      return obj.status;
    }
    // Формат {id: 3} — числовой id без ключа "status"
    if (typeof obj.id === 'number') {
      return obj.id;
    }
  }
  if (typeof s === 'number') {
    return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Резолв имён ссылочных полей
// ---------------------------------------------------------------------------

/**
 * Строки, похожие на UUID v4.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Проверить, является ли значение массивом UUID.
 */
export function isUuidArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.length > 0 && val.every(v => typeof v === 'string' && UUID_RE.test(v));
}

/**
 * Разрешить имена для ссылочных полей элемента.
 * Возвращает Map<fieldCode, displayString>.
 *
 * @param raw — сырой элемент
 * @param fieldCollectionMap — маппинг code → {namespace, code} из метаданных
 */
export async function resolveRefNames(
  account: ElmaAccount,
  raw: Record<string, unknown>,
  fieldCollectionMap: Map<string, FieldCollectionTarget>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();

  // Группируем UUIDы по целевой коллекции
  const byTarget = new Map<string, {fieldCodes: string[]; ids: string[]}>();

  for (const [fieldCode, target] of fieldCollectionMap) {
    const val = raw[fieldCode];
    // Массив UUID (ссылка-множество) либо одиночная ссылка (строка-UUID).
    const ids: string[] | null = isUuidArray(val)
      ? val
      : typeof val === 'string' && UUID_RE.test(val)
        ? [val]
        : null;
    if (!ids) {
      continue;
    }
    const key = `${target.namespace}/${target.code}`;
    let entry = byTarget.get(key);
    if (!entry) {
      entry = {fieldCodes: [], ids: []};
      byTarget.set(key, entry);
    }
    entry.fieldCodes.push(fieldCode);
    entry.ids.push(...ids);
  }

  // Запрашиваем имена для каждой целевой коллекции
  for (const [targetKey, entry] of byTarget) {
    const [namespace, code] = targetKey.split('/');
    const uniqueIds = [...new Set(entry.ids)];
    const cacheKey = `app_metadata::refNames::${targetKey}`;
    const cachedNames =
      cacheGet<Record<string, string>>(account.id, cacheKey) ?? {};
    const idToName: Record<string, string> = {...cachedNames};
    const missingIds = uniqueIds.filter(id => !(id in cachedNames));

    // Запрашиваем только те id, которых нет в кэше; если таких нет — без запроса.
    if (missingIds.length > 0) {
      const applyNames = (items: unknown[]): boolean => {
        let hasNew = false;
        for (const item of items) {
          const obj = item as Record<string, unknown>;
          const id = (obj.__id as string) || (obj.id as string);
          const name = (obj.__name as string) || (obj.name as string) || (obj.Name as string);
          if (id && name && !(id in idToName)) {
            idToName[id] = name;
            hasNew = true;
          }
        }
        return hasNew;
      };

      let hasNew = false;
      const negCacheKey = `app_metadata::keyfieldsNeg::${targetKey}`;
      const keyfieldsNeg = !!cacheGet<boolean>(account.id, negCacheKey);
      if (!keyfieldsNeg) {
        try {
          // keyfields отдаёт имена даже там, где items/list закрыт (403, например contracts).
          const keyItems = (await fetchCollectionKeyFields(account, namespace, code, missingIds)).items;
          hasNew = applyNames(keyItems);
        } catch {
          hasNew = false;
        }
        logDiag('refnames', `src=keyfields coll=${targetKey} new=${hasNew}`);
        if (!hasNew) {
          // Ключевой путь не даёт имён — на TTL запоминаем и уходим в items/list.
          cacheSet(account.id, negCacheKey, true, TTL_30MIN_MS);
        }
      }

      const stillMissing = missingIds.filter(id => !(id in idToName));
      if (stillMissing.length > 0) {
        logDiag(
          'refnames',
          `src=items/list coll=${targetKey} missing=${stillMissing.length}${keyfieldsNeg ? ' neg-cache' : ''}`,
        );
        try {
          hasNew =
            applyNames(
              (await fetchCollectionItemsByIds(account, namespace, code, stillMissing)).items,
            ) || hasNew;
        } catch {
          // При ошибке — не заполняем, поле останется пустым
        }
      }

      if (hasNew) {
        cacheSet(account.id, cacheKey, idToName, TTL_30MIN_MS);
      }
    }

    // Заполняем resolved для каждого поля
    for (const fieldCode of entry.fieldCodes) {
      const val = raw[fieldCode];
      if (Array.isArray(val)) {
        const names = val
          .map((id) => (typeof id === 'string' ? idToName[id] || null : null))
          .filter(Boolean);
        if (names.length > 0) {
          resolved.set(fieldCode, names.join(', '));
        }
      } else if (typeof val === 'string' && idToName[val]) {
        // Одиночная ссылка (строка-UUID)
        resolved.set(fieldCode, idToName[val]);
      }
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Вспомогательные функции поиска массивов в метаданных
// ---------------------------------------------------------------------------

/**
 * Найти массив статусов в ответе метаданных.
 * Основной путь в ELMA: `settings.status.items` (проверено на реальном ответе
 * GET /api/apps/customer_service/applications — 12 статусов вида
 * {id, code, name, color, isFinished}).
 * Фолбэк — рекурсивный поиск похожего массива.
 */
function findStatusArray(metadata: Record<string, unknown>): AppStatusDesc[] | null {
  const settings = metadata.settings as Record<string, unknown> | undefined;
  const status = settings?.status as Record<string, unknown> | undefined;
  if (Array.isArray(status?.items)) {
    return status.items as AppStatusDesc[];
  }
  return findStatusArrayDeep(metadata, 0);
}

/** Рекурсивный поиск массива статусов (элементы с id/name/isFinished). */
function findStatusArrayDeep(obj: unknown, depth: number): AppStatusDesc[] | null {
  if (depth > 4 || !obj || typeof obj !== 'object') {
    return null;
  }
  if (Array.isArray(obj)) {
    const first = obj[0];
    if (
      first &&
      typeof first === 'object' &&
      typeof (first as Record<string, unknown>).id === 'number' &&
      typeof (first as Record<string, unknown>).name === 'string' &&
      'isFinished' in (first as Record<string, unknown>)
    ) {
      return obj as AppStatusDesc[];
    }
    return null;
  }
  for (const val of Object.values(obj as Record<string, unknown>)) {
    const found = findStatusArrayDeep(val, depth + 1);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Найти массив полей в ответе метаданных.
 * Ищет по ключам, содержащим 'field' (в нижнем регистре).
 */
function findFieldsArray(metadata: Record<string, unknown>): AppFieldMeta[] | null {
  for (const key of Object.keys(metadata)) {
    if (key.toLowerCase().includes('field') && Array.isArray(metadata[key])) {
      return metadata[key] as AppFieldMeta[];
    }
  }
  for (const key of Object.keys(metadata)) {
    const val = metadata[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const k2 of Object.keys(val as Record<string, unknown>)) {
        if (k2.toLowerCase().includes('field') && Array.isArray((val as Record<string, unknown>)[k2])) {
          return (val as Record<string, unknown>)[k2] as AppFieldMeta[];
        }
      }
    }
  }
  return null;
}
