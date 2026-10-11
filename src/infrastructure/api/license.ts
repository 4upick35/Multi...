import {ElmaAccount} from '../../types/account';
import {ElmaRequestError} from '../../types/errors';
import {cacheGet, cacheSet, TTL_5MIN_MS} from '../elma-cache';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// #7 + #34: Feature flags — GET /api/settings/feature/list/enabled
// ---------------------------------------------------------------------------

const CACHE_KEY_FEATURE_FLAGS = 'featureFlags';

export type FeatureFlags = Record<string, boolean>;

/**
 * Получить список включённых фич (кэш TTL 5 мин).
 * Ответ — плоский объект {featureCode: boolean}.
 */
export async function fetchFeatureFlags(
  account: ElmaAccount,
): Promise<{flags: FeatureFlags; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<FeatureFlags>(account.id, CACHE_KEY_FEATURE_FLAGS);
  if (cached !== undefined) {
    return {flags: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/settings/feature/list/enabled',
    );
    const flags: FeatureFlags = (data as FeatureFlags) || {};
    cacheSet(account.id, CACHE_KEY_FEATURE_FLAGS, flags, TTL_5MIN_MS);
    return {flags, updatedAccount};
  } catch {
    // При ошибке — возвращаем пустой объект (все фичи «недоступны»,
    // вызывающий код решает сам, продолжать или нет)
    return {flags: {}};
  }
}

/**
 * Проверить, включена ли конкретная фича.
 * Если кэш пуст — загружает весь список и кэширует.
 */
export async function isFeatureEnabled(
  account: ElmaAccount,
  featureCode: string,
): Promise<boolean> {
  const {flags} = await fetchFeatureFlags(account);
  return Boolean(flags[featureCode]);
}

// ---------------------------------------------------------------------------
// #33: License info — GET /api/commerce/license
// ---------------------------------------------------------------------------

export interface LicenseInfo {
  tariff: {
    code: string;
    name: string;
    usersCount: number;
    cUsersCount: number;
    spaceInGB: number;
  };
  version: string;
  expireAt: string;
}

const CACHE_KEY_LICENSE_INFO = 'licenseInfo';

/**
 * Получить информацию о лицензии (кэш TTL 5 мин).
 */
export async function fetchLicenseInfo(
  account: ElmaAccount,
): Promise<{license: LicenseInfo | null; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<LicenseInfo>(account.id, CACHE_KEY_LICENSE_INFO);
  if (cached !== undefined) {
    return {license: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/commerce/license',
    );
    const raw = data as Record<string, unknown>;
    const tariff = (raw?.tariff || {}) as Record<string, unknown>;
    const license: LicenseInfo = {
      tariff: {
        code: String(tariff.code || ''),
        name: String(tariff.name || ''),
        usersCount: Number(tariff.usersCount || 0),
        cUsersCount: Number(tariff.cUsersCount || 0),
        spaceInGB: Number(tariff.spaceInGB || 0),
      },
      version: String(raw?.version || ''),
      expireAt: String(raw?.expire_at || ''),
    };
    cacheSet(account.id, CACHE_KEY_LICENSE_INFO, license, TTL_5MIN_MS);
    return {license, updatedAccount};
  } catch {
    return {license: null};
  }
}

// ---------------------------------------------------------------------------
// #34: License feature check — POST /api/commerce/license/features/check/current
// 204 = доступен, 412 = недоступен (штатно).
// Кэшируем результат (TTL 5 мин), чтобы не слать 66 запросов.
// ---------------------------------------------------------------------------

function cacheKeyLicenseFeature(featureCode: string): string {
  return `licenseFeature::${featureCode}`;
}

/**
 * Проверить доступность конкретной фичи лицензии (кэш TTL 5 мин).
 * 204 → true, 412 → false, ошибка → true (open-by-default).
 */
export async function checkLicenseFeature(
  account: ElmaAccount,
  featureCode: string,
): Promise<boolean> {
  const cacheKey = cacheKeyLicenseFeature(featureCode);
  const cached = cacheGet<boolean>(account.id, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await makeRequest(
      account,
      'post',
      '/api/commerce/license/features/check/current',
      {featureCode},
    );
    // 200/204 — фича доступна
    cacheSet(account.id, cacheKey, true, TTL_5MIN_MS);
    return true;
  } catch (e: unknown) {
    if (e instanceof ElmaRequestError && e.status === 412) {
      // 412 — штатное поведение: фича недоступна
      cacheSet(account.id, cacheKey, false, TTL_5MIN_MS);
      return false;
    }
    // Другие ошибки — open-by-default
    return true;
  }
}

// ---------------------------------------------------------------------------
// #17: GET /api/commerce/license/stores — license stores info
// ---------------------------------------------------------------------------

export interface LicenseStore {
  name: string;
  count: number;
  raw: Record<string, unknown>;
}

const CACHE_KEY_LICENSE_STORES = 'licenseStores';

export async function fetchLicenseStores(
  account: ElmaAccount,
): Promise<{stores: LicenseStore[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<LicenseStore[]>(account.id, CACHE_KEY_LICENSE_STORES);
  if (cached !== undefined) {
    return {stores: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/commerce/license/stores',
    );
    const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const stores: LicenseStore[] = items.map((s) => ({
      name: String(s.name || s.__name || ''),
      count: Number(s.count || 0),
      raw: s,
    }));
    cacheSet(account.id, CACHE_KEY_LICENSE_STORES, stores, TTL_5MIN_MS);
    return {stores, updatedAccount};
  } catch {
    return {stores: []};
  }
}
