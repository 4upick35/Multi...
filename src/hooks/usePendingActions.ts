import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, AppStateStatus, DeviceEventEmitter} from 'react-native';
import {SYNC_TICK_EVENT} from '../native/KeepAlive';
import {
  getPendingActions,
  processPendingActions,
  subscribePendingActions,
} from '../services/action-queue';
import type {PendingAction} from '../services/action-queue';

const RETRY_EVERY_TICKS = 30;

export function usePendingActions(online: boolean | null): {
  actions: PendingAction[];
  retry: () => Promise<void>;
} {
  const [actions, setActions] = useState<PendingAction[]>([]);

  const refresh = useCallback(async () => {
    const list = await getPendingActions();
    setActions(list);
  }, []);

  const retry = useCallback(async () => {
    await processPendingActions();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh().catch(() => {});
    return subscribePendingActions(() => {
      refresh().catch(() => {});
    });
  }, [refresh]);

  const onlineRef = useRef(online);
  onlineRef.current = online;

  useEffect(() => {
    let ticks = 0;
    const sub = DeviceEventEmitter.addListener(SYNC_TICK_EVENT, () => {
      ticks += 1;
      if (ticks < RETRY_EVERY_TICKS) {
        return;
      }
      ticks = 0;
      if (onlineRef.current === false) {
        return;
      }
      retry().catch(() => {});
    });
    return () => sub.remove();
  }, [retry]);

  const prevOnlineRef = useRef(online);
  useEffect(() => {
    const prev = prevOnlineRef.current;
    prevOnlineRef.current = online;
    if (prev === false && online === true) {
      retry().catch(() => {});
    }
  }, [online, retry]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        retry().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [retry]);

  return {actions, retry};
}
