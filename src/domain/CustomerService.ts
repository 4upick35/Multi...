// ---------------------------------------------------------------------------
// CustomerService — доменный сервис коллекций (загрузка, пагинация, поиск).
// Инкапсулирует: WORKER_QUERY_COLLECTIONS, маппинг сырых данных, персистентность.
// Зависит от интерфейсов персистентности (CustomerServicePersistence, AccountPersistence)
// и API-слоя (elma-api) — НЕ от zustand-сторов напрямую.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {
  CollectionKey,
  CollectionItem,
  LARGE_COLLECTIONS,
  DEFAULT_PAGE_SIZE,
  isWorkerQueryCollection,
} from '../types/customer-service';
import {
  CustomerServicePersistence,
  AccountPersistence,
} from '../interfaces/persistence';
import {
  fetchCollectionItems as apiFetchCollectionItems,
  fetchCollectionItemsByIds,
  searchWorkerQuery,
  fetchWorkCalendar,
  isPortalCustomerServiceAvailable,
} from '../services/elma-api';
import {ElmaRequestError, ElmaRequestKind} from '../types/errors';
import {
  getStatusMap,
  StatusInfo,
} from '../services/app-metadata';
import {logDiag} from '../diag/accept-log';
import {maskValue} from '../utils/mask';
import {recordBanSignal} from '../infrastructure/AccountThrottle';
import {persistUpdatedAccount} from './account-persistence';

// ---------------------------------------------------------------------------
// CSRefreshResult
// ---------------------------------------------------------------------------

export interface CSRefreshResult {
  ok: boolean;
  error?: string;
  kind?: ElmaRequestKind;
}

/**
 * Пустой ответ при непустом кэше показываем как «список пуст» только если он
 * повторяется долго. Бан ELMA (~5 минут) тоже отдаёт пустые списки, поэтому
 * считать попытки бессмысленно: отделяем бан от реально пустого списка по времени.
 */
const EMPTY_RESPONSE_ACCEPT_AFTER_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// CustomerService
// ---------------------------------------------------------------------------

/**
 * Доменный сервис коллекций (обращения, заявки, справочники).
 *
 * Инкапсулирует бизнес-логику: загрузку, пагинацию и поиск по коллекциям.
 * Определяет маршрут запроса (items/list vs worker/query) через
 * WORKER_QUERY_COLLECTIONS / isWorkerQueryCollection.
 *
 * Использует CustomerServicePersistence вместо прямого импорта customer-service-store.
 * Использует AccountPersistence вместо прямого импорта auth-store.
 */
export class CustomerService {
  /**
   * Серия пустых ответов по «account::collection»: сколько раз подряд и когда
   * началась. Пока серия моложе EMPTY_RESPONSE_ACCEPT_AFTER_MS, данные не стираем.
   */
  private emptyStreak = new Map<string, {count: number; firstAt: number}>();

  constructor(
    private csPersistence: CustomerServicePersistence,
    private accountPersistence: AccountPersistence,
  ) {}

  // -----------------------------------------------------------------------
  // Публичные методы
  // -----------------------------------------------------------------------

