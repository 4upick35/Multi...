import {useEffect, useMemo, useRef} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import {useAuthStore} from '../store/auth-store';
import {useSettingsStore} from '../store/settings-store';
import {
  startApplicationsSync,
  stopApplicationsSync,
  refreshApplicationsNow,
} from '../services/applications-sync';
import {syncRealtimeAccounts, stopAllRealtime, ensureRealtimeAlive} from '../services/realtime';
import {onOverlayNavigation} from '../native/KeepAlive';

export function useApplicationsSync(): void {
  const accounts = useAuthStore(s => s.accounts);
  const syncPaused = useSettingsStore(s => s.syncPaused);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const accountsKey = useMemo(() => accounts.map(a => a.id).join('|'), [accounts]);

  useEffect(() => {
    const current = accountsRef.current;
    if (current.length > 0 && !syncPaused) {
      startApplicationsSync(current);
    } else {
      stopApplicationsSync();
    }
    return () => {
      stopApplicationsSync();
    };
  }, [accountsKey, syncPaused]);

  // Realtime (WebSocket/Centrifugo) — дополнительный read-only канал поверх опроса.
  // Запускается для всех активных учёток; на syncPaused не завязан — пауза опроса
  // заявок realtime не отключает. Интервалы и логику опроса при этом не меняем.
  useEffect(() => {
    syncRealtimeAccounts(accounts);
  }, [accounts]);

  // Остановка realtime при размонтировании (логоут/удаление учётки обрабатывается
  // дополнительно в auth-store.removeAccount).
  useEffect(() => {
    return () => {
      stopAllRealtime();
    };
  }, []);

  // Возврат в приложение: поднимаем убитые фоном сокеты, затем обновляем
  // все учётки, не чаще 1 раза в 5 с.
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') {
        return;
      }
      // Android убивает фоновые WebSocket-соединения — принудительно
      // перезапускаем всё, что не subscribed (force минует min-gap).
      ensureRealtimeAlive(true);
      if (useSettingsStore.getState().syncPaused) {
        return;
      }
      const now = Date.now();
      if (now - lastRefreshRef.current < 5_000) return;
      lastRefreshRef.current = now;
      refreshApplicationsNow().catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // Тап по уведомлению/виджету (multiElmaNavigate): обновляем список сразу,
  // в обход троттла 5 с на возврат в приложение, и поднимаем закрытые сокеты —
  // иначе новая заявка появляется только после ближайшего опроса.
  useEffect(() => {
    const unsub = onOverlayNavigation(nav => {
      refreshApplicationsNow(nav?.accountId ?? undefined).catch(() => {});
      ensureRealtimeAlive();
    });
    return () => {
      unsub();
    };
  }, []);
}
