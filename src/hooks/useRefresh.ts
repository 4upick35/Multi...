// ---------------------------------------------------------------------------
// Хук для паттерна «pull-to-refresh» (RefreshControl).
// Заменяет повторяющийся паттерн в 9 экранах:
//   const [refreshing, setRefreshing] = useState(false);
//   const handleRefresh = useCallback(async () => {
//     setRefreshing(true);
//     await fetchData();
//     setRefreshing(false);
//   }, [...]);
// ---------------------------------------------------------------------------

import {useCallback, useRef, useState} from 'react';

interface UseRefreshResult {
  /** Флаг «идёт обновление» (для RefreshControl) */
  refreshing: boolean;
  /** Колбэк для onRefresh в RefreshControl */
  onRefresh: () => Promise<void>;
  /** Принудительно установить refreshing (для внешних вызовов) */
  setRefreshing: (value: boolean) => void;
}

/**
 * Хук для управления состоянием pull-to-refresh.
 * Содержит inFlight-защиту: повторный вызов игнорируется, пока предыдущий не завершится.
 *
 * @param callback Асинхронная функция загрузки данных.
 *                 Вызывается при pull-to-refresh.
 *
 * @example
 * const {refreshing, onRefresh} = useRefresh(async () => {
 *   await loadFeedMessages(account);
 * });
 *
 * return (
 *   <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
 * );
 */
export function useRefresh(callback: () => Promise<void>): UseRefreshResult {
  const [refreshing, setRefreshing] = useState(false);
  const inFlightRef = useRef(false);

  const onRefresh = useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setRefreshing(true);
    try {
      await callback();
    } finally {
      setRefreshing(false);
      inFlightRef.current = false;
    }
  }, [callback]);

  return {refreshing, onRefresh, setRefreshing};
}
