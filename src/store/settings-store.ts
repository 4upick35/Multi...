import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {STORAGE_KEYS} from '../config/constants';
import {ThemeMode} from '../theme';
import {
  DEFAULT_POLL_INTERVAL_SEC,
  MIN_POLL_INTERVAL_SEC,
  MAX_POLL_INTERVAL_SEC,
  PRIORITY_MAX_ACCOUNTS,
  DEFAULT_NEW_APPLICATION_SOUND,
  DEFAULT_OTHER_SOUND,
  DEFAULT_ALERT_VOLUME,
} from '../config/constants';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

interface SettingsState {
  pollIntervalSec: number;
  keepScreenOn: boolean;
  backgroundSync: boolean;
  serverAddress: string;
  notificationsEnabled: boolean;
  notifyNewTasks: boolean;
  notifyNewApplications: boolean;
  notifyStatusChangesApplications: boolean;
  notifyStatusChangesTasks: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  alertRepeatCount: number;
  /** Звук для уведомлений о новой заявке (отдельная группа). */
  newApplicationSoundId: string;
  newApplicationVolume: number;
  /** Звук для остальных уведомлений (задачи, смена статуса и т.п.). */
  otherSoundId: string;
  otherVolume: number;
  floatingWidgetEnabled: boolean;
  syncPaused: boolean;
  /** Пуш-режим: не опрашивать сервер по расписанию — список обновляется из realtime. */
  pushMode: boolean;
  hydrated: boolean;
  themeMode: ThemeMode;
  priorityAccountIds: string[];
  /** Тихие часы: без звука/вибрации в указанный интервал. */
  quietHoursEnabled: boolean;
  /** Начало тихих часов, HH:MM. */
  quietHoursFrom: string;
  /** Конец тихих часов, HH:MM. */
  quietHoursTo: string;
  /** Учётки, для которых уведомления полностью отключены. */
  notificationDisabledAccountIds: string[];
}

interface SettingsActions {
  loadSettings: () => Promise<void>;
  updateSettings: (partial: Partial<Omit<SettingsState, 'hydrated'>>) => void;
  saveServerAddress: (address: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInterval(sec: number): number {
  return Math.max(MIN_POLL_INTERVAL_SEC, Math.min(MAX_POLL_INTERVAL_SEC, sec));
}

function clampRepeatCount(count: number): number {
  return Math.max(1, Math.min(10, count));
}

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(10, volume));
}

/** Непустая строка-идентификатор звука; иначе значение по умолчанию. */
function normalizeSoundId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/** Приоритетные учётки: только непустые строки, без дублей, не больше лимита. */
function normalizePriorityIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const id = item.trim();
    if (id === '' || result.includes(id)) {
      continue;
    }
    result.push(id);
    if (result.length >= PRIORITY_MAX_ACCOUNTS) {
      break;
    }
  }
  return result;
}

/** Время тихих часов в формате HH:MM (регулярка ^([01]\d|2[0-3]):[0-5]\d$); иначе фолбэк. */
function normalizeQuietTime(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
      return trimmed;
    }
  }
  return fallback;
}

/** Отключённые учётки: только непустые строки, без дублей. */
function normalizeDisabledIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const id = item.trim();
    if (id === '' || result.includes(id)) {
      continue;
    }
    result.push(id);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function persistSettings(state: SettingsState): void {
  const {pollIntervalSec, keepScreenOn, backgroundSync, serverAddress, notificationsEnabled, notifyNewTasks, notifyNewApplications, notifyStatusChangesApplications, notifyStatusChangesTasks, soundEnabled, vibrationEnabled, alertRepeatCount, newApplicationSoundId, newApplicationVolume, otherSoundId, otherVolume, floatingWidgetEnabled, syncPaused, pushMode, themeMode, priorityAccountIds, quietHoursEnabled, quietHoursFrom, quietHoursTo, notificationDisabledAccountIds} = state;
  AsyncStorage.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify({pollIntervalSec, keepScreenOn, backgroundSync, serverAddress, notificationsEnabled, notifyNewTasks, notifyNewApplications, notifyStatusChangesApplications, notifyStatusChangesTasks, soundEnabled, vibrationEnabled, alertRepeatCount, newApplicationSoundId, newApplicationVolume, otherSoundId, otherVolume, floatingWidgetEnabled, syncPaused, pushMode, themeMode, priorityAccountIds, quietHoursEnabled, quietHoursFrom, quietHoursTo, notificationDisabledAccountIds}),
  ).catch(() => {});
}

