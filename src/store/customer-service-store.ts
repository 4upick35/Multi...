import {create} from 'zustand';
import {CollectionKey, CollectionItem} from '../types/customer-service';

// ---------------------------------------------------------------------------
// Sync state per collection per account
// ---------------------------------------------------------------------------

export type CSStatus = 'idle' | 'loading' | 'ok' | 'error';

export interface CollectionSyncState {
  status: CSStatus;
  error?: string;
  total?: number;
  hasMore?: boolean;
  loadedCount?: number;
  accessDenied?: boolean;
}

const emptyCollectionState = (): CollectionSyncState => ({status: 'idle'});

export const EMPTY_COLLECTION_ITEMS: CollectionItem[] = [];

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface CSState {
  itemsByAccount: Record<string, Record<CollectionKey, CollectionItem[]>>;
  syncStates: Record<string, Record<CollectionKey, CollectionSyncState>>;
  lastRefreshAt: Record<string, number>;

  setItems: (accountId: string, collection: CollectionKey, items: CollectionItem[]) => void;
  appendItems: (accountId: string, collection: CollectionKey, items: CollectionItem[]) => void;
  setCollectionStatus: (
    accountId: string,
    collection: CollectionKey,
    partial: Partial<CollectionSyncState>,
  ) => void;
  getItems: (accountId: string, collection: CollectionKey) => CollectionItem[];
  getCollectionStatus: (accountId: string, collection: CollectionKey) => CollectionSyncState;
  clearAccount: (accountId: string) => void;
  setLastRefreshAt: (accountId: string, ts: number) => void;
}

export const useCustomerServiceStore = create<CSState>((set, get) => ({
  itemsByAccount: {},
  syncStates: {} as Record<string, Record<CollectionKey, CollectionSyncState>>,
  lastRefreshAt: {},

  setItems: (accountId, collection, items) =>
    set((state) => {
      const safeItems = items.filter((it) => !it.accountId || it.accountId === accountId);
      const accountData = state.itemsByAccount[accountId] || ({} as Record<CollectionKey, CollectionItem[]>);
      return {
        itemsByAccount: {
          ...state.itemsByAccount,
          [accountId]: {...accountData, [collection]: safeItems},
        },
      };
    }),

  appendItems: (accountId, collection, items) =>
    set((state) => {
      const safeItems = items.filter((it) => !it.accountId || it.accountId === accountId);
      const accountData = state.itemsByAccount[accountId] || ({} as Record<CollectionKey, CollectionItem[]>);
      const existing = accountData[collection] || [];
      return {
        itemsByAccount: {
          ...state.itemsByAccount,
          [accountId]: {...accountData, [collection]: [...existing, ...safeItems]},
        },
      };
    }),

  setCollectionStatus: (accountId, collection, partial) =>
    set((state) => {
      const accountStates = state.syncStates[accountId] || ({} as Record<CollectionKey, CollectionSyncState>);
      const prev = accountStates[collection] || emptyCollectionState();
      return {
        syncStates: {
          ...state.syncStates,
          [accountId]: {
            ...accountStates,
            [collection]: {
              ...prev,
              ...partial,
              // При успешной загрузке сбрасываем accessDenied, только если он не задан явно
              ...(partial.status === 'ok' && !('accessDenied' in partial)
                ? {accessDenied: false}
                : {}),
            },
          },
        },
      };
    }),

  getItems: (accountId, collection) => {
    const state = get();
    const accountData = state.itemsByAccount[accountId];
    return accountData?.[collection] || [];
  },

  getCollectionStatus: (accountId, collection) => {
    const state = get();
    const accountStates = state.syncStates[accountId];
    return accountStates?.[collection] || emptyCollectionState();
  },

  clearAccount: (accountId) =>
    set((state) => {
      const removeKey = <T,>(src: Record<string, T>): Record<string, T> => {
        const next = {...src};
        delete next[accountId];
        return next;
      };
      return {
        itemsByAccount: removeKey(state.itemsByAccount),
        syncStates: removeKey(state.syncStates),
        lastRefreshAt: removeKey(state.lastRefreshAt),
      };
    }),

  setLastRefreshAt: (accountId, ts) =>
    set((state) => ({
      lastRefreshAt: {...state.lastRefreshAt, [accountId]: ts},
    })),
}));
