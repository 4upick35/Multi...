import {logDiag} from '../../diag/accept-log';
import {ElmaAccount} from '../../types/account';
import {maskValue} from '../../utils/mask';
import {cacheGet, cacheSet, TTL_5MIN_MS} from '../elma-cache';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// Public API: fetchCollectionItems — POST /api/apps/customer_service/{collection}/items/list
// ---------------------------------------------------------------------------

export async function fetchCollectionItems(
  account: ElmaAccount,
  collection: string,
  params?: {filter?: unknown; offset?: number; limit?: number; sortField?: string; ascending?: boolean},
): Promise<{items: unknown[]; total?: number; updatedAccount?: Partial<ElmaAccount>}> {
  const url = `/api/apps/customer_service/${collection}/items/list`;
  const body = {
    from: params?.offset ?? 0,
    size: params?.limit ?? 50,
    q: params?.filter ? JSON.stringify(params.filter) : '',
    withPermissions: true,
    sortField: params?.sortField ?? '__createdAt',
    ascending: params?.ascending ?? false,
    totalCountSetting: 'exact',
  };
  const {data, updatedAccount} = await makeRequest(account, 'post', url, body);
  const resp = data as {result?: unknown[]; total?: number} | undefined;
  return {items: resp?.result || [], total: resp?.total, updatedAccount};
}

// ---------------------------------------------------------------------------
// Public API: searchWorkerQuery — PUT /api/worker/query/customer_service/{entity}/search
// ---------------------------------------------------------------------------

const CACHE_KEY_SEARCH_WORKER_PREFIX = 'searchWorker::';

function searchWorkerCacheKey(accountId: string, entity: string, params?: {filter?: unknown; offset?: number; limit?: number; order?: Array<{field: string; ascend: boolean}>}): string {
  const paramsStr = params ? JSON.stringify(params) : '';
  return `${CACHE_KEY_SEARCH_WORKER_PREFIX}${entity}::${paramsStr.slice(0, 80)}`;
}

export async function searchWorkerQuery(
  account: ElmaAccount,
  entity: string,
  params?: {filter?: unknown; offset?: number; limit?: number; order?: Array<{field: string; ascend: boolean}>},
): Promise<{items: unknown[]; total?: number; updatedAccount?: Partial<ElmaAccount>}> {
  const cacheKey = searchWorkerCacheKey(account.id, entity, params);
  const cached = cacheGet<{items: unknown[]; total?: number}>(account.id, cacheKey);
  if (cached !== undefined) {
    return {items: cached.items, total: cached.total};
  }
  const url = `/api/worker/query/customer_service/${entity}/search`;
  const body: Record<string, unknown> = {
    filter: params?.filter ?? {and: []},
    offset: params?.offset ?? 0,
    limit: params?.limit ?? 50,
    order: params?.order ?? [{field: '__createdAt', ascend: false}],
  };
  const {data} = await makeRequest(account, 'put', url, body);
  const resp = data as {result?: unknown[]; items?: unknown[]; total?: number} | undefined;
  const result = {items: resp?.result || resp?.items || [], total: resp?.total};
  cacheSet(account.id, cacheKey, result, TTL_5MIN_MS);
  return result;
}

// ---------------------------------------------------------------------------
// Public API: fetchExecutorsByIds — PUT .../executors/by_ids
// Формат из HAR4 (H4.3.12):
//   Request:  {"ids":["UUID"],"active":false}
//   Response: [{__id, __name, email, phone, ...}] (массив напрямую)
// ---------------------------------------------------------------------------