  /**
   * Загрузить коллекцию (полный набор элементов).
   * Порядок operations идентичен оригиналу из customer-service.ts.
   */
  async loadCollection(
    account: ElmaAccount,
    collection: CollectionKey,
  ): Promise<CSRefreshResult> {
    try {
      // #27: Проверяем доступность сервисного портала перед запросом
      const csAvailable = await isPortalCustomerServiceAvailable(account);
      if (!csAvailable) {
        // Портал недоступен (в том числе временно): уже загруженный список НЕ стираем.
        this.csPersistence.setCollectionStatus(account.id, collection, {status: 'ok'});
        return {ok: true};
      }

      let items: unknown[] = [];
      let total = 0;

      // Определяем размер страницы: для больших коллекций — 50, для остальных — 10000
      const isLarge = collection in LARGE_COLLECTIONS;
      const pageSize = isLarge || collection === 'applications' ? DEFAULT_PAGE_SIZE : 10000;

      // Articles: кастомный фильтр для публичных статей, сортировка по просмотрам
      if (collection === 'articles') {
        const result = await apiFetchCollectionItems(account, collection, {
          filter: {and: [{eq: [{field: 'public_article'}, {const: true}]}]},
          offset: 0,
          limit: pageSize,
          sortField: 'number_of_views',
          ascending: false,
        });
        items = result.items;
        total = result.total ?? items.length;
        persistUpdatedAccount(this.accountPersistence, account.id, result.updatedAccount);
      } else if (collection === 'news') {
        const qr = await searchWorkerQuery(account, collection, {
          filter: {
            and: [
              {
                and: [
                  {eq: [{field: '__deletedAt'}, null]},
                  {eq: [{field: 'published'}, {const: true}]},
                ],
              },
            ],
          },
          offset: 0,
          limit: pageSize,
          order: [{field: '__createdAt', ascend: false}],
        });
        items = qr.items;
        total = qr.total ?? items.length;
        persistUpdatedAccount(this.accountPersistence, account.id, qr.updatedAccount);
      } else if (isWorkerQueryCollection(collection)) {
        // Worker/query коллекции — общий путь
        const qr = await searchWorkerQuery(account, collection, {
          filter: {
            and: [{and: [{eq: [{field: '__deletedAt'}, null]}]}],
          },
          offset: 0,
          limit: pageSize,
          order: [{field: '__createdAt', ascend: false}],
        });
        items = qr.items;
        total = qr.total ?? items.length;
        persistUpdatedAccount(this.accountPersistence, account.id, qr.updatedAccount);
      } else {
        // items/list коллекции — дефолтный путь
        // Для applications фильтр {and:[{tf:{}}]} (как в HAR), для остальных — без фильтра
        const filter = collection === 'applications' ? {and: [{tf: {}}]} : undefined;
        const result = await apiFetchCollectionItems(account, collection, {
          filter,
          offset: 0,
          limit: pageSize,
        });
        items = result.items;
        total = result.total ?? items.length;
        persistUpdatedAccount(this.accountPersistence, account.id, result.updatedAccount);
      }

      // Загружаем маппинг статусов для резолва числовых id
      const statusMap = collection === 'applications'
        ? await getStatusMap(account)
        : new Map<number, StatusInfo>();

      const mapped = (items as Record<string, unknown>[]).map(raw => rawToItem(raw, account.id, statusMap));
      logDiag(
        'CustomerService',
        'loadCollection ' + collection +
          ' acct=' + maskValue(account.id) +
          ' raw=' + items.length + ' mapped=' + mapped.length + ' total=' + total,
      );

      // Сервер ELMA при бане за частые/странные запросы отвечает 200 с пустым списком.
      // Пустой ответ при непустом кэше считаем подозрительным и НЕ стираем данные.
      const cachedCount = (this.csPersistence.getItems(account.id, collection) || []).length;
      const streakKey = account.id + '::' + collection;
      if (mapped.length === 0 && cachedCount > 0) {
        const emptyNow = Date.now();
        const prev = this.emptyStreak.get(streakKey);
        const streak = {count: (prev?.count ?? 0) + 1, firstAt: prev?.firstAt ?? emptyNow};
        this.emptyStreak.set(streakKey, streak);
        const elapsed = emptyNow - streak.firstAt;
        if (elapsed < EMPTY_RESPONSE_ACCEPT_AFTER_MS) {
          logDiag(
            'applications-sync',
            'empty-response account=' + account.id + ' collection=' + collection +
              ' cached=' + cachedCount + ' streak=' + streak.count + ' elapsed=' + elapsed + ' kept=true',
          );
          this.csPersistence.setCollectionStatus(account.id, collection, {
            status: 'error',
            error: 'empty-response',
          });
          recordBanSignal(account.id, 'empty-response');
          return {ok: false, error: 'empty-response', kind: 'other' as ElmaRequestKind};
        }
        logDiag(
          'applications-sync',
          'empty-response accepted account=' + account.id + ' collection=' + collection +
            ' streak=' + streak.count + ' elapsed=' + elapsed,
        );
      } else {
        this.emptyStreak.delete(streakKey);
      }

      this.csPersistence.setItems(account.id, collection, mapped);
      this.csPersistence.setCollectionStatus(account.id, collection, {
        status: 'ok',
        total,
        loadedCount: mapped.length,
        hasMore: mapped.length < total,
      });
      return {ok: true};
    } catch (e: unknown) {
      return this.handleCSError(e, account.id, collection);
    }
  }

