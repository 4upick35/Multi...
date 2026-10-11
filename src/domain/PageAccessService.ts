// ---------------------------------------------------------------------------
// PageAccessService — доменный сервис проверки доступа к страницам портала.
// Инкапсулирует: загрузку страниц, проверку доступа, нормализацию namespace/code,
//   логику PORTAL_BASIC_PAGES для portal-пользователей.
// Зависит от интерфейсов персистентности (AccountPersistence)
// и API-слоя (elma-api) — НЕ от zustand-сторов напрямую.
// ---------------------------------------------------------------------------

import {ElmaAccount, PageAccess} from '../types/account';
import {AccountPersistence} from '../interfaces/persistence';
import {
  fetchPagesAccess as apiFetchPagesAccess,
} from '../services/elma-api';
import {ElmaRequestError, ElmaRequestKind} from '../types/errors';
import {persistUpdatedAccount} from './account-persistence';

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

/**
 * Базовые страницы портала, доступные мастеру (portal) по умолчанию.
 * Аналог PORTAL_BASIC_PAGES из App.tsx.
 */
const PORTAL_BASIC_PAGES = ['tasks', 'feed', 'cl_service'];

// ---------------------------------------------------------------------------
// Result-интерфейс
// ---------------------------------------------------------------------------

export interface PagesAccessResult {
  ok: boolean;
  pagesAccess?: PageAccess[];
  error?: string;
  kind?: ElmaRequestKind;
}

// ---------------------------------------------------------------------------
// PageAccessService
// ---------------------------------------------------------------------------

/**
 * Доменный сервис проверки доступа к страницам портала.
 *
 * Инкапсулирует бизнес-логику:
 * - Загрузку страниц портала и проверку доступа (fetchPagesAccess).
 * - Нормализацию namespace: поле → URL /_portal/([^/]+)/ → account.portal → 'customer_service'.
 * - Нормализацию code: поле → извлечение из URL.
 * - Логику PORTAL_BASIC_PAGES: для portal-пользователей базовые страницы
 *   (tasks, feed, cl_service) всегда доступны.
 * - Логику open-by-default: если ни у одного аккаунта нет pagesAccess — показываем всё.
 *
 * Использует AccountPersistence вместо прямого импорта auth-store.
 */
export class PageAccessService {
  constructor(
    private accountPersistence: AccountPersistence,
  ) {}

  // -----------------------------------------------------------------------
  // Публичные методы
  // -----------------------------------------------------------------------

  /**
   * Загрузить данные доступа ко всем страницам портала.
   * Оркестрирует fetchPortalPages + fetchPageConfigurationAccess для каждой страницы.
   * Нормализация namespace/code выполняется для каждой страницы.
   */
  async fetchPagesAccess(
    account: ElmaAccount,
  ): Promise<PagesAccessResult> {
    try {
      const result = await apiFetchPagesAccess(account);
      if (result.updatedAccount) {
        persistUpdatedAccount(this.accountPersistence, account.id, result.updatedAccount);
      }
      return {ok: true, pagesAccess: result.pagesAccess};
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = e instanceof ElmaRequestError ? e.kind : ('other' as ElmaRequestKind);
      return {ok: false, error: msg, kind};
    }
  }

  /**
   * Проверить доступ к конкретной странице портала.
   *
   * Логика (идентична hasPageAccess из App.tsx):
   * 1. Если у аккаунта нет pagesAccess — показываем всё (open-by-default).
   * 2. Для portal-пользователей базовые страницы (tasks, feed, cl_service)
   *    всегда доступны (серверная конфигурация ненадёжна).
   * 3. Ищем совпадение по code в pagesAccess.
   *
   * @param accounts — список аккаунтов (из useAuthStore)
   * @param activeAccountId — ID активного аккаунта ( может быть null)
   * @param pageCode — код страницы (tasks, feed, cl_service и т.д.)
   */
  hasPageAccess(
    accounts: ElmaAccount[],
    activeAccountId: string | null,
    pageCode: string,
  ): boolean {
    const pool = activeAccountId
      ? accounts.filter(a => a.id === activeAccountId)
      : accounts;
    if (pool.length === 0) {
      return true;
    }

    // Если ни у одного аккаунта нет pagesAccess — старый аккаунт, показываем всё
    const anyHasPagesAccess = pool.some(
      a => a.pagesAccess && a.pagesAccess.length > 0,
    );
    if (!anyHasPagesAccess) {
      return true;
    }

    return pool.some(a => {
      // Базовые страницы (tasks, feed, cl_service) доступны всем учёткам
      if (PORTAL_BASIC_PAGES.includes(pageCode)) {
        return true;
      }
      const pa = a.pagesAccess;
      if (!pa || pa.length === 0) {
        return true;
      }
      const match = pa.find(p => p.code === pageCode);
      return match ? match.isHaveAccess : false;
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton для использования в App.tsx (hasPageAccess — чистая функция,
// не требует реальной персистентности)
// ---------------------------------------------------------------------------

const noopPersistence: AccountPersistence = {
  updateAccount: () => {},
};

export const pageAccessService = new PageAccessService(noopPersistence);