export async function fetchExecutorsByIds(
  account: ElmaAccount,
  ids: string[],
): Promise<{executors: unknown[]; updatedAccount?: Partial<ElmaAccount>}> {
  if (ids.length === 0) {
    return {executors: []};
  }
  const url = '/api/worker/query/customer_service/executors/by_ids';
  const body = {ids, active: false};
  try {
    const {data, updatedAccount} = await makeRequest(account, 'put', url, body);
    // Ответ — массив напрямую (не {items:[]} и не {result:[]})
    const executors = Array.isArray(data) ? data : [];
    return {executors, updatedAccount};
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logDiag('elma-api', 'fetchExecutorsByIds error: ' + msg + ' ids=' + ids.map(id => maskValue(id)).join(', '));
    return {executors: []};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchUserProfile — GET /api/worker/users/{userId}
// ---------------------------------------------------------------------------

export async function fetchUserProfile(
  account: ElmaAccount,
): Promise<{profile: Record<string, unknown> | null; updatedAccount?: Partial<ElmaAccount>}> {
  if (!account.userId) {
    return {profile: null};
  }
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/worker/users/${account.userId}`,
    );
    return {profile: (data as Record<string, unknown>) || null, updatedAccount};
  } catch {
    return {profile: null};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchWorkerUser — GET /api/worker/users/{userId}
// ---------------------------------------------------------------------------

export async function fetchWorkerUser(
  account: ElmaAccount,
  userId: string,
): Promise<{user: Record<string, unknown> | null; updatedAccount?: Partial<ElmaAccount>}> {
  if (!userId) {
    return {user: null};
  }
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/worker/users/${userId}`,
    );
    return {user: (data as Record<string, unknown>) || null, updatedAccount};
  } catch {
    return {user: null};
  }
}

// ---------------------------------------------------------------------------
// User name cache — in-memory, per-process, TTL-based
// ---------------------------------------------------------------------------

const USER_NAME_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface UserNameCacheEntry {
  name: string;
  expiresAt: number;
}

// Key: `${accountId}::${guid}`
const userNameCache = new Map<string, UserNameCacheEntry>();

function userNameCacheGet(accountId: string, guid: string): string | undefined {
  const entry = userNameCache.get(`${accountId}::${guid}`);
  if (!entry) {
    return undefined;
  }
  if (Date.now() > entry.expiresAt) {
    userNameCache.delete(`${accountId}::${guid}`);
    return undefined;
  }
  return entry.name;
}

function userNameCacheSet(accountId: string, guid: string, name: string): void {
  userNameCache.set(`${accountId}::${guid}`, {
    name,
    expiresAt: Date.now() + USER_NAME_CACHE_TTL_MS,
  });
}

/**
 * Resolve a list of user GUIDs to human-readable names.
 * Uses in-memory cache and batch API (fetchExecutorsByIds) to minimize requests.
 * On failure — keeps the GUID as-is (does not throw).
 */
export async function resolveUserNames(
  account: ElmaAccount,
  userIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(id => id && id !== '00000000-0000-0000-0000-000000000000'))];
  const result = new Map<string, string>();

  // Separate already-cached from needing-resolve
  const toResolve: string[] = [];
  for (const uid of unique) {
    const cached = userNameCacheGet(account.id, uid);
    if (cached !== undefined) {
      result.set(uid, cached);
    } else {
      toResolve.push(uid);
    }
  }

  if (toResolve.length === 0) {
    return result;
  }

  // Batch resolve via fetchExecutorsByIds (one request for all)
  // Split into chunks of 20 to avoid oversized requests
  const CHUNK_SIZE = 20;
  for (let i = 0; i < toResolve.length; i += CHUNK_SIZE) {
    const chunk = toResolve.slice(i, i + CHUNK_SIZE);
    try {
      const {executors} = await fetchExecutorsByIds(account, chunk);
      const idToName = new Map<string, string>();
      for (const exec of executors) {
        const obj = exec as Record<string, unknown>;
        const id = (obj.__id as string) || (obj.id as string) || '';
        const name = (obj.__name as string) || (obj.name as string) || '';
        if (id && name) {
          idToName.set(id, name);
          userNameCacheSet(account.id, id, name);
        }
      }
      for (const uid of chunk) {
        const name = idToName.get(uid);
        if (name) {
          result.set(uid, name);
        }
      }
    } catch {
      for (const uid of chunk) {
        logDiag('elma-api', 'resolveUserNames: failed to resolve ' + maskValue(uid) + ' for account ' + maskValue(account.id));
      }
    }
      }

  return result;
}

