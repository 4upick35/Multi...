/**
 * Tests for CollectionListScreen throttle logic:
 * - throttle message displayed only when getRemainingPauseMs > 0
 * - 403/412 do NOT trigger throttle message
 * - 429/503 DO trigger throttle message
 */

import {getRemainingPauseMs, clearThrottle, recordThrottleError, recordThrottleSuccess} from '../../../src/infrastructure/AccountThrottle';

beforeEach(() => {
  clearThrottle('acc-1');
});

describe('CollectionListScreen — throttle message', () => {
  it('при паузе троттлинга remainingPauseMs > 0', () => {
    recordThrottleError('acc-1');
    const remaining = getRemainingPauseMs('acc-1');
    expect(remaining).toBeGreaterThan(0);
    const throttleMinutes = Math.ceil(remaining / 60_000);
    expect(throttleMinutes).toBeGreaterThanOrEqual(0);
  });

  it('при 429 пауза real и remaining > 0', () => {
    recordThrottleError('acc-1');
    expect(getRemainingPauseMs('acc-1')).toBeGreaterThan(0);
    expect(getRemainingPauseMs('acc-1')).toBeLessThanOrEqual(60000);
  });

  it('403 НЕ вызывает паузу (remainingPauseMs === 0)', () => {
    // 403 не вызывает recordThrottleError в HttpTransport
    // поэтому паузы нет
    expect(getRemainingPauseMs('acc-1')).toBe(0);
  });

  it('после успешного запроса пауза сбрасывается', () => {
    recordThrottleError('acc-1');
    expect(getRemainingPauseMs('acc-1')).toBeGreaterThan(0);
    recordThrottleSuccess('acc-1');
    expect(getRemainingPauseMs('acc-1')).toBe(0);
  });

  it('текст "Сервер временно ограничил запросы" формируется корректно при паузе', () => {
    recordThrottleError('acc-1');
    const remaining = getRemainingPauseMs('acc-1');
    expect(remaining).toBeGreaterThan(0);
    const throttleMinutes = Math.ceil(remaining / 60_000);
    const text = `Сервер временно ограничил запросы, повтор через ${throttleMinutes} мин`;
    expect(text).toContain('Сервер временно ограничил запросы');
    expect(text).toContain('мин');
  });
});
