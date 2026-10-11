import {makeRequest} from './client';
import {ElmaAccount} from '../../types/account';
import {cacheGet, cacheSet, TTL_5MIN_MS} from '../elma-cache';

// ---------------------------------------------------------------------------
// #26: appeals/directories — GET /api/apps/customer_service/appeals/directories
// Иерархический справочник категорий обращений
// ---------------------------------------------------------------------------

export interface AppealsDirectoryItem {
  id: string;
  parent: string;
  level: number;
  name: string;
  sort: number;
  __deletedAt: string | null;
  __createdAt: string;
  __updatedAt: string;
  __createdBy: string;
  __updatedBy: string;
}

const CACHE_KEY_APPEALS_DIRS = 'appealsDirectories';

export async function fetchAppealsDirectories(
  account: ElmaAccount,
): Promise<{directories: AppealsDirectoryItem[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<AppealsDirectoryItem[]>(account.id, CACHE_KEY_APPEALS_DIRS);
  if (cached !== undefined) {
    return {directories: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/apps/customer_service/appeals/directories',
    );
    const directories: AppealsDirectoryItem[] = Array.isArray(data)
      ? (data as AppealsDirectoryItem[]).filter(d => !d.__deletedAt)
      : [];
    cacheSet(account.id, CACHE_KEY_APPEALS_DIRS, directories, TTL_5MIN_MS);
    return {directories, updatedAccount};
  } catch {
    return {directories: []};
  }
}

// ---------------------------------------------------------------------------
// #23: picasso — POST /api/picasso/entity/status
// Статус подписи документа
// ---------------------------------------------------------------------------

export interface PicassoSignStatus {
  signStatuses: {attributes: string} | null;
  userSignStatuses: {attributes: string} | null;
  signDate: string;
  lastSigners: unknown[] | null;
  signsCount: number;
}

export async function fetchPicassoEntityStatus(
  account: ElmaAccount,
  entityNamespace: string,
  entityCode: string,
  entityId: string,
): Promise<{status: PicassoSignStatus | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'post',
      '/api/picasso/entity/status',
      {
        namespace: entityNamespace,
        code: entityCode,
        id: entityId,
      },
    );
    return {status: (data as PicassoSignStatus) || null, updatedAccount};
  } catch {
    return {status: null};
  }
}

// ===========================================================================
// PHASE 5: Service integrations H4.7 #6/#11–#18
// ===========================================================================

// ---------------------------------------------------------------------------
// #6/#15: GET /api/apps — full collection metadata (~2.3 MB)
// In-memory cache only (no disk), TTL 5 min per account.
// ---------------------------------------------------------------------------

export interface AppFieldInfo {
  name: string;
  code: string;
  type: string;
  view?: Record<string, unknown>;
}

export interface AppCollectionInfo {
  currentUserPermissions: string[];
  accessType: string;
  xlanguage: string;
  __id: string;
  name: string;
  elementName: string;
  namespace: string;
  code: string;
  type: string;
  fields: AppFieldInfo[];
}

const CACHE_KEY_APPS_METADATA = 'appsMetadata';

