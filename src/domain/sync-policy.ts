import {MAX_POLL_INTERVAL_SEC, QUEUE_MIN_GAP_MS} from '../config/constants';

/** Адаптивный интервал опроса: baseMs × 2^idle, но не больше MAX_POLL_INTERVAL_SEC. */
export function computeAdaptiveIntervalMs(baseMs: number, idle: number): number {
  return Math.min(baseMs * Math.pow(2, Math.max(0, idle)), MAX_POLL_INTERVAL_SEC * 1000);
}

/** Разнос очереди: интервал / число учёток, но не меньше QUEUE_MIN_GAP_MS. */
export function computeQueueGapMs(intervalMs: number, queueCount: number): number {
  const n = Math.max(1, Math.floor(queueCount));
  return Math.max(QUEUE_MIN_GAP_MS, Math.round(intervalMs / n));
}
