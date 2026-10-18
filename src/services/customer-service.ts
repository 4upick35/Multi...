// ---------------------------------------------------------------------------
// customer-service.ts — обёртка-делегат над domain/CustomerService.
// Сохраняет ВСЕ оригинальные экспорты для обратной совместимости.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {CollectionKey} from '../types/customer-service';
import type {CSRefreshResult} from '../domain/CustomerService';
import {customerService} from '../di/container';
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
