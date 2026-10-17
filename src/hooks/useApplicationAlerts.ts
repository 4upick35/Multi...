// ---------------------------------------------------------------------------
// useApplicationAlerts — глобальное обнаружение новых заявок.
//
// ВАЖНО: Не добавляйте новых сетевых опросов! Список заявок опрашивается только
// когда открыт экран заявок. Уведомление срабатывает в момент, когда новые
// данные попали в стор через существующую синхронизацию.
// ---------------------------------------------------------------------------

import {useEffect, useRef} from 'react';
import {
  MAX_SEEN_KEYS,
  loadSeenKeys,
  persistSeenKeys,
} from '../services/seen-application-alerts';
import {logDiag} from '../diag/accept-log';
import {maskValue} from '../utils/mask';
import {CollectionItem} from '../types/customer-service';
import {ElmaAccount} from '../types/account';
import * as CustomerServiceStore from '../store/customer-service-store';
import * as AuthStore from '../store/auth-store';
import * as SettingsStore from '../store/settings-store';

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export interface AlertSettings {
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  alertRepeatCount: number;
  newApplicationSoundId: string;
  newApplicationVolume: number;
  floatingWidgetEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Чистые функции (вынесены для тестирования)
// ---------------------------------------------------------------------------

/**
 * Обнаружить новые заявки относительно множества уже виденных id.
 * Возвращает массив новых items.
 */
export function detectNewApplications(
  currentItems: CollectionItem[],
  seenKeys: Set<string>,
  accountId: string,
): CollectionItem[] {
  const result: CollectionItem[] = [];
  for (const item of currentItems) {
    const key = `${accountId}::${item.id}`;
    if (!seenKeys.has(key)) {
      result.push(item);
    }
  }
  return result;
}

/**
 * Добавить ключи в множество с ограничением размера.
 * Если превышен лимит — удаляет самые старые (первые добавленные).
 */
export function addSeenKeys(seen: Set<string>, newKeys: string[]): Set<string> {
  const next = new Set(seen);
  for (const k of newKeys) {
    next.add(k);
  }
  if (next.size > MAX_SEEN_KEYS) {
    const arr = Array.from(next);
    const toRemove = arr.slice(0, next.size - MAX_SEEN_KEYS);
    for (const k of toRemove) {
      next.delete(k);
    }
  }
  return next;
}

/**
 * Определить id аккаунтов, для которых есть хотя бы один новый item.
 */
export function getAccountIdsWithNewItems(
  prevSnapshots: Map<string, CollectionItem[]>,
  currentSnapshots: Map<string, CollectionItem[]>,
): string[] {
  const result: string[] = [];
  for (const [accountId, currentItems] of currentSnapshots) {
    const prevItems = prevSnapshots.get(accountId);
    if (!prevItems) {
      continue; // первый снимок — пропускаем
    }
    if (currentItems.length > prevItems.length) {
      result.push(accountId);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Diag (best-effort): записи сопоставляются с realtime-уведомлениями по времени
// ---------------------------------------------------------------------------

const DIAG_TAG = 'alerts';

/** Записать в diag-журнал так, чтобы ошибка логирования не ломала основной поток. */
function diagLog(text: string): void {
  try {
    logDiag(DIAG_TAG, text);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useApplicationAlerts(): void {
  const seenRef = useRef<Set<string> | null>(null);
  const prevAppsRef = useRef<Map<string, CollectionItem[]>>(new Map());
  useEffect(() => {
    // Загружаем ранее виденные ключи при монтировании
    loadSeenKeys().then((loaded) => {
      seenRef.current = loaded;
    });

    const csMod = CustomerServiceStore as {
      useCustomerServiceStore: {
        getState: () => {
          itemsByAccount: Record<string, Record<string, CollectionItem[]>>;
        };
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
    const settingsMod = SettingsStore as {
      useSettingsStore: {
        getState: () => AlertSettings;
        subscribe: (listener: () => void) => () => void;
      };
    };
    // Ленивый require остаётся: мок-фабрика native/KeepAlive в тестах ссылается
    // наружные переменные (mockAlertNewItem) и отрабатывает только при ленивом
    // require — статический импорт загрузил бы мок до их инициализации (undefined).
    // Циклической зависимости нет, ленивость сохранена ради поведения тестов.
    const keepAliveMod = require('../native/KeepAlive') as {
      alertNewItem?: (title: string, body: string, options?: {sound?: boolean; vibration?: boolean; repeatCount?: number; soundId?: string; volume?: number}, accountId?: string | null) => void;
      pulseOverlayWidget?: () => void;
    };

    const sendAlert = (title: string, body: string, accountId: string) => {
      const settings = settingsMod.useSettingsStore.getState();
      if (!settings.notificationsEnabled) {
        diagLog('alert-skip reason=disabled account=' + maskValue(accountId) + ' title=' + title);
        return;
      }
      try {
        if (typeof keepAliveMod.alertNewItem === 'function') {
          keepAliveMod.alertNewItem(title, body, {
            sound: settings.soundEnabled,
            vibration: settings.vibrationEnabled,
            repeatCount: settings.alertRepeatCount,
            soundId: settings.newApplicationSoundId,
            volume: settings.newApplicationVolume,
          }, accountId);
        }
      } catch {
        // native module not available
      }
      diagLog('alert account=' + maskValue(accountId) + ' title=' + title);
    };

    const pulseWidget = () => {
      const settings = settingsMod.useSettingsStore.getState();
      if (!settings.floatingWidgetEnabled) {
        return;
      }
      try {
        if (typeof keepAliveMod.pulseOverlayWidget === 'function') {
          keepAliveMod.pulseOverlayWidget();
        }
      } catch {
        // best-effort
      }
    };

    const handleChanges = () => {
      if (seenRef.current === null) {
        return; // ещё не загрузили seen keys
      }

      const accounts = authMod.useAuthStore.getState().accounts;
      const accountIds = new Set(accounts.map((a) => a.id));

      const seen = seenRef.current;
      let seenChanged = false;

      // --- Заявки ---
      const csState = csMod.useCustomerServiceStore.getState();
      const prevApps = prevAppsRef.current;

      for (const [accountId, collections] of Object.entries(csState.itemsByAccount)) {
        if (!accountIds.has(accountId)) {
          continue;
        }
        const items = collections.applications || [];
        const prevItems = prevApps.get(accountId);

        if (prevItems) {
          const newItems = detectNewApplications(items, seen, accountId);
          if (newItems.length > 0) {
            const account = accounts.find((a) => a.id === accountId);
            const accountName = account?.name || accountId;
            for (const item of newItems) {
              const key = `${accountId}::${item.id}`;
              seen.add(key);
              seenChanged = true;
              diagLog(
                'poll-new-application account=' + maskValue(accountId) +
                ' id=' + item.id + ' name=' + item.name,
              );
              sendAlert(`Новая заявка ${item.name}`, accountName, accountId);
              pulseWidget();
            }
          }
        }
        // Обновляем снимок (включая первый раз)
        prevApps.set(accountId, items);
      }

      // Удаляем аккаунты, которых больше нет
      for (const id of prevApps.keys()) {
        if (!accountIds.has(id)) {
          prevApps.delete(id);
        }
      }

      if (seenChanged) {
        seenRef.current = seen;
        persistSeenKeys(seen);
      }
    };

    const unsubCs = csMod.useCustomerServiceStore.subscribe(handleChanges);
    const unsubSettings = settingsMod.useSettingsStore.subscribe(handleChanges);

    return () => {
      unsubCs();
      unsubSettings();
    };
  }, []);
}
