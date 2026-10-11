import {
  ACCOUNT_SYNC_MIN_GAP_MS,
  ACCOUNT_SYNC_GAP_JITTER_MS,
} from '../config/constants';

/** Следующий интервал опроса учётки: base + rand(0..jitter). */
export function nextAccountIntervalMs(baseIntervalMs: number, jitterMs: number): number {
  return baseIntervalMs + Math.floor(Math.random() * jitterMs);
}

/** Случайный разнос между стартами: MIN_GAP + rand(0..GAP_JITTER). */
export function nextAccountGapMs(): number {
  return ACCOUNT_SYNC_MIN_GAP_MS + Math.floor(Math.random() * ACCOUNT_SYNC_GAP_JITTER_MS);
}
