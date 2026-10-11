// ---------------------------------------------------------------------------
// Интерфейсы персистентности для инверсии зависимостей.
// Domain-сервисы зависят от этих интерфейсов, а не от конкретных zustand-сторов.
// Это позволяет тестировать сервисы с моками и заменять хранилища.
// ---------------------------------------------------------------------------

import {ElmaTask} from '../types/task';
import {ElmaAccount} from '../types/account';
import {FeedMessage, FeedChannel} from '../types/feed';
import {CollectionItem, CollectionKey} from '../types/customer-service';
import {ElmaRequestKind} from '../types/errors';

// ---------------------------------------------------------------------------
// TaskPersistence — персистентность задач
// ---------------------------------------------------------------------------

export interface TaskPersistence {
  /** Загрузить все задачи аккаунта */
  setTasks(accountId: string, tasks: ElmaTask[]): void;
  /** Добавить или обновить одну задачу */
  addOrUpdateTask(accountId: string, task: ElmaTask): void;
  /** Пометить успешную синхронизацию */
  markSyncSuccess(accountId: string): void;
  /** Пометить ошибку синхронизации */
  markSyncError(accountId: string, kind: ElmaRequestKind, msg: string): void;
}

// ---------------------------------------------------------------------------
// AccountPersistence — персистентность аккаунтов
// ---------------------------------------------------------------------------

export interface AccountPersistence {
  /** Обновить данные аккаунта (токен, cookie и т.д.) */
  updateAccount(accountId: string, data: Partial<ElmaAccount>): void;
}

// ---------------------------------------------------------------------------
// FeedPersistence — персистентность ленты
// ---------------------------------------------------------------------------

export interface FeedPersistence {
  /** Загрузить сообщения (с поддержкой append для пагинации) */
  setMessages(accountId: string, messages: FeedMessage[], append?: boolean): void;
  /** Загрузить каналы */
  setChannels(accountId: string, channels: FeedChannel[]): void;
  /** Установить количество непрочитанных */
  setUnreadCount(accountId: string, count: number): void;
  /** Установить флаг загрузки */
  setLoading(accountId: string, loading: boolean): void;
  /** Установить ошибку */
  setError(accountId: string, error: string | null): void;
  /** Установить текущий offset для пагинации */
  setOffset(accountId: string, offset: number): void;
  /** Установить флаг «есть ещё данные» */
  setHasMore(accountId: string, hasMore: boolean): void;
}

// ---------------------------------------------------------------------------
// CustomerServicePersistence — персистентность коллекций
// ---------------------------------------------------------------------------

export interface CustomerServicePersistence {
  /** Загрузить элементы коллекции */
  setItems(accountId: string, collection: CollectionKey, items: CollectionItem[]): void;
  /** Добавить элементы в конец коллекции (пагинация) */
  appendItems(accountId: string, collection: CollectionKey, items: CollectionItem[]): void;
  /** Получить текущие элементы коллекции */
  getItems(accountId: string, collection: CollectionKey): CollectionItem[];
  /** Установить статус загрузки коллекции */
  setCollectionStatus(
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
  ): void;
}
