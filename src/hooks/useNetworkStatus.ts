import {useEffect, useState} from 'react';
import {AppState, AppStateStatus, DeviceEventEmitter} from 'react-native';
import {isNetworkAvailable, SYNC_TICK_EVENT} from '../native/KeepAlive';

const CHECK_EVERY_TICKS = 5;

export function useNetworkStatus(): boolean | null {
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    const check = () => {
      isNetworkAvailable().then(value => {
        if (mounted) {
          setOnline(value);
        }
      });
    };

    check();

    let ticks = 0;
    const tickSub = DeviceEventEmitter.addListener(SYNC_TICK_EVENT, () => {
      ticks += 1;
      if (ticks % CHECK_EVERY_TICKS === 0) {
        check();
      }
    });

    const appSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        check();
      }
    });

    return () => {
      mounted = false;
      tickSub.remove();
      appSub.remove();
    };
  }, []);

  return online;
}