// ===========================================================================
// PHASE 3: items-linked, field-permissions, appeals/directories, picasso, docflow
// ===========================================================================

// ---------------------------------------------------------------------------
// #24: items-linked — GET /api/processor/tasks/items-linked (cached TTL 5 min)
// Подзадачи/связанные задачи процесса
// ---------------------------------------------------------------------------

export interface LinkedTask {
  id: string;
  name: string;
  state: string;
  template: string;
  performers: string[];
  __parentId?: string | null;
}

const CACHE_KEY_ITEMS_LINKED_PREFIX = 'itemsLinked::';

export async function fetchItemsLinked(
  account: ElmaAccount,
  parentId: string,
  namespace: string = 'system',
  code: string = '_process_task',
  itemId?: string,
): Promise<{items: LinkedTask[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cacheKey = `${CACHE_KEY_ITEMS_LINKED_PREFIX}${parentId}`;
  const cached = cacheGet<{items: LinkedTask[]}>(account.id, cacheKey);
  if (cached !== undefined) {
    return {items: cached.items, updatedAccount: undefined};
  }
  const q = JSON.stringify({
    and: [
      {and: [{eq: [{field: '__deletedAt'}, {null: ''}]}, {eq: [{field: '__parentId'}, {const: parentId}]}]},
    ],
  });
  const params: Record<string, unknown> = {
    from: 0,
    size: 50,
    q,
    namespace,
    code,
    id: itemId || parentId,
    sortField: '__createdAt',
    ascending: false,
    noCount: true,
  };
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/processor/tasks/items-linked',
      undefined,
      params,
    );
    const resp = data as {result?: unknown[]; total?: number} | undefined;
    const rawItems = resp?.result || [];
    const items: LinkedTask[] = (rawItems as Record<string, unknown>[]).map(r => ({
      id: String(r.__id || r.id || ''),
      name: String(r.__name || r.name || ''),
      state: String(r.state || ''),
      template: String(r.template || r.templateNsAndCode || ''),
      performers: Array.isArray(r.performers) ? r.performers.map(String) : [],
      __parentId: r.__parentId as string | null | undefined,
    }));
    const result = {items, updatedAccount};
    cacheSet(account.id, cacheKey, result, TTL_5MIN_MS);
    return result;
  } catch {
    return {items: []};
  }
}

// ---------------------------------------------------------------------------
// #25: field-permissions — GET /api/apps/{ns}/{collection}/field-permissions
// Разрешения на поля коллекции. Ответ null = все поля доступны.
// Кэшируем TTL 5 мин на аккаунт.
// ---------------------------------------------------------------------------

export interface FieldPermissions {
  [field: string]: string[];
}

const CACHE_KEY_FIELD_PERMS_PREFIX = 'fieldPerms::';