  /**
   * Догрузить одну заявку по id и положить её в начало списка.
   * Нужно для realtime: новая заявка появляется в списке сразу,
   * не дожидаясь ближайшего полного опроса.
   */
  async insertApplicationById(account: ElmaAccount, id: string): Promise<boolean> {
    try {
      const {items, updatedAccount} = await fetchCollectionItemsByIds(
        account,
        'customer_service',
        'applications',
        [id],
      );
      if (items.length === 0) {
        logDiag('applications-sync', 'insert-app miss account=' + maskValue(account.id) + ' id=' + id);
        return false;
      }
      persistUpdatedAccount(this.accountPersistence, account.id, updatedAccount);
      const statusMap = await getStatusMap(account);
      const mapped = (items as Record<string, unknown>[]).map(raw => rawToItem(raw, account.id, statusMap));
      const current = this.csPersistence.getItems(account.id, 'applications') || [];
      const incoming = new Set(mapped.map(item => item.id));
      const merged = [...mapped, ...current.filter(item => !incoming.has(item.id))];
      this.csPersistence.setItems(account.id, 'applications', merged);
      logDiag('applications-sync', `insert-app ok account=${maskValue(account.id)} id=${id} size=${merged.length}`);
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logDiag('applications-sync', 'insert-app error id=' + id + ' ' + msg);
      return false;
    }
  }

  /**
   * Загрузить следующую страницу коллекции (пагинация).
   */
  async loadCollectionPage(
    account: ElmaAccount,
    collection: CollectionKey,
    offset: number,
  ): Promise<CSRefreshResult> {
    try {
      const csAvailable = await isPortalCustomerServiceAvailable(account);
      if (!csAvailable) {
        return {ok: true};
      }

      const pageSize = DEFAULT_PAGE_SIZE;
      let items: unknown[] = [];
      let total = 0;

      if (isWorkerQueryCollection(collection)) {
        // Worker/query коллекции
        const qr = await searchWorkerQuery(account, collection, {
          filter: {
            and: [{and: [{eq: [{field: '__deletedAt'}, null]}]}],
          },
          offset,
          limit: pageSize,
          order: [{field: '__createdAt', ascend: false}],
        });
        items = qr.items;
        total = qr.total ?? 0;
        persistUpdatedAccount(this.accountPersistence, account.id, qr.updatedAccount);
      } else {
        // items/list коллекции (включая applications)
        const filter = collection === 'applications' ? {and: [{tf: {}}]} : undefined;
        const result = await apiFetchCollectionItems(account, collection, {
          filter,
          offset,
          limit: pageSize,
        });
        items = result.items;
        total = result.total ?? 0;
        persistUpdatedAccount(this.accountPersistence, account.id, result.updatedAccount);
      }

      // Загружаем маппинг статусов для резолва числовых id
      const statusMap = collection === 'applications'
        ? await getStatusMap(account)
        : new Map<number, StatusInfo>();

      const mapped = (items as Record<string, unknown>[]).map(raw => rawToItem(raw, account.id, statusMap));
      this.csPersistence.appendItems(account.id, collection, mapped);
      const currentItems = this.csPersistence.getItems(account.id, collection);
      this.csPersistence.setCollectionStatus(account.id, collection, {
        status: 'ok',
        total,
        loadedCount: currentItems.length,
        hasMore: currentItems.length < total,
      });
      return {ok: true};
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = e instanceof ElmaRequestError ? e.kind : ('other' as ElmaRequestKind);
      const status = e instanceof ElmaRequestError ? e.status : undefined;
      if (status === 403 || kind === 'unauthorized') {
        const cached = this.csPersistence.getItems(account.id, collection) || [];
        if (cached.length === 0) {
          this.csPersistence.setCollectionStatus(account.id, collection, {status: 'ok', accessDenied: true});
        } else {
          this.csPersistence.setCollectionStatus(account.id, collection, {status: 'error', error: msg});
        }
        return {ok: false, error: msg, kind};
      }
      return {ok: false, error: msg, kind};
    }
  }

