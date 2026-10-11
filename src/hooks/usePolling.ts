import {useEffect} from 'react';
import {useAuthStore} from '../store/auth-store';
import {useSettingsStore} from '../store/settings-store';
import {
  startSyncScheduler,
  stopSyncScheduler,
} from '../services/sync-scheduler';

export function usePolling(): void {
  const accounts = useAuthStore((s) => s.accounts);

  useEffect(() => {
    useSettingsStore.getState().loadSettings();
  }, []);

  useEffect(() => {
    if (accounts.length > 0) {
      startSyncScheduler();
    }
    return () => {
      stopSyncScheduler();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length > 0]);
}
