import {ElmaAccount, PageAccess} from '../../types/account';
import {cacheGet, cacheSet, TTL_5MIN_MS} from '../elma-cache';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// Public API: fetchPortalPages — GET /api/pages
// ---------------------------------------------------------------------------

interface PortalPageRaw {
  __id?: string;
  name?: string;
  code?: string;
  namespace?: string;
  url?: string;
  type?: string;
  sort?: number;
  hidden?: boolean;
}

export async function fetchPortalPages(
  account: ElmaAccount,
): Promise<{pages: PortalPageRaw[]; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(account, 'get', '/api/pages');
    const resp = data as {result?: PortalPageRaw[]} | PortalPageRaw[] | undefined;
    const pages = Array.isArray(resp) ? resp : (resp?.result || []);
    return {pages, updatedAccount};
  } catch {
    return {pages: []};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchPageConfigurationAccess
//   GET /api/pages/{namespace}/{code}/configuration-access
//   Ответ: { isHaveAccess: boolean }
// ---------------------------------------------------------------------------

export async function fetchPageConfigurationAccess(
  account: ElmaAccount,
  namespace: string,
  code: string,
): Promise<{isHaveAccess: boolean; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/pages/${namespace}/${code}/configuration-access`,
    );
    const resp = data as {isHaveAccess?: boolean} | undefined;
    return {isHaveAccess: Boolean(resp?.isHaveAccess), updatedAccount};
  } catch {
    return {isHaveAccess: false};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchPagesAccess — batch check access for all portal pages
//   Uses fetchPortalPages + fetchPageConfigurationAccess per page.
//   Returns PageAccess[] with access flags.
//   Conservative: on any error, marks page as no-access.
// ---------------------------------------------------------------------------

export async function fetchPagesAccess(
  account: ElmaAccount,
): Promise<{pagesAccess: PageAccess[]; updatedAccount?: Partial<ElmaAccount>}> {
  const {pages, updatedAccount: pagesUpdated} = await fetchPortalPages(account);
  if (pages.length === 0) {
    return {pagesAccess: []};
  }

  const result: PageAccess[] = [];
  let currentAccount = {...account, ...pagesUpdated};

  for (const page of pages) {
    // Нормализация namespace: поле → URL → аккаунт → дефолт
    let ns = page.namespace || '';
    if (!ns && page.url) {
      const urlMatch = page.url.match(/\/_portal\/([^/]+)/);
      if (urlMatch) {
        ns = urlMatch[1];
      }
    }
    if (!ns) {
      ns = account.portal || 'customer_service';
    }
    // Нормализация code: поле → извлечение из URL
    let code = page.code || '';
    if (!code && page.url) {
      const parts = page.url.split('/');
      code = parts[parts.length - 1] || '';
    }
    if (!code) {
      continue; // без code запрос configuration-access невозможен
    }
    const {isHaveAccess, updatedAccount} = await fetchPageConfigurationAccess(
      currentAccount,
      ns,
      code,
    );
    if (updatedAccount) {
      currentAccount = {...currentAccount, ...updatedAccount};
    }
    result.push({
      namespace: ns,
      code,
      name: page.name || code,
      isHaveAccess,
    });
  }

  const finalUpdated: Partial<ElmaAccount> = {};
  if (pagesUpdated?.token) {
    finalUpdated.token = pagesUpdated.token;
  }
  if (pagesUpdated?.cookies) {
    finalUpdated.cookies = pagesUpdated.cookies;
  }
  if (currentAccount.cookies && currentAccount.cookies !== account.cookies) {
    finalUpdated.cookies = currentAccount.cookies;
  }

  return {
    pagesAccess: result,
    updatedAccount: Object.keys(finalUpdated).length ? finalUpdated : undefined,
  };
}

// ---------------------------------------------------------------------------
// #27: Portal status — GET /api/portal/status/{namespace}
// Оба эндпоинта: /api/portal/status/tasks и /api/portal/status/customer_service
// ---------------------------------------------------------------------------

interface PortalStatus {
  enabled: boolean;
  published: boolean;
}

function cacheKeyPortalStatus(namespace: string): string {
  return `portalStatus::${namespace}`;
}

/**
 * Проверить статус страницы портала (кэш TTL 5 мин).
 * @param namespace — 'tasks' | 'customer_service' и т.д.
 */
export async function fetchPortalStatus(
  account: ElmaAccount,
  namespace: string,
): Promise<{status: PortalStatus | null; updatedAccount?: Partial<ElmaAccount>}> {
  const cacheKey = cacheKeyPortalStatus(namespace);
  const cached = cacheGet<PortalStatus>(account.id, cacheKey);
  if (cached !== undefined) {
    return {status: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/portal/status/${namespace}`,
    );
    const status: PortalStatus = {
      enabled: Boolean((data as Record<string, unknown>)?.enabled),
      published: Boolean((data as Record<string, unknown>)?.published),
    };
    cacheSet(account.id, cacheKey, status, TTL_5MIN_MS);
    return {status, updatedAccount};
  } catch {
    return {status: null};
  }
}

/**
 * Проверить доступность страницы задач (namespace 'tasks').
 * Возвращает true, если enabled=true ИЛИ если не удалось проверить (open-by-default).
 */
export async function isPortalTasksAvailable(
  account: ElmaAccount,
): Promise<boolean> {
  const {status} = await fetchPortalStatus(account, 'tasks');
  if (status === null) {
    return true; // open-by-default при ошибке
  }
  return status.enabled;
}

/**
 * Проверить доступность сервисного портала (namespace 'customer_service').
 */
export async function isPortalCustomerServiceAvailable(
  account: ElmaAccount,
): Promise<boolean> {
  const {status} = await fetchPortalStatus(account, 'customer_service');
  if (status === null) {
    return true;
  }
  return status.enabled;
}

// ---------------------------------------------------------------------------
// #8: Portal list — GET /api/portal/list
// ---------------------------------------------------------------------------

export interface PortalListItem {
  namespace: string;
  loginTitle: string;
  published: boolean;
}

const CACHE_KEY_PORTAL_LIST = 'portalList';

/**
 * Получить список доступных порталов (кэш TTL 5 мин).
 */
export async function fetchPortalList(
  account: ElmaAccount,
): Promise<{portals: PortalListItem[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<PortalListItem[]>(account.id, CACHE_KEY_PORTAL_LIST);
  if (cached !== undefined) {
    return {portals: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/portal/list',
    );
    const portals: PortalListItem[] = Array.isArray(data)
      ? (data as PortalListItem[])
      : [];
    cacheSet(account.id, CACHE_KEY_PORTAL_LIST, portals, TTL_5MIN_MS);
    return {portals, updatedAccount};
  } catch {
    return {portals: []};
  }
}