  /**
   * Поиск по коллекции (текстовый фильтр tf).
   */
  async searchCollection(
    account: ElmaAccount,
    collection: CollectionKey,
    searchText: string,
  ): Promise<CSRefreshResult> {
    try {
      const csAvailable = await isPortalCustomerServiceAvailable(account);
      if (!csAvailable) {
        // Портал недоступен (в том числе временно): уже загруженный список НЕ стираем.
        this.csPersistence.setCollectionStatus(account.id, collection, {status: 'ok'});
        return {ok: true};
      }

      const pageSize = 200;
      let items: unknown[] = [];

      // EQL tf-фильтр для текстового поиска
      const tfFilter = searchText.trim()
        ? {and: [{and: [{eq: [{field: '__deletedAt'}, null]}, {tf: {}}]}]}
        : {and: [{and: [{eq: [{field: '__deletedAt'}, null]}]}]};

      if (isWorkerQueryCollection(collection)) {
        const qr = await searchWorkerQuery(account, collection, {
          filter: tfFilter,
          offset: 0,
          limit: pageSize,
          order: [{field: '__createdAt', ascend: false}],
        });
        items = qr.items;
        persistUpdatedAccount(this.accountPersistence, account.id, qr.updatedAccount);
      } else {
        const result = await apiFetchCollectionItems(account, collection, {
          filter: tfFilter,
          offset: 0,
          limit: pageSize,
        });
        items = result.items;
        persistUpdatedAccount(this.accountPersistence, account.id, result.updatedAccount);
      }

      // Загружаем маппинг статусов для резолва числовых id
      const statusMap = collection === 'applications'
        ? await getStatusMap(account)
        : new Map<number, StatusInfo>();

      const mapped = (items as Record<string, unknown>[]).map(raw => rawToItem(raw, account.id, statusMap));
      this.csPersistence.setItems(account.id, collection, mapped);
      this.csPersistence.setCollectionStatus(account.id, collection, {status: 'ok'});
      return {ok: true};
    } catch (e: unknown) {
      return this.handleCSError(e, account.id, collection);
    }
  }

