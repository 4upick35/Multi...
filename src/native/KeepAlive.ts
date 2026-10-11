import {NativeModules, Platform, DeviceEventEmitter} from 'react-native';

/**
 * Типизированное описание нативной части моста (см. android/.../KeepAliveModule.kt,
 * вызывается по классическому NativeModules, не TurboModule).
 */
interface KeepAliveNativeModule {
  setKeepScreenOn(enabled: boolean): void;
  setSecureFlag(enabled: boolean): Promise<boolean>;
  startBackgroundSync(title: string | null, body: string | null): Promise<void>;
  stopBackgroundSync(): Promise<void>;
  isBackgroundSyncRunning(): Promise<boolean>;
  notify(title: string | null, body: string | null): void;
  requestBatteryOptimizationSettings(): void;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  alertNewItem(title: string | null, body: string | null, sound: boolean, vibration: boolean, repeatCount: number, accountId: string | null): void;
  stopAlert(): void;
  showOverlayWidget(text: string | null): void;
  hideOverlayWidget(): void;
  updateOverlayWidget(text: string): void;
  pulseOverlayWidget(): void;
  hasOverlayPermission(): Promise<boolean>;
  requestOverlayPermission(): void;
  consumePendingNavigation(): Promise<NavigationTarget | null>;
  startSyncTicker(): void;
  stopSyncTicker(): void;
  delay(ms: number): Promise<void>;
  getCookies(url: string): Promise<string | null>;
  saveSecret(key: string, value: string): Promise<boolean>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<boolean>;
  copyToClipboard(text: string): void;
  shareTextFile(fileName: string, content: string, title: string): Promise<boolean>;
  getConstants(): {isAndroid: boolean; isDiag: boolean};
}

const isKeepAliveModule = (value: unknown): value is KeepAliveNativeModule =>
  typeof value === 'object' && value !== null;

export interface NavigationTarget {target: string; accountId: string | null;}

const rawModule: unknown = Platform.OS === 'android' ? NativeModules.KeepAlive : null;

const keepAlive: KeepAliveNativeModule | null = isKeepAliveModule(rawModule)
  ? rawModule
  : null;

/** true, если нативный модуль KeepAlive доступен на текущей платформе. */
export const isKeepAliveSupported: boolean = keepAlive !== null;

/** true только в диагностической сборке (buildType diag). */
export const isDiagBuild: boolean = (() => {
  try {
    return keepAlive?.getConstants?.().isDiag === true;
  } catch {
    return false;
  }
})();

function whenAvailable(action: (nativeModule: KeepAliveNativeModule) => void): void {
  if (keepAlive === null) {
    return;
  }
  try {
    action(keepAlive);
  } catch {
    // Keep-alive работает по принципу best-effort: JS-вызов не должен бросать исключения.
  }
}

async function whenAvailableAsync<T>(
  action: (nativeModule: KeepAliveNativeModule) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (keepAlive === null) {
    return fallback;
  }
  try {
    return await action(keepAlive);
  } catch {
    return fallback;
  }
}

/** Не даёт экрану погаснуть, пока открыта текущая Activity (Android). */
export function setKeepScreenOn(enabled: boolean): void {
  whenAvailable(nativeModule => nativeModule.setKeepScreenOn(enabled));
}

/**
 * Включает (или снимает) FLAG_SECURE на текущей Activity: запрещает скриншоты
 * и превью экрана в списке «недавние». Вне Android или при ошибке — false,
 * без исключения.
 */
export function setSecureFlag(enabled: boolean): Promise<boolean> {
  return whenAvailableAsync(nativeModule => nativeModule.setSecureFlag(enabled), false);
}

/**
 * Запускает фоновый foreground-сервис (канал "background_sync") с частичным wake lock,
 * чтобы приложение продолжало синхронизацию в фоне. Ничего не делает вне Android.
 */
export function startBackgroundSync(title?: string | null, body?: string | null): Promise<void> {
  return whenAvailableAsync(
    nativeModule => nativeModule.startBackgroundSync(title ?? null, body ?? null),
    undefined,
  );
}

/** Останавливает фоновый сервис, запущенный через startBackgroundSync. */
export function stopBackgroundSync(): Promise<void> {
  return whenAvailableAsync(nativeModule => nativeModule.stopBackgroundSync(), undefined);
}

/** true, если фоновый сервис синхронизации сейчас запущен. */
export function isBackgroundSyncRunning(): Promise<boolean> {
  return whenAvailableAsync(nativeModule => nativeModule.isBackgroundSyncRunning(), false);
}

/**
 * Показывает локальное уведомление о новой задаче (канал "task_alerts"),
 * независимо от фонового сервиса.
 */
export function notifyTask(title: string, body: string): void {
  whenAvailable(nativeModule => nativeModule.notify(title, body));
}

/** Открывает системный экран с запросом отключения оптимизации батареи для приложения. */
export function requestBatteryOptimizationSettings(): void {
  whenAvailable(nativeModule => nativeModule.requestBatteryOptimizationSettings());
}

/** true, если приложение исключено из оптимизации батареи. */
export function isIgnoringBatteryOptimizations(): Promise<boolean> {
  return whenAvailableAsync(
    nativeModule => nativeModule.isIgnoringBatteryOptimizations(),
    false,
  );
}

/**
 * Громкое уведомление о новой заявке: звук + вибрация + системное уведомление.
 * Best-effort: не бросает исключения.
 */
