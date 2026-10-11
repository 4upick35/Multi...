// ---------------------------------------------------------------------------
// useStaggeredAccountPolling — опрос учёток с разносом между стартами.
// Каждая учётка имеет свой таймер. Между обновлениями разных учёток —
// минимум ACCOUNT_SYNC_MIN_GAP_MS + случайный 0..ACCOUNT_SYNC_GAP_JITTER_MS.
// ---------------------------------------------------------------------------

import {useCallback, useEffect, useRef} from 'react';
import {ACCOUNT_SYNC_MIN_GAP_MS} from '../config/constants';
import {nextAccountIntervalMs, nextAccountGapMs} from '../utils/poll-interval';

// ---------------------------------------------------------------------------
// Вспомогательные
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export interface UseStaggeredAccountPollingOptions {
  enabled: boolean;
  accountIds: string[];
  baseIntervalMs: number;
  jitterMs: number;
  callback: (accountId: string) => Promise<void>;
  onAccountStart?: (accountId: string) => void;
  onAccountEnd?: (accountId: string) => void;
}

export interface UseStaggeredAccountPollingResult {
  refreshAllNow: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Хук
// ---------------------------------------------------------------------------

export function useStaggeredAccountPolling({
  enabled,
  accountIds,
  baseIntervalMs,
  jitterMs,
  callback,
  onAccountStart,
  onAccountEnd,
}: UseStaggeredAccountPollingOptions): UseStaggeredAccountPollingResult {
  // Колбэки храним в ref, чтобы не пересоздавать таймеры при их изменении
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const onStartRef = useRef(onAccountStart);
  onStartRef.current = onAccountStart;
  const onEndRef = useRef(onAccountEnd);
  onEndRef.current = onAccountEnd;

  // Интервал и jitter храним в ref — обновляются каждый рендер,
  // но не пересоздают таймеры
  const baseIntervalMsRef = useRef(baseIntervalMs);
  baseIntervalMsRef.current = baseIntervalMs;
  const jitterMsRef = useRef(jitterMs);
  jitterMsRef.current = jitterMs;

  // Таймеры для каждой учётки
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Флаг: учётка сейчас обновляется (защита от дублирования)
  const inflightRef = useRef<Set<string>>(new Set());
  // Время старта последнего обновления учётки.
  // Number.MIN_SAFE_INTEGER чтобы первый вызов проходил без задержки.
  const lastStartRef = useRef<number>(Number.MIN_SAFE_INTEGER);
  // Текущий требуемый разнос (пересчитывается после каждого старта)
  const gapRef = useRef<number>(ACCOUNT_SYNC_MIN_GAP_MS);
  // Флаг: refreshAllNow уже выполняется
  const refreshAllNowRunningRef = useRef(false);
  // Флаг отмены хука
  const cancelledRef = useRef(false);
  // Стабильный ключ списка учёток (чтобы не пересоздавать таймеры при рефере)
  const accountIdsKeyRef = useRef(accountIds.join(','));
  // Флаг: первая инициализация уже запускала учётки
  const initialStartDoneRef = useRef(false);

  // --- Внутренняя функция: реальное выполнение обновления учётки ---
  const executeRefresh = useCallback(async (accountId: string) => {
    if (cancelledRef.current) {
      return;
    }
    if (inflightRef.current.has(accountId)) {
      return; // уже обновляется — пропускаем
    }

    // Gate: ждём, пока не истечёт требуемый разнос с предыдущим стартом
    const now = Date.now();
    const wait = lastStartRef.current + gapRef.current - now;
    if (wait > 0) {
      await sleep(wait + 50);
    }

    if (cancelledRef.current) {
      return;
    }

    // Фиксируем старт и пересчитываем разнос
    lastStartRef.current = Date.now();
    gapRef.current = nextAccountGapMs();

    // Запускаем обновление
    inflightRef.current.add(accountId);
    try {
      onStartRef.current?.(accountId);
      await callbackRef.current(accountId);
    } finally {
      onEndRef.current?.(accountId);
      inflightRef.current.delete(accountId);
    }
  }, []);

  // --- Внешняя обёртка: выполняет обновление + планирует следующий таймер ---
  const runForAccount = useCallback(async (accountId: string) => {
    if (cancelledRef.current) {
      return;
    }

    await executeRefresh(accountId);

    // Планируем следующее обновление этой учётки
    if (!cancelledRef.current) {
      const nextDelay = nextAccountIntervalMs(baseIntervalMsRef.current, jitterMsRef.current);
      const timer = setTimeout(() => {
        timersRef.current.delete(accountId);
        runForAccount(accountId);
      }, nextDelay);
      timersRef.current.set(accountId, timer);
    }
  }, [executeRefresh]);

  // --- refreshAllNow: проход по всем учёткам с разносом, ДОЖИДАЕТСЯ завершения ---
  const refreshAllNow = useCallback(async () => {
    if (refreshAllNowRunningRef.current) {
      return; // уже выполняется — игнорируем повторный вызов
    }
    refreshAllNowRunningRef.current = true;
    try {
      for (const accountId of accountIds) {
        if (cancelledRef.current) {
          break;
        }
        await executeRefresh(accountId);
      }
    } finally {
      refreshAllNowRunningRef.current = false;
    }
  }, [accountIds, executeRefresh]);

  // --- Управление таймерами ---
  // Зависит ТОЛЬКО от enabled и ключа списка учёток.
  // Смена baseIntervalMs / jitterMs вступает в силу со следующего цикла.
  useEffect(() => {
    const timers = timersRef.current;
    const key = accountIds.join(',');

    if (!enabled) {
      // Очищаем все таймеры и сбрасываем флаг, чтобы при повторном включении
      // таймеры перезапустились
      timers.forEach(t => clearTimeout(t));
      timers.clear();
      initialStartDoneRef.current = false;
      return;
    }

    // Удаляем таймеры только для учёток, которых больше нет в списке.
    // Таймеры оставшихся учёток продолжают работать.
    timers.forEach((t, id) => {
      if (!accountIds.includes(id)) {
        clearTimeout(t);
        timers.delete(id);
      }
    });

    const keyChanged = key !== accountIdsKeyRef.current;
    accountIdsKeyRef.current = key;

    if (!initialStartDoneRef.current || keyChanged) {
      // Первый запуск или изменился список учёток — запускаем с разносом
      initialStartDoneRef.current = true;

      // Немедленно запускаем первую учётку, остальные — с разносом
      accountIds.forEach((accountId, index) => {
        if (timers.has(accountId)) {
          return; // уже есть таймер — не дублируем
        }
        if (index === 0) {
          // Первая учётка — сразу
          runForAccount(accountId);
        } else {
          // Остальные — с разносом от предыдущей
          const gapDelay = index * nextAccountGapMs();
          const timer = setTimeout(() => {
            timers.delete(accountId);
            runForAccount(accountId);
          }, gapDelay);
          timers.set(accountId, timer);
        }
      });
    }
    // Нет cleanup — таймеры живых учёток продолжают работать.
    // Очистка происходит при enabled=false и при размонтировании.
  }, [enabled, accountIds, runForAccount]);

  // --- Отмена при размонтировании ---
  useEffect(() => {
    cancelledRef.current = false;
    const timers = timersRef.current;
    return () => {
      cancelledRef.current = true;
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return {refreshAllNow};
}
