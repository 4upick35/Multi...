// ---------------------------------------------------------------------------
// Account-level throttling for 429/503 responses.
// 403/412 are treated as noise — no pause, soft counter only.
// Real pauses: 30s → 60s (max), only for repeated 429/503.
// ---------------------------------------------------------------------------

import {logDiag} from '../diag/accept-log';
import {delay} from '../native/KeepAlive';
import {maskValue} from '../utils/mask';

export type ThrottleStatus = 'active' | 'paused' | 'cooldown';

interface AccountPauseState {
  status: ThrottleStatus;
  pauseUntil: number;
  consecutive429503: number;
  lastPauseAt: number;
  backoffMs: number;
}

const INITIAL_PAUSE_MS = 30_000;
const MAX_PAUSE_MS = 60_000;
const COOLDOWN_MS = 5_000;
// Бан ELMA длится ~5 минут: сервер отвечает 200 с пустыми списками;
// пока пауза активна — не отправляем ничего, иначе серия запросов продлевает бан.
const BAN_PAUSE_MS = 5 * 60_000;

const pauses = new Map<string, AccountPauseState>();

export function isPaused(accountId: string): boolean {
  const state = pauses.get(accountId);
  if (!state) return false;
  if (state.status === 'active') return false;
  if (Date.now() >= state.pauseUntil) {
    state.status = 'cooldown';
    state.pauseUntil = Date.now() + COOLDOWN_MS;
    return false;
  }
  return true;
}

export function getRemainingPauseMs(accountId: string): number {
  const state = pauses.get(accountId);
  if (!state || state.status === 'active') return 0;
  return Math.max(0, state.pauseUntil - Date.now());
}

export function recordThrottleError(accountId: string): void {
  const state = pauses.get(accountId) ?? {
    status: 'active' as ThrottleStatus,
    pauseUntil: 0,
    consecutive429503: 0,
    lastPauseAt: 0,
    backoffMs: INITIAL_PAUSE_MS,
  };
  state.consecutive429503 += 1;
  state.backoffMs = state.consecutive429503 === 1
    ? INITIAL_PAUSE_MS
    : Math.min(state.backoffMs * 2, MAX_PAUSE_MS);
  state.pauseUntil = Date.now() + state.backoffMs;
  state.status = 'paused';
  state.lastPauseAt = Date.now();
  pauses.set(accountId, state);

  const seconds = Math.round(state.backoffMs / 1000);
  logDiag('throttle', `account=${maskValue(accountId)} paused=${seconds}s errors=${state.consecutive429503}`);
}

export function recordThrottleSuccess(accountId: string): void {
  const state = pauses.get(accountId);
  if (!state || state.consecutive429503 === 0) return;
  state.consecutive429503 = 0;
  state.status = 'active';
  state.backoffMs = INITIAL_PAUSE_MS;
  state.pauseUntil = 0;
  pauses.set(accountId, state);
}

export function clearThrottle(accountId: string): void {
  pauses.delete(accountId);
}

/**
 * Бан ELMA: сервер отвечает 200 с пустыми списками ~5 минут.
 * Ставим паузу, чтобы серия запросов не продлевала бан.
 * recordThrottleSuccess бан-паузу не сбрасывает: он выходит по
 * consecutive429503 === 0, а recordBanSignal этот счётчик не увеличивает.
 */
export function recordBanSignal(accountId: string, reason: string): void {
  const state = pauses.get(accountId) ?? {status: 'active' as ThrottleStatus, pauseUntil: 0, consecutive429503: 0, lastPauseAt: 0, backoffMs: BAN_PAUSE_MS};
  state.status = 'paused';
  state.backoffMs = BAN_PAUSE_MS;
  state.pauseUntil = Date.now() + BAN_PAUSE_MS;
  state.lastPauseAt = Date.now();
  pauses.set(accountId, state);
  logDiag('throttle', 'ban-signal account=' + maskValue(accountId) + ' pause=' + Math.round(BAN_PAUSE_MS / 1000) + 's reason=' + reason);
}

export function getThrottleState(accountId: string): AccountPauseState | undefined {
  return pauses.get(accountId);
}

export async function maybeWaitForAccount(accountId: string): Promise<boolean> {
  if (!isPaused(accountId)) return false;
  const remaining = getRemainingPauseMs(accountId);
  if (remaining > 0) {
    await delay(Math.min(remaining, 1000));
    return true;
  }
  return false;
}