export function alertNewItem(
  title: string,
  body: string,
  options?: {sound?: boolean; vibration?: boolean; repeatCount?: number},
  accountId?: string | null,
): void {
  const sound = options?.sound !== false;
  const vibration = options?.vibration !== false;
  const repeatCount = Math.max(1, Math.min(10, options?.repeatCount ?? 1));
  whenAvailable(nativeModule => nativeModule.alertNewItem(title, body, sound, vibration, repeatCount, accountId ?? null));
}

/** Остановить текущий звук/вибрацию уведомления. */
export function stopAlert(): void {
  whenAvailable(nativeModule => nativeModule.stopAlert());
}

// --- Планировщик синхронизации (нативные тики) ---

/** Событие нативного тикера планировщика (раз в секунду). */
export const SYNC_TICK_EVENT = 'multiElmaSyncTick';

/**
 * Включает нативный тикер: раз в секунду присылает событие {@link SYNC_TICK_EVENT}.
 * Нужен потому, что RN останавливает JS-таймеры, когда приложение свёрнуто.
 */
export function startSyncTicker(): void {
  whenAvailable(nativeModule => nativeModule.startSyncTicker());
}

/** Выключает нативный тикер. */
export function stopSyncTicker(): void {
  whenAvailable(nativeModule => nativeModule.stopSyncTicker());
}

/**
 * Задержка, которая работает и в свёрнутом приложении: RN останавливает JS-таймеры,
 * а нативный Handler — нет. На не-Android (или без модуля) откатывается на setTimeout.
 */
export function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  const nativeModule = keepAlive;
  if (nativeModule === null) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  return nativeModule.delay(ms);
}

// --- Cookie bank (diag) ---

/**
 * Возвращает строку cookie для заданного URL через android.webkit.CookieManager.
 * Вне Android или при ошибке возвращает null.
 */
export async function getCookies(url: string): Promise<string | null> {
  return whenAvailableAsync(
    nativeModule => nativeModule.getCookies(url),
    null,
  );
}

/** Копирует текст в буфер обмена Android. No-op если модуль недоступен. */
export function copyToClipboard(text: string): void {
  whenAvailable(nativeModule => nativeModule.copyToClipboard(text));
}

/**
 * Отдаёт текст файлом через системный «Поделиться» (ACTION_SEND + content-Uri).
 * true — файл отдан, false — модуль недоступен или ошибка (нужен fallback).
 */
export async function shareTextFile(
  fileName: string,
  content: string,
  title: string,
): Promise<boolean> {
  return whenAvailableAsync(m => m.shareTextFile(fileName, content, title), false);
}

// --- Overlay widget ---

/** Shows a floating overlay widget with the given text. */
export function showOverlayWidget(text?: string): void {
  whenAvailable(nativeModule => nativeModule.showOverlayWidget(text ?? null));
}

/** Hides the floating overlay widget. */
export function hideOverlayWidget(): void {
  whenAvailable(nativeModule => nativeModule.hideOverlayWidget());
}

/** Updates the overlay text without recreating the view. */
export function updateOverlayWidget(text: string): void {
  whenAvailable(nativeModule => nativeModule.updateOverlayWidget(text));
}

/** Plays a pulse animation on the overlay widget. */
export function pulseOverlayWidget(): void {
  whenAvailable(nativeModule => nativeModule.pulseOverlayWidget());
}

/** Returns true if the system overlay permission is granted. */
export async function hasOverlayPermission(): Promise<boolean> {
  return whenAvailableAsync(
    nativeModule => nativeModule.hasOverlayPermission(),
    false,
  );
}

/** Opens system settings to grant the overlay permission. */
export function requestOverlayPermission(): void {
  whenAvailable(nativeModule => nativeModule.requestOverlayPermission());
}

/**
 * Consumes (and clears) the pending navigation target that was set by tapping
 * the overlay widget while the app was in background.  Returns null when there
 * is nothing pending.
 */
export async function consumePendingNavigation(): Promise<NavigationTarget | null> {
  return whenAvailableAsync(
    nativeModule => nativeModule.consumePendingNavigation(),
    null,
  );
}

const NAVIGATION_EVENT = 'multiElmaNavigate';

type NavigationCallback = (nav: NavigationTarget) => void;

/**
 * Subscribes to overlay-widget navigation events.  Returns a removal function.
 * When the user taps the widget while the app is in the foreground, this fires
 * immediately with the navigation target (e.g. "applications").
 */
export function onOverlayNavigation(cb: NavigationCallback): () => void {
  const sub = DeviceEventEmitter.addListener(NAVIGATION_EVENT, (nav: NavigationTarget) => {
    cb(nav);
  });
  return () => sub.remove();
}

// --- Шифрованное хранилище секретов (Android EncryptedSharedPreferences) ---

/** Сохраняет секрет в шифрованном виде. Вне Android возвращает false. */
export function saveSecret(key: string, value: string): Promise<boolean> {
  return whenAvailableAsync(nativeModule => nativeModule.saveSecret(key, value), false);
}

/** Читает секрет. Вне Android или при ошибке возвращает null. */
export function getSecret(key: string): Promise<string | null> {
  return whenAvailableAsync(nativeModule => nativeModule.getSecret(key), null);
}

/** Удаляет секрет. Вне Android возвращает false. */
export function deleteSecret(key: string): Promise<boolean> {
  return whenAvailableAsync(nativeModule => nativeModule.deleteSecret(key), false);
}
