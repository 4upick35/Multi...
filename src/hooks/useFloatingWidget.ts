import {useEffect, useRef} from 'react';
import {useSettingsStore} from '../store/settings-store';
import {useAuthStore} from '../store/auth-store';
import {useCustomerServiceStore} from '../store/customer-service-store';
import {formatTimeHMS} from '../utils/datetime';
import {
  showOverlayWidget,
  hideOverlayWidget,
  updateOverlayWidget,
  hasOverlayPermission,
  consumePendingNavigation,
  onOverlayNavigation,
} from '../native/KeepAlive';
import type {NavigationTarget} from '../native/KeepAlive';

/**
 * Текст виджета: строка 1 — имя учётки, обновившейся последней,
 * строка 2 — время этого обновления.
 */
function buildWidgetText(): string {
  const settings = useSettingsStore.getState();
  if (settings.syncPaused) {
    return 'Синхронизация: пауза';
  }
  const lastRefreshAt = useCustomerServiceStore.getState().lastRefreshAt;
  const accounts = useAuthStore.getState().accounts;

  let bestName = '';
  let bestTs = 0;
  for (const acc of accounts) {
    const ts = lastRefreshAt[acc.id] ?? 0;
    if (ts > bestTs) {
      bestTs = ts;
      bestName = acc.name;
    }
  }
  if (bestTs === 0) {
    return 'Ожидание данных…';
  }
  return `${bestName}\n${formatTimeHMS(new Date(bestTs))}`;
}

// --- Обновление текста виджета вне React ---
// Подписки на сторы живут в модуле: пока процесс жив (foreground-сервис), текст
// обновляется даже когда приложение свёрнуто и React не перерисовывает дерево.
let widgetUnsubscribe: (() => void) | null = null;
let widgetHeartbeat: ReturnType<typeof setInterval> | null = null;
let lastPushedText = '';

function pushWidgetText(): void {
  if (!useSettingsStore.getState().floatingWidgetEnabled) {
    return;
  }
  const text = buildWidgetText();
  if (text === lastPushedText) {
    return;
  }
  lastPushedText = text;
  updateOverlayWidget(text);
}

function startWidgetTextSync(): void {
  if (widgetUnsubscribe) {
    return;
  }
  const unsubSettings = useSettingsStore.subscribe(pushWidgetText);
  const unsubAuth = useAuthStore.subscribe(pushWidgetText);
  const unsubCustomer = useCustomerServiceStore.subscribe(pushWidgetText);
  widgetUnsubscribe = () => {
    unsubSettings();
    unsubAuth();
    unsubCustomer();
  };
  // Страховка: раз в 30 секунд перепроверяем текст.
  widgetHeartbeat = setInterval(pushWidgetText, 30000);
  pushWidgetText();
}

function stopWidgetTextSync(): void {
  if (widgetUnsubscribe) {
    widgetUnsubscribe();
    widgetUnsubscribe = null;
  }
  if (widgetHeartbeat) {
    clearInterval(widgetHeartbeat);
    widgetHeartbeat = null;
  }
  lastPushedText = '';
}

/**
 * Управляет плавающим виджетом: показывает/скрывает по настройке, обновляет текст
 * (в том числе в фоне) и обрабатывает переход по тапу.
 */
export function useFloatingWidget(onNavigate: (nav: NavigationTarget) => void): void {
  const floatingWidgetEnabled = useSettingsStore((s) => s.floatingWidgetEnabled);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  // Показ/скрытие виджета + запуск фонового обновления текста
  useEffect(() => {
    if (!floatingWidgetEnabled) {
      stopWidgetTextSync();
      hideOverlayWidget();
      return;
    }
    hasOverlayPermission()
      .then((granted) => {
        if (!granted) {
          stopWidgetTextSync();
          hideOverlayWidget();
          return;
        }
        const initial = buildWidgetText();
        showOverlayWidget(initial);
        lastPushedText = initial;
        startWidgetTextSync();
      })
      .catch(() => {
        stopWidgetTextSync();
        hideOverlayWidget();
      });
    return () => {
      stopWidgetTextSync();
    };
  }, [floatingWidgetEnabled]);

  // Навигация по тапу на виджете или уведомлении
  useEffect(() => {
    const unsub = onOverlayNavigation((nav) => {
      // Гасим сохранённый переход: событие уже доставлено, иначе он повторится
      // при следующем запуске приложения.
      void consumePendingNavigation().catch(() => {});
      navigateRef.current(nav);
    });
    return unsub;
  }, []);

  // Навигация, отложенная с момента когда приложение было в фоне
  useEffect(() => {
    consumePendingNavigation()
      .then((nav) => {
        if (nav) {
          navigateRef.current(nav);
        }
      })
      .catch(() => {});
  }, []);
}
