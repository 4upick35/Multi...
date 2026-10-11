import {useEffect, useRef} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import {useSettingsStore} from '../store/settings-store';
import {useAuthStore} from '../store/auth-store';
import {
  setKeepScreenOn,
  startBackgroundSync,
  stopBackgroundSync,
} from '../native/KeepAlive';

export function useKeepAlive(): void {
  const keepScreenOn = useSettingsStore((s) => s.keepScreenOn);
  const backgroundSync = useSettingsStore((s) => s.backgroundSync);
  const syncPaused = useSettingsStore((s) => s.syncPaused);
  const floatingWidgetEnabled = useSettingsStore((s) => s.floatingWidgetEnabled);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const accounts = useAuthStore((s) => s.accounts);
  const accountsCount = accounts.length;

  const appState = useRef(AppState.currentState);

  // keepScreenOn
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (keepScreenOn && appState.current === 'active') {
      setKeepScreenOn(true);
    } else {
      setKeepScreenOn(false);
    }
  }, [keepScreenOn, hydrated]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && keepScreenOn && hydrated) {
        setKeepScreenOn(true);
      } else if (next !== 'active') {
        setKeepScreenOn(false);
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, [keepScreenOn, hydrated]);

  // backgroundSync
  const prevBgRef = useRef<{run: boolean; hyd: boolean}>({
    run: false,
    hyd: false,
  });

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const prev = prevBgRef.current;
    // Фоновый сервис нужен либо для фоновой синхронизации (и только когда
    // синхронизация не на паузе), либо для плавающего виджета, который должен
    // жить поверх других приложений.
    const shouldRun =
      accountsCount > 0 &&
      ((backgroundSync && !syncPaused) || floatingWidgetEnabled);
    const wasRunning = prev.run && prev.hyd;

    if (shouldRun && !wasRunning) {
      startBackgroundSync('MultiElma', 'Фоновая синхронизация активна');
    } else if (!shouldRun && wasRunning) {
      stopBackgroundSync();
    }

    prevBgRef.current = {run: shouldRun, hyd: hydrated};
  }, [backgroundSync, syncPaused, floatingWidgetEnabled, accountsCount, hydrated]);
}
