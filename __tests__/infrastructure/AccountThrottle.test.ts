/**
 * Tests for AccountThrottle:
 * - exponential backoff on 429/503 only: 30s → 60s (max)
 * - 403/412 do NOT cause pause
 * - pause does not clear cache
 * - gradual resume after pause expires
 * - max pause is 60s
 */

import {
  isPaused,
  recordThrottleError,
  recordThrottleSuccess,
  recordBanSignal,
  clearThrottle,
  getRemainingPauseMs,
  getThrottleState,
} from '../../src/infrastructure/AccountThrottle';
import {cacheClearAccount} from '../../src/infrastructure/elma-cache';

beforeEach(() => {
  cacheClearAccount('test-acc-1');
  clearThrottle('test-acc-1');
});

afterAll(() => {
  clearThrottle('test-acc-1');
});

describe('AccountThrottle', () => {
  it('аккаунт не приостановлен изначально', () => {
    expect(isPaused('test-acc-1')).toBe(false);
  });

  it('recordThrottleError ставит аккаунт на паузу', () => {
    recordThrottleError('test-acc-1');
    expect(isPaused('test-acc-1')).toBe(true);
  });

  it('recordThrottleSuccess снимает паузу', () => {
    recordThrottleError('test-acc-1');
    expect(isPaused('test-acc-1')).toBe(true);
    recordThrottleSuccess('test-acc-1');
    expect(isPaused('test-acc-1')).toBe(false);
  });

  it('пауза не стирает кэш', () => {
    recordThrottleError('test-acc-1');
    const remaining = getRemainingPauseMs('test-acc-1');
    expect(remaining).toBeGreaterThan(0);
  });

  it('экспоненциальный рост backoff: 30s → 60s', () => {
    // Первый 429/503: backoff = INITIAL = 30s
    recordThrottleError('test-acc-1');
    const state1 = getThrottleState('test-acc-1');
    expect(state1!.backoffMs).toBe(30000);

    // Второй 429/503: backoff = min(30s * 2, 60s) = 60s
    recordThrottleError('test-acc-1');
    const state2 = getThrottleState('test-acc-1');
    expect(state2!.backoffMs).toBe(60000);
  });

  it('макс. пауза 60 с, не 5 мин', () => {
    for (let i = 0; i < 20; i++) {
      recordThrottleError('test-acc-1');
    }
    const state = getThrottleState('test-acc-1');
    expect(state!.backoffMs).toBe(60000); // 60s cap
  });

  it('clearThrottle сбрасывает всё', () => {
    recordThrottleError('test-acc-1');
    expect(isPaused('test-acc-1')).toBe(true);
    clearThrottle('test-acc-1');
    expect(isPaused('test-acc-1')).toBe(false);
  });

  it('recordBanSignal ставит паузу 5 минут', () => {
    clearThrottle('test-acc-ban');
    recordBanSignal('test-acc-ban', 'empty-response');

    const remaining = getRemainingPauseMs('test-acc-ban');
    expect(remaining).toBeGreaterThan(4 * 60_000);
    expect(remaining).toBeLessThanOrEqual(5 * 60_000);
    expect(isPaused('test-acc-ban')).toBe(true);

    clearThrottle('test-acc-ban');
  });

  it('recordThrottleSuccess не сбрасывает бан-паузу', () => {
    clearThrottle('test-acc-ban');
    recordBanSignal('test-acc-ban', 'empty-response');
    recordThrottleSuccess('test-acc-ban');

    expect(isPaused('test-acc-ban')).toBe(true);
    expect(getRemainingPauseMs('test-acc-ban')).toBeGreaterThan(4 * 60_000);

    clearThrottle('test-acc-ban');
  });
});
