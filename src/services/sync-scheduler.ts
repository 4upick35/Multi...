// ---------------------------------------------------------------------------
// sync-scheduler.ts — обёртка-делегат над domain/SyncScheduler.
// Сохраняет ВСЕ оригинальные экспорты для обратной совместимости.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {DeviceEventEmitter} from 'react-native';
import {useAuthStore} from '../store/auth-store';
import {useSettingsStore} from '../store/settings-store';
import {refreshAccountTasks} from './task-service';
import {SyncScheduler} from '../domain/SyncScheduler';
import {SYNC_TICK_EVENT, delay} from '../native/KeepAlive';
import * as TasksStore from '../store/tasks-store';

// ---------------------------------------------------------------------------
// Доступ к tasks-store: статический импорт (циклической зависимости нет —
// auth-store уже статически импортирует tasks-store). Сам вызов остаётся
// ленивым: getTasksSyncStates выполняется только планировщиком, не при загрузке.
// ---------------------------------------------------------------------------

const getTasksSyncStates = (): Record<string, {status: string; lastSyncAt?: number; consecutiveErrors: number}> => {
  const mod = TasksStore as {
    useTasksStore: {getState: () => {syncStates: Record<string, {status: string; lastSyncAt?: number; consecutiveErrors: number}>}};
  };
  return mod.useTasksStore.getState().syncStates;
};

// ---------------------------------------------------------------------------
// Singleton-экземпляр доменного планировщика
// ---------------------------------------------------------------------------

const syncScheduler = new SyncScheduler({
  refreshAccountTasks,
  getAccounts: () => {
    return useAuthStore.getState().accounts;
  },
  getPollIntervalMs: () => {
    const {pollIntervalSec, hydrated} = useSettingsStore.getState();
    if (!hydrated) {
      return 30_000;
    }
    return pollIntervalSec * 1000;
  },
  isSyncPaused: () => useSettingsStore.getState().syncPaused,
  getTasksSyncStates,
  subscribeAuth: (callback: (accounts: ElmaAccount[]) => void) =>
    useAuthStore.subscribe((state) => {
      callback(state.accounts);
    }),
  subscribeSettings: (callback: () => void) =>
    useSettingsStore.subscribe(callback),
  subscribeTick: (callback: () => void) => {
    const sub = DeviceEventEmitter.addListener(SYNC_TICK_EVENT, callback);
    return () => sub.remove();
  },
  delayMs: delay,
});

// ---------------------------------------------------------------------------
// Публичные экспорты (обратная совместимость)
// ---------------------------------------------------------------------------

export function startSyncScheduler(): void {
  syncScheduler.start();
}

export function stopSyncScheduler(): void {
  syncScheduler.stop();
}

export function triggerSyncNow(): void {
  syncScheduler.triggerNow();
}