export async function fetchAppsMetadata(
  account: ElmaAccount,
): Promise<{collections: AppCollectionInfo[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<AppCollectionInfo[]>(account.id, CACHE_KEY_APPS_METADATA);
  if (cached !== undefined) {
    return {collections: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/apps',
    );
    const collections: AppCollectionInfo[] = Array.isArray(data)
      ? (data as AppCollectionInfo[])
      : [];
    cacheSet(account.id, CACHE_KEY_APPS_METADATA, collections, TTL_5MIN_MS);
    return {collections, updatedAccount};
  } catch {
    return {collections: []};
  }
}

// ---------------------------------------------------------------------------
// #11: GET /api/settings/global/theme — UI theme (colors, logos, fonts)
// ---------------------------------------------------------------------------

export interface GlobalTheme {
  colors: Record<string, unknown>;
  logo: {fileId: string} | null;
  authLogo: {fileId: string} | null;
  gear: {fileId: string} | null;
  favicon: {fileId: string} | null;
  isVisibleHelp: boolean;
  fonts: Record<string, unknown>;
  raw: Record<string, unknown>;
}

const CACHE_KEY_GLOBAL_THEME = 'globalTheme';

export async function fetchGlobalTheme(
  account: ElmaAccount,
): Promise<{theme: GlobalTheme | null; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<GlobalTheme>(account.id, CACHE_KEY_GLOBAL_THEME);
  if (cached !== undefined) {
    return {theme: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/settings/global/theme',
    );
    const raw = (data as Record<string, unknown>) || {};
    const colors = (raw.colors || {}) as Record<string, unknown>;
    const logo = (raw.logo as {fileId: string} | undefined) || null;
    const authLogo = (raw.authLogo as {fileId: string} | undefined) || null;
    const gear = (raw.gear as {fileId: string} | undefined) || null;
    const favicon = (raw.favicon as {fileId: string} | undefined) || null;
    const isVisibleHelp = Boolean(raw.isVisibleHelp);
    const fonts = (raw.fonts || {}) as Record<string, unknown>;
    const theme: GlobalTheme = {
      colors,
      logo,
      authLogo,
      gear,
      favicon,
      isVisibleHelp,
      fonts,
      raw,
    };
    cacheSet(account.id, CACHE_KEY_GLOBAL_THEME, theme, TTL_5MIN_MS);
    return {theme, updatedAccount};
  } catch {
    return {theme: null};
  }
}

// ---------------------------------------------------------------------------
// #12: GET /api/exchangesrv/solutions — installed solutions/extensions
// ---------------------------------------------------------------------------

export interface Solution {
  name: string;
  alias: string;
  version: string;
  description: string;
  author: string;
  raw: Record<string, unknown>;
}

const CACHE_KEY_SOLUTIONS = 'solutions';

export async function fetchSolutions(
  account: ElmaAccount,
): Promise<{solutions: Solution[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<Solution[]>(account.id, CACHE_KEY_SOLUTIONS);
  if (cached !== undefined) {
    return {solutions: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/exchangesrv/solutions',
    );
    const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const solutions: Solution[] = items.map((s) => ({
      name: String(s.name || s.__name || ''),
      alias: String(s.alias || s.__id || ''),
      version: String(s.version || ''),
      description: String(s.description || ''),
      author: String(s.author || ''),
      raw: s,
    }));
    cacheSet(account.id, CACHE_KEY_SOLUTIONS, solutions, TTL_5MIN_MS);
    return {solutions, updatedAccount};
  } catch {
    return {solutions: []};
  }
}

// ---------------------------------------------------------------------------
// #13: GET /api/crm/task/available — CRM availability check
// ---------------------------------------------------------------------------

const CACHE_KEY_CRM_AVAILABLE = 'crmAvailable';

export async function fetchCrmAvailability(
  account: ElmaAccount,
): Promise<boolean> {
  const cached = cacheGet<boolean>(account.id, CACHE_KEY_CRM_AVAILABLE);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const {data} = await makeRequest(
      account,
      'get',
      '/api/crm/task/available',
    );
    const available = Boolean((data as Record<string, unknown>)?.available);
    cacheSet(account.id, CACHE_KEY_CRM_AVAILABLE, available, TTL_5MIN_MS);
    return available;
  } catch {
    cacheSet(account.id, CACHE_KEY_CRM_AVAILABLE, false, TTL_5MIN_MS);
    return false;
  }
}

// ---------------------------------------------------------------------------
// #14: GET /api/worker/extensions — installed extensions
// ---------------------------------------------------------------------------

export interface Extension {
  name: string;
  alias: string;
  version: string;
  raw: Record<string, unknown>;
}

const CACHE_KEY_EXTENSIONS = 'extensions';

export async function fetchExtensions(
  account: ElmaAccount,
): Promise<{extensions: Extension[]; updatedAccount?: Partial<ElmaAccount>}> {
  const cached = cacheGet<Extension[]>(account.id, CACHE_KEY_EXTENSIONS);
  if (cached !== undefined) {
    return {extensions: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/worker/extensions',
    );
    const items = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const extensions: Extension[] = items.map((e) => ({
      name: String(e.name || e.__name || ''),
      alias: String(e.alias || e.__id || ''),
      version: String(e.version || ''),
      raw: e,
    }));
    cacheSet(account.id, CACHE_KEY_EXTENSIONS, extensions, TTL_5MIN_MS);
    return {extensions, updatedAccount};
  } catch {
    return {extensions: []};
  }
}

// ---------------------------------------------------------------------------
// Метаданные приложения customer_service
// ---------------------------------------------------------------------------

export interface AppStatusDesc {
  id: number;
  code: string;
  name: string;
  color: string;
  isFinished: boolean;
}

export interface AppFieldMeta {
  code: string;
  type: string;
  array?: boolean;
  data?: {code: string; namespace: string};
  view?: {name: string};
}

/** Ответ GET /api/apps/customer_service/applications (метаданные приложения) */
export interface AppMetadataResponse {
  statuses?: AppStatusDesc[];
  fields?: AppFieldMeta[];
  [key: string]: unknown;
}

/**
 * Загрузить метаданные приложения customer_service.
 * GET /api/apps/customer_service/applications
 * Содержит массив описаний статусов и описание полей (включая SYS_COLLECTION).
 */
export async function fetchAppMetadata(
  account: ElmaAccount,
): Promise<{metadata: AppMetadataResponse | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/apps/customer_service/applications',
    );
    return {metadata: (data as AppMetadataResponse) || null, updatedAccount};
  } catch {
    return {metadata: null};
  }
}
