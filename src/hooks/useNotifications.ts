import {useEffect, useRef} from 'react';
import {ElmaTask} from '../types/task';
import {ElmaAccount} from '../types/account';
import * as KeepAliveNative from '../native/KeepAlive';
import * as TasksStore from '../store/tasks-store';
import * as AuthStore from '../store/auth-store';
import * as SettingsStore from '../store/settings-store';
import {isQuietHours} from '../utils/quiet-hours';

// ---------------------------------------------------------------------------
// detectNewTasks — pure helper
// ---------------------------------------------------------------------------

export function detectNewTasks(
  current: ElmaTask[],
  previous: ElmaTask[],
): ElmaTask[] {
  const prevIds = new Set(previous.map((t) => t.id));
  return current.filter((t) => !prevIds.has(t.id));
}

// ---------------------------------------------------------------------------
// Notification sender — try native, fallback to silent no-op
// ---------------------------------------------------------------------------

function sendNotification(
  task: ElmaTask,
  accountName: string,
): void {
  const settings = SettingsStore.useSettingsStore.getState();
  if (!settings.notificationsEnabled || !settings.notifyNewTasks) {
    return;
  }
  if (settings.notificationDisabledAccountIds.includes(task.accountId)) {
    return;
  }
  const quiet =
    settings.quietHoursEnabled &&
    isQuietHours(new Date(), settings.quietHoursFrom, settings.quietHoursTo);
  const title = `Новая задача: ${task.subject || task.name}`;
  const body = `${accountName}`;
  try {
    const keepAlive = KeepAliveNative as {
      notifyTask?: (t: string, b: string, o?: {sound?: boolean; vibration?: boolean; soundId?: string; volume?: number}, taskId?: string | null) => void;
    };
    if (typeof keepAlive.notifyTask === 'function') {
      keepAlive.notifyTask(title, body, {
        sound: settings.soundEnabled && !quiet,
        vibration: settings.vibrationEnabled && !quiet,
        soundId: settings.otherSoundId,
        volume: settings.otherVolume,
      }, task.id);
      return;
    }
  } catch {
    // native module not available
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotifications(): void {
  const prevSnapshotRef = useRef<Map<string, ElmaTask[]>>(new Map());
  const notifiedTaskKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const tasksMod = TasksStore as {
      useTasksStore: {
        getState: () => {tasksByAccount: Record<string, ElmaTask[]>};
        subscribe: (listener: () => void) => () => void;
      };
    };
    const authMod = AuthStore as {
      useAuthStore: {
        getState: () => {
          accounts: ElmaAccount[];
        };
      };
    };

    const handleChanges = () => {
      const tasksByAccount: Record<string, ElmaTask[]> =
        tasksMod.useTasksStore.getState().tasksByAccount;
      const accounts = authMod.useAuthStore.getState().accounts;
      const prevSnapshot = prevSnapshotRef.current;
      const notifiedKeys = notifiedTaskKeysRef.current;

      for (const [accountId, tasks] of Object.entries(tasksByAccount)) {
        if (!accounts.some(a => a.id === accountId)) {
          continue;
        }
        const prevTasks = prevSnapshot.get(accountId);
        if (prevTasks) {
          const newTasks = detectNewTasks(tasks, prevTasks);
          const account = accounts.find((a) => a.id === accountId);
          const accountName = account?.name || accountId;
          for (const task of newTasks) {
            const dedupKey = `${task.baseUrl || ''}::${task.taskId || task.id}`;
            if (notifiedKeys.has(dedupKey)) {
              continue;
            }
            notifiedKeys.add(dedupKey);
            sendNotification(task, accountName);
          }
        }
        prevSnapshot.set(accountId, tasks);
      }

      for (const accountId of prevSnapshot.keys()) {
        if (!(accountId in tasksByAccount)) {
          prevSnapshot.delete(accountId);
        }
      }
    };

    const unsub = tasksMod.useTasksStore.subscribe(handleChanges);

    return () => {
      unsub();
    };
  }, []);
}
