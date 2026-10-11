// ---------------------------------------------------------------------------
// useJitterPolling — автообновление с рандомизацией интервала (джиттер).
// Предназначен для экранного уровня: стартует при фокусе, стоп при уходе.
// Не накладывает итерации: запускает следующий цикл только после завершения
// предыдущего запроса.
// ---------------------------------------------------------------------------

import {useCallback, useEffect, useRef} from 'react';

interface UseJitterPollingOptions {
  /** Базовый интервал в мс (по умолчанию 30 000 = 30 сек) */
  baseIntervalMs?: number;
  /** Максимальный джиттер (диапазон 0..jitterMs, по умолчанию 15 000 = 15 сек) */
  jitterMs?: number;
  /** Включить/выключить опрос */
  enabled?: boolean;
  /** Асинхронная функция загрузки данных */
  callback: () => Promise<void>;
}

/**
 * Вычислить следующий интервал с джиттером.
 * Экспортирован для тестирования.
 */
export function nextIntervalWithJitter(baseMs: number, jitterMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

/**
 * Хук автообновления с джиттером.
 *
 * @example
 * useJitterPolling({
 *   enabled: isApplications,
 *   callback: fetchData,
 *   baseIntervalMs: 30_000,
 *   jitterMs: 15_000,
 * });
 */
export function useJitterPolling({
  baseIntervalMs = 30_000,
  jitterMs = 15_000,
  enabled = true,
  callback,
}: UseJitterPollingOptions): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const scheduleNext = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    const delay = nextIntervalWithJitter(baseIntervalMs, jitterMs);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        await callbackRef.current();
      } finally {
        inFlightRef.current = false;
        // Проверяем что хук ещё активен (enabled мог измениться)
        if (enabled) {
          scheduleNext();
        }
      }
    }, delay);
  }, [baseIntervalMs, jitterMs, enabled]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Запускаем первый цикл
    scheduleNext();

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, scheduleNext]);
}