export const useSettingsStore = create<SettingsState & SettingsActions>(
  (set, get) => ({
    pollIntervalSec: DEFAULT_POLL_INTERVAL_SEC,
    keepScreenOn: false,
    backgroundSync: false,
    serverAddress: '',
    notificationsEnabled: true,
    notifyNewTasks: true,
    notifyNewApplications: true,
    notifyStatusChangesApplications: true,
    notifyStatusChangesTasks: true,
    soundEnabled: true,
    vibrationEnabled: true,
    alertRepeatCount: 3,
    newApplicationSoundId: DEFAULT_NEW_APPLICATION_SOUND,
    newApplicationVolume: DEFAULT_ALERT_VOLUME,
    otherSoundId: DEFAULT_OTHER_SOUND,
    otherVolume: DEFAULT_ALERT_VOLUME,
    floatingWidgetEnabled: false,
    syncPaused: false,
    pushMode: false,
    hydrated: false,
    themeMode: 'light',
    priorityAccountIds: [],
    quietHoursEnabled: false,
    quietHoursFrom: '22:00',
    quietHoursTo: '07:00',
    notificationDisabledAccountIds: [],

    loadSettings: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.settings);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SettingsState>;
          const validModes: Record<string, ThemeMode> = {
            light: 'light',
            dark: 'dark',
            system: 'system',
          };
          const resolvedMode: ThemeMode =
            (validModes[parsed.themeMode as 'light' | 'dark' | 'system'] ?? 'light') as ThemeMode;

          // Обратная совместимость: старый единый переключатель «смена статуса»
          // транслируется в оба новых, если раздельные ещё не сохранены.
          const legacy = parsed as Partial<SettingsState> & {
            notifyStatusChanges?: boolean;
          };
          const legacyStatus =
            legacy.notifyStatusChanges !== undefined &&
            parsed.notifyStatusChangesApplications === undefined &&
            parsed.notifyStatusChangesTasks === undefined;
          const statusApps = legacyStatus
            ? legacy.notifyStatusChanges
            : (parsed.notifyStatusChangesApplications ?? true);
          const statusTasks = legacyStatus
            ? legacy.notifyStatusChanges
            : (parsed.notifyStatusChangesTasks ?? true);

          set({
            pollIntervalSec: clampInterval(
              parsed.pollIntervalSec ?? DEFAULT_POLL_INTERVAL_SEC,
            ),
            keepScreenOn: parsed.keepScreenOn ?? false,
            backgroundSync: parsed.backgroundSync ?? false,
            serverAddress: parsed.serverAddress ?? '',
            notificationsEnabled: parsed.notificationsEnabled ?? true,
            notifyNewTasks: parsed.notifyNewTasks ?? true,
            notifyNewApplications: parsed.notifyNewApplications ?? true,
            notifyStatusChangesApplications: statusApps,
            notifyStatusChangesTasks: statusTasks,
            soundEnabled: parsed.soundEnabled ?? true,
            vibrationEnabled: parsed.vibrationEnabled ?? true,
            alertRepeatCount: clampRepeatCount(parsed.alertRepeatCount ?? 3),
            newApplicationSoundId: normalizeSoundId(
              parsed.newApplicationSoundId,
              DEFAULT_NEW_APPLICATION_SOUND,
            ),
            newApplicationVolume: clampVolume(
              typeof parsed.newApplicationVolume === 'number'
                ? parsed.newApplicationVolume
                : DEFAULT_ALERT_VOLUME,
            ),
            otherSoundId: normalizeSoundId(parsed.otherSoundId, DEFAULT_OTHER_SOUND),
            otherVolume: clampVolume(
              typeof parsed.otherVolume === 'number' ? parsed.otherVolume : DEFAULT_ALERT_VOLUME,
            ),
            floatingWidgetEnabled: parsed.floatingWidgetEnabled ?? false,
            syncPaused: parsed.syncPaused ?? false,
            pushMode: parsed.pushMode ?? false,
            hydrated: true,
            themeMode: resolvedMode,
            priorityAccountIds: normalizePriorityIds(parsed.priorityAccountIds),
            quietHoursEnabled: parsed.quietHoursEnabled === true,
            quietHoursFrom: normalizeQuietTime(parsed.quietHoursFrom, '22:00'),
            quietHoursTo: normalizeQuietTime(parsed.quietHoursTo, '07:00'),
            notificationDisabledAccountIds: normalizeDisabledIds(
              parsed.notificationDisabledAccountIds,
            ),
          });
        } else {
          set({hydrated: true});
        }
      } catch {
        set({hydrated: true});
      }
    },

    updateSettings: (partial) => {
      const current = get();
      const next: Partial<SettingsState> = {};
      if (partial.pollIntervalSec !== undefined) {
        next.pollIntervalSec = clampInterval(partial.pollIntervalSec);
      }
      if (partial.keepScreenOn !== undefined) {
        next.keepScreenOn = partial.keepScreenOn;
      }
      if (partial.backgroundSync !== undefined) {
        next.backgroundSync = partial.backgroundSync;
      }
      if (partial.serverAddress !== undefined) {
        next.serverAddress = partial.serverAddress;
      }
      if (partial.notificationsEnabled !== undefined) {
        next.notificationsEnabled = partial.notificationsEnabled;
      }
      if (partial.notifyNewTasks !== undefined) {
        next.notifyNewTasks = partial.notifyNewTasks;
      }
      if (partial.notifyNewApplications !== undefined) {
        next.notifyNewApplications = partial.notifyNewApplications;
      }
      if (partial.notifyStatusChangesApplications !== undefined) {
        next.notifyStatusChangesApplications = partial.notifyStatusChangesApplications;
      }
      if (partial.notifyStatusChangesTasks !== undefined) {
        next.notifyStatusChangesTasks = partial.notifyStatusChangesTasks;
      }
      if (partial.soundEnabled !== undefined) {
        next.soundEnabled = partial.soundEnabled;
      }
      if (partial.vibrationEnabled !== undefined) {
        next.vibrationEnabled = partial.vibrationEnabled;
      }
      if (partial.alertRepeatCount !== undefined) {
        next.alertRepeatCount = clampRepeatCount(partial.alertRepeatCount);
      }
      if (partial.newApplicationSoundId !== undefined) {
        next.newApplicationSoundId = normalizeSoundId(
          partial.newApplicationSoundId,
          DEFAULT_NEW_APPLICATION_SOUND,
        );
      }
      if (partial.newApplicationVolume !== undefined) {
        next.newApplicationVolume = clampVolume(partial.newApplicationVolume);
      }
      if (partial.otherSoundId !== undefined) {
        next.otherSoundId = normalizeSoundId(partial.otherSoundId, DEFAULT_OTHER_SOUND);
      }
      if (partial.otherVolume !== undefined) {
        next.otherVolume = clampVolume(partial.otherVolume);
      }
      if (partial.floatingWidgetEnabled !== undefined) {
        next.floatingWidgetEnabled = partial.floatingWidgetEnabled;
      }
      if (partial.syncPaused !== undefined) {
        next.syncPaused = partial.syncPaused;
      }
      if (partial.pushMode !== undefined) {
        next.pushMode = partial.pushMode;
      }
      if (partial.themeMode !== undefined) {
        next.themeMode = partial.themeMode;
      }
      if (partial.priorityAccountIds !== undefined) {
        next.priorityAccountIds = normalizePriorityIds(partial.priorityAccountIds);
      }
      if (partial.quietHoursEnabled !== undefined) {
        next.quietHoursEnabled = partial.quietHoursEnabled;
      }
      if (partial.quietHoursFrom !== undefined) {
        next.quietHoursFrom = normalizeQuietTime(
          partial.quietHoursFrom,
          current.quietHoursFrom,
        );
      }
      if (partial.quietHoursTo !== undefined) {
        next.quietHoursTo = normalizeQuietTime(partial.quietHoursTo, current.quietHoursTo);
      }
      if (partial.notificationDisabledAccountIds !== undefined) {
        next.notificationDisabledAccountIds = normalizeDisabledIds(
          partial.notificationDisabledAccountIds,
        );
      }
      set({...current, ...next} as SettingsState);
      persistSettings(get() as SettingsState);
    },

    saveServerAddress: async (address: string) => {
      set({serverAddress: address});
      persistSettings(get() as SettingsState);
    },
  }),
);