  /**
   * Получить рабочий календарь.
   */
  async getWorkCalendar(
    account: ElmaAccount,
  ): Promise<Record<string, unknown> | null> {
    try {
      const result = await fetchWorkCalendar(account);
      if (result.updatedAccount) {
        persistUpdatedAccount(this.accountPersistence, account.id, result.updatedAccount);
      }
      return result.calendar;
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Приватные методы
  // -----------------------------------------------------------------------

  /**
   * Обработать ошибку коллекции (дублированная логика для loadCollection/searchCollection).
   */
  private handleCSError(
    e: unknown,
    accountId: string,
    collection: CollectionKey,
  ): CSRefreshResult {
    const msg = e instanceof Error ? e.message : String(e);
    const kind = e instanceof ElmaRequestError ? e.kind : ('other' as ElmaRequestKind);
    const status = e instanceof ElmaRequestError ? e.status : undefined;
    // 403 Forbidden — нет доступа к коллекции, помечаем accessDenied
    if (status === 403 || kind === 'unauthorized') {
      // Временная потеря сессии/доступа: если список уже загружен — сохраняем его,
      // а если показывать нечего — помечаем коллекцию как недоступную.
      const cached = this.csPersistence.getItems(accountId, collection) || [];
      if (cached.length === 0) {
        this.csPersistence.setCollectionStatus(accountId, collection, {status: 'ok', accessDenied: true});
      } else {
        this.csPersistence.setCollectionStatus(accountId, collection, {status: 'error', error: msg});
      }
      return {ok: false, error: msg, kind};
    }
    // Временные сбои (429/503, таймаут, сеть) — это не ошибка данных:
    // уже загруженный список оставляем как есть и технический текст не показываем.
    // Повтор произойдёт автоматически (applications-sync) — список НЕ помечаем ошибкой.
    if (kind === 'rate' || kind === 'timeout' || kind === 'network') {
      logDiag('CustomerService', 'transient ' + kind + ' error ignored for status: ' + msg);
      return {ok: false, error: msg, kind};
    }
    this.csPersistence.setCollectionStatus(accountId, collection, {
      status: 'error',
      error: msg,
    });
    return {ok: false, error: msg, kind};
  }
}

// ---------------------------------------------------------------------------
// Маппинг сырых данных ELMA → доменные модели
// ---------------------------------------------------------------------------

/** Толерантное извлечение имени из сырого объекта */
function extractName(raw: Record<string, unknown>): string {
  return (
    (raw.__name as string) ||
    (raw.name as string) ||
    (raw.Name as string) ||
    ''
  );
}

/** Толерантное извлечение статуса из сырого объекта */
function extractStatus(raw: Record<string, unknown>, statusMap?: Map<number, StatusInfo>): {name: string; color: string} {
  const state = raw.__status;
  if (state && typeof state === 'object') {
    const obj = state as Record<string, unknown>;
    // Формат {order:0, status:3} — числовой id статуса
    if (typeof obj.status === 'number' && statusMap) {
      const info = statusMap.get(obj.status);
      if (info) {
        return {name: info.name, color: info.color};
      }
      return {name: '', color: ''};
    }
    // Формат {id: 3} — числовой id без ключа "status"
    if (typeof obj.id === 'number' && statusMap) {
      const info = statusMap.get(obj.id);
      if (info) {
        return {name: info.name, color: info.color};
      }
      return {name: '', color: ''};
    }
    // Формат {name:'В работе'} или {Name:'Новая'}
    const name = (obj.name as string) || (obj.Name as string) || '';
    if (name) {
      return {name, color: ''};
    }
    return {name: String(state), color: ''};
  }
  if (typeof state === 'string') {
    return {name: state, color: ''};
  }
  const alt = raw.state;
  if (alt && typeof alt === 'object') {
    const obj = alt as Record<string, unknown>;
    const name = (obj.name as string) || (obj.Name as string) || '';
    if (name) {
      return {name, color: ''};
    }
    return {name: String(alt), color: ''};
  }
  if (typeof alt === 'string') {
    return {name: alt, color: ''};
  }
  return {name: '', color: ''};
}

/** Толерантное извлечение даты создания из сырого объекта */
function extractCreatedAt(raw: Record<string, unknown>): string {
  return (raw.__createdAt as string) || (raw.createdAt as string) || '';
}

/**
 * Маппинг сырого объекта ELMA в доменную модель CollectionItem.
 */
function rawToItem(raw: Record<string, unknown>, accountId?: string, statusMap?: Map<number, StatusInfo>): CollectionItem {
  const id = (raw.__id as string) || (raw.id as string) || String(Math.random());
  const statusInfo = extractStatus(raw, statusMap);
  return {
    id,
    name: extractName(raw),
    status: statusInfo.name,
    statusColor: statusInfo.color || undefined,
    createdAt: extractCreatedAt(raw),
    accountId,
    raw,
  };
}
