// ---------------------------------------------------------------------------
// customer-service.ts — обёртка-делегат над domain/CustomerService.
// Сохраняет ВСЕ оригинальные экспорты для обратной совместимости.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {CollectionKey, CollectionItem} from '../types/customer-service';
import {useCustomerServiceStore} from '../store/customer-service-store';
import {useAuthStore} from '../store/auth-store';
import {CustomerService, CSRefreshResult} from '../domain/CustomerService';

// ---------------------------------------------------------------------------
// Адаптеры персистентности: подключаем zustand-сторы к доменному сервису
// ---------------------------------------------------------------------------

const csPersistence = {
  setItems: (accountId: string, collection: CollectionKey, items: CollectionItem[]) =>
    useCustomerServiceStore.getState().setItems(accountId, collection, items),
  appendItems: (accountId: string, collection: CollectionKey, items: CollectionItem[]) =>
    useCustomerServiceStore.getState().appendItems(accountId, collection, items),
  getItems: (accountId: string, collection: CollectionKey): CollectionItem[] =>
    useCustomerServiceStore.getState().getItems(accountId, collection),
  setCollectionStatus: (
    accountId: string,
    collection: CollectionKey,
    status: {
      status: 'idle' | 'loading' | 'ok' | 'error';
      error?: string;
      total?: number;
      loadedCount?: number;
      hasMore?: boolean;
      accessDenied?: boolean;
    },
  ) =>
    useCustomerServiceStore.getState().setCollectionStatus(accountId, collection, status),
};

const accountPersistence = {
  updateAccount: (accountId: string, data: Partial<ElmaAccount>) =>
    useAuthStore.getState().updateAccount(accountId, data),
};

// ---------------------------------------------------------------------------
// Singleton-экземпляр доменного сервиса
// ---------------------------------------------------------------------------

const customerService = new CustomerService(csPersistence, accountPersistence);

// ---------------------------------------------------------------------------
// Re-export типа (обратная совместимость)
// ---------------------------------------------------------------------------

export type {CSRefreshResult};

// ---------------------------------------------------------------------------
// Экспортируемые функции — делегируют в CustomerService
// ---------------------------------------------------------------------------

/**
 * Загрузить коллекцию (полный набор элементов).
 * Делегирует в CustomerService.loadCollection.
 */
export async function loadCollection(
  account: ElmaAccount,
  collection: CollectionKey,
): Promise<CSRefreshResult> {
  return customerService.loadCollection(account, collection);
}

/**
 * Загрузить следующую страницу коллекции (пагинация).
 * Делегирует в CustomerService.loadCollectionPage.
 */
export async function loadCollectionPage(
  account: ElmaAccount,
  collection: CollectionKey,
  offset: number,
): Promise<CSRefreshResult> {
  return customerService.loadCollectionPage(account, collection, offset);
}

/**
 * Поиск по коллекции (текстовый фильтр tf).
 * Делегирует в CustomerService.searchCollection.
 */
export async function searchCollection(
  account: ElmaAccount,
  collection: CollectionKey,
  searchText: string,
): Promise<CSRefreshResult> {
  return customerService.searchCollection(account, collection, searchText);
}

/**
 * Получить рабочий календарь.
 * Делегирует в CustomerService.getWorkCalendar.
 */
export async function getWorkCalendar(
  account: ElmaAccount,
): Promise<Record<string, unknown> | null> {
  return customerService.getWorkCalendar(account);
}

/**
 * Догрузить одну заявку по id и показать её в списке сразу (realtime).
 * Делегирует в CustomerService.insertApplicationById.
 */
export async function insertApplicationById(
  account: ElmaAccount,
  id: string,
): Promise<boolean> {
  return customerService.insertApplicationById(account, id);
}

export function markApplicationAccepted(accountId: string, applicationId: string): void {
  customerService.markApplicationAccepted(accountId, applicationId);
}