export async function fetchFieldPermissions(
  account: ElmaAccount,
  namespace: string,
  collection: string,
): Promise<{permissions: FieldPermissions | null; updatedAccount?: Partial<ElmaAccount>}> {
  const cacheKey = `${CACHE_KEY_FIELD_PERMS_PREFIX}${namespace}::${collection}`;
  const cached = cacheGet<FieldPermissions | null>(account.id, cacheKey);
  if (cached !== undefined) {
    return {permissions: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/apps/${namespace}/${collection}/field-permissions`,
    );
    // Ответ null = все поля доступны (из HAR: response: null)
    const permissions: FieldPermissions | null = (data as FieldPermissions) || null;
    cacheSet(account.id, cacheKey, permissions, TTL_5MIN_MS);
    return {permissions, updatedAccount};
  } catch {
    // При ошибке — кэшируем null (open-by-default)
    cacheSet(account.id, cacheKey, null, TTL_5MIN_MS);
    return {permissions: null};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchCollectionItemsByIds — POST .../items/list по списку UUID
// ---------------------------------------------------------------------------

/**
 * Поиск заявки по номеру (__name) через items/list.
 * Сервер хранит __name с ведущим пробелом (например " 3303").
 * Сначала ищем с ведущим пробелом, затем без — если первый запрос вернул 0.
 */
export async function searchApplicationByNumber(
  account: ElmaAccount,
  number: string,
): Promise<{item: Record<string, unknown> | null; updatedAccount?: Partial<ElmaAccount>}> {
  const trimmed = number.trim();
  if (!trimmed) {
    return {item: null};
  }

  // Вариант 1: с ведущим пробелом (как хранит ELMA)
  const withSpace = ` ${trimmed}`;
  const qWithSpace = JSON.stringify({
    and: [{eq: [{field: '__name'}, {const: withSpace}]}],
  });

  try {
    const result = await fetchCollectionItems(account, 'applications', {
      filter: JSON.parse(qWithSpace),
      offset: 0,
      limit: 3,
      sortField: '__createdAt',
      ascending: false,
    });
    if (result.items.length > 0) {
      return {item: result.items[0] as Record<string, unknown>, updatedAccount: result.updatedAccount};
    }
  } catch {
    // При ошибке — пробуем без пробела
  }

  // Вариант 2: без ведущего пробела
  const qNoSpace = JSON.stringify({
    and: [{eq: [{field: '__name'}, {const: trimmed}]}],
  });

  try {
    const result = await fetchCollectionItems(account, 'applications', {
      filter: JSON.parse(qNoSpace),
      offset: 0,
      limit: 3,
      sortField: '__createdAt',
      ascending: false,
    });
    if (result.items.length > 0) {
      return {item: result.items[0] as Record<string, unknown>, updatedAccount: result.updatedAccount};
    }
  } catch {
    // Тихо — заявка не найдена
  }

  return {item: null};
}

/**
 * Загрузить элементы коллекции по списку UUID (для резолва имен ссылочных полей).
 * POST /api/apps/{namespace}/{code}/items/list
 */
export async function fetchCollectionItemsByIds(
  account: ElmaAccount,
  namespace: string,
  code: string,
  ids: string[],
): Promise<{items: unknown[]; updatedAccount?: Partial<ElmaAccount>}> {
  if (ids.length === 0) {
    return {items: []};
  }
  const url = `/api/apps/${namespace}/${code}/items/list`;
  const body = {
    from: 0,
    size: ids.length,
    q: JSON.stringify({and: [{in: [{field: '__id'}, {list: ids}]}]}),
    withPermissions: false,
    sortField: '__createdAt',
    ascending: false,
    totalCountSetting: 'exact',
  };
  try {
    const {data, updatedAccount} = await makeRequest(account, 'post', url, body);
    const resp = data as {result?: unknown[]; total?: number} | undefined;
    return {items: resp?.result || [], updatedAccount};
  } catch {
    return {items: []};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchCollectionKeyFields — POST .../items/keyfields
// Быстрый резолв отображаемых имён ссылок (__name) по списку UUID.
// Работает даже для коллекций, недоступных через items/list.
// ---------------------------------------------------------------------------

export async function fetchCollectionKeyFields(
  account: ElmaAccount,
  namespace: string,
  code: string,
  ids: string[],
): Promise<{items: unknown[]; updatedAccount?: Partial<ElmaAccount>}> {
  if (ids.length === 0) {
    return {items: []};
  }
  const url = `/api/apps/${namespace}/${code}/items/keyfields`;
  try {
    const {data, updatedAccount} = await makeRequest(account, 'post', url, {ids, active: false});
    const resp = data as {result?: unknown[]} | undefined;
    const arr = Array.isArray(data) ? data : (resp?.result || []);
    return {items: arr, updatedAccount};
  } catch {
    return {items: []};
  }
}
