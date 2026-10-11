import {create} from 'zustand';
import {FeedMessage, FeedChannel} from '../types/feed';

export const EMPTY_FEED_MESSAGES: FeedMessage[] = [];
export const EMPTY_FEED_CHANNELS: FeedChannel[] = [];

interface FeedState {
  messagesByAccount: Record<string, FeedMessage[]>;
  channelsByAccount: Record<string, FeedChannel[]>;
  unreadCountByAccount: Record<string, number>;
  loadingByAccount: Record<string, boolean>;
  errorByAccount: Record<string, string | null>;
  offsetByAccount: Record<string, number>;
  hasMoreByAccount: Record<string, boolean>;

  setMessages: (accountId: string, messages: FeedMessage[], append: boolean) => void;
  setChannels: (accountId: string, channels: FeedChannel[]) => void;
  setUnreadCount: (accountId: string, count: number) => void;
  setLoading: (accountId: string, loading: boolean) => void;
  setError: (accountId: string, error: string | null) => void;
  setOffset: (accountId: string, offset: number) => void;
  setHasMore: (accountId: string, hasMore: boolean) => void;
  clearAccount: (accountId: string) => void;
  getMessages: (accountId: string) => FeedMessage[];
  getChannels: (accountId: string) => FeedChannel[];
  /** Добавить новые сообщения в начало списка (дедупликация по id) */
  prependMessages: (accountId: string, messages: FeedMessage[]) => void;
}

export const useFeedStore = create<FeedState>((set, get) => ({
  messagesByAccount: {},
  channelsByAccount: {},
  unreadCountByAccount: {},
  loadingByAccount: {},
  errorByAccount: {},
  offsetByAccount: {},
  hasMoreByAccount: {},

  setMessages: (accountId, messages, append) =>
    set((state) => {
      const existing = append ? state.messagesByAccount[accountId] || [] : [];
      return {
        messagesByAccount: {
          ...state.messagesByAccount,
          [accountId]: [...existing, ...messages],
        },
      };
    }),

  prependMessages: (accountId, newMessages) =>
    set((state) => {
      const existing = state.messagesByAccount[accountId] || [];
      const existingIds = new Set(existing.map((m) => m.id));
      const unique = newMessages.filter((m) => !existingIds.has(m.id));
      if (unique.length === 0) {
        return state;
      }
      return {
        messagesByAccount: {
          ...state.messagesByAccount,
          [accountId]: [...unique, ...existing],
        },
      };
    }),

  setChannels: (accountId, channels) =>
    set((state) => ({
      channelsByAccount: {...state.channelsByAccount, [accountId]: channels},
    })),

  setUnreadCount: (accountId, count) =>
    set((state) => ({
      unreadCountByAccount: {...state.unreadCountByAccount, [accountId]: count},
    })),

  setLoading: (accountId, loading) =>
    set((state) => ({
      loadingByAccount: {...state.loadingByAccount, [accountId]: loading},
    })),

  setError: (accountId, error) =>
    set((state) => ({
      errorByAccount: {...state.errorByAccount, [accountId]: error},
    })),

  setOffset: (accountId, offset) =>
    set((state) => ({
      offsetByAccount: {...state.offsetByAccount, [accountId]: offset},
    })),

  setHasMore: (accountId, hasMore) =>
    set((state) => ({
      hasMoreByAccount: {...state.hasMoreByAccount, [accountId]: hasMore},
    })),

  clearAccount: (accountId) =>
    set((state) => {
      const removeKey = <T,>(src: Record<string, T>): Record<string, T> => {
        const next = {...src};
        delete next[accountId];
        return next;
      };
      return {
        messagesByAccount: removeKey(state.messagesByAccount),
        channelsByAccount: removeKey(state.channelsByAccount),
        unreadCountByAccount: removeKey(state.unreadCountByAccount),
        loadingByAccount: removeKey(state.loadingByAccount),
        errorByAccount: removeKey(state.errorByAccount),
        offsetByAccount: removeKey(state.offsetByAccount),
        hasMoreByAccount: removeKey(state.hasMoreByAccount),
      };
    }),

  getMessages: (accountId) => get().messagesByAccount[accountId] || [],
  getChannels: (accountId) => get().channelsByAccount[accountId] || [],
}));
