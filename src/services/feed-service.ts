// ---------------------------------------------------------------------------
// feed-service.ts — обёртка-делегат над domain/FeedService.
// Сохраняет ВСЕ оригинальные экспорты для обратной совместимости.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {FeedMessage, FeedChannel} from '../types/feed';
import {useFeedStore} from '../store/feed-store';
import {useAuthStore} from '../store/auth-store';
import {FeedService, FeedRefreshResult} from '../domain/FeedService';

// ---------------------------------------------------------------------------
// Адаптеры персистентности: подключаем zustand-сторы к доменному сервису
// ---------------------------------------------------------------------------

const feedPersistence = {
  setMessages: (accountId: string, messages: FeedMessage[], append?: boolean) =>
    useFeedStore.getState().setMessages(accountId, messages, append ?? false),
  setChannels: (accountId: string, channels: FeedChannel[]) =>
    useFeedStore.getState().setChannels(accountId, channels),
  setUnreadCount: (accountId: string, count: number) =>
    useFeedStore.getState().setUnreadCount(accountId, count),
  setLoading: (accountId: string, loading: boolean) =>
    useFeedStore.getState().setLoading(accountId, loading),
  setError: (accountId: string, error: string | null) =>
    useFeedStore.getState().setError(accountId, error),
  setOffset: (accountId: string, offset: number) =>
    useFeedStore.getState().setOffset(accountId, offset),
  setHasMore: (accountId: string, hasMore: boolean) =>
    useFeedStore.getState().setHasMore(accountId, hasMore),
};

const accountPersistence = {
  updateAccount: (accountId: string, data: Partial<ElmaAccount>) =>
    useAuthStore.getState().updateAccount(accountId, data),
};

// ---------------------------------------------------------------------------
// Singleton-экземпляр доменного сервиса
// ---------------------------------------------------------------------------

const feedService = new FeedService(feedPersistence, accountPersistence);

// ---------------------------------------------------------------------------
// Re-export типа (обратная совместимость)
// ---------------------------------------------------------------------------

export type {FeedRefreshResult};

// ---------------------------------------------------------------------------
// Экспортируемые функции — делегируют в FeedService
// ---------------------------------------------------------------------------

/**
 * Загрузить сообщения ленты.
 * Делегирует в FeedService.loadMessages.
 */
export async function loadFeedMessages(
  account: ElmaAccount,
  offset: number = 0,
): Promise<FeedRefreshResult> {
  return feedService.loadMessages(account, offset);
}

/**
 * Загрузить активные каналы ленты.
 * Делегирует в FeedService.loadChannels.
 */
export async function loadFeedChannels(
  account: ElmaAccount,
): Promise<FeedRefreshResult> {
  return feedService.loadChannels(account);
}

/**
 * Загрузить количество непрочитанных сообщений.
 * Делегирует в FeedService.loadUnread.
 */
export async function loadFeedUnread(
  account: ElmaAccount,
): Promise<FeedRefreshResult> {
  return feedService.loadUnread(account);
}
