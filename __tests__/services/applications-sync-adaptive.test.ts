/**
 * Адаптивный опрос заявок: computeAdaptiveIntervalMs и resetAdaptivePolling
 * из src/services/applications-sync.ts.
 *
 * При отсутствии изменений интервал учётки удваивается до MAX_POLL_INTERVAL_SEC:
 * idle=0 → base, idle=1 → ×2, idle=3 → ×8, потолок 120 с.
 *
 * Реальной сети нет: сторы/тикеры замоканы — импортируется только модуль
 * applications-sync ради экспортированных функций.
 */

jest.mock('../../src/native/KeepAlive', () => ({
  SYNC_TICK_EVENT: 'multiElmaSyncTick',
  startSyncTicker: jest.fn(),
  stopSyncTicker: jest.fn(),
  delay: jest.fn(() => Promise.resolve()),
  isDiagBuild: false,
  getCookies: jest.fn(async () => null),
}));

jest.mock('../../src/services/customer-service', () => ({
  loadCollection: jest.fn(),
  loadCollectionPage: jest.fn(),
  searchCollection: jest.fn(),
  getWorkCalendar: jest.fn(),
}));

jest.mock('../../src/store/auth-store', () => {
  const state = {accounts: [] as unknown[]};
  return {useAuthStore: {getState: jest.fn(() => state)}};
});

jest.mock('../../src/store/settings-store', () => {
  const state = {
    pollIntervalSec: 15,
    syncPaused: false,
    priorityAccountIds: [] as string[],
    pushMode: false,
  };
  return {useSettingsStore: {getState: jest.fn(() => state)}};
});

jest.mock('../../src/store/customer-service-store', () => {
  const lastRefreshAt: Record<string, number> = {};
  const setLastRefreshAt = jest.fn((accountId: string, ts: number) => {
    lastRefreshAt[accountId] = ts;
  });
  const getItems = jest.fn(() => []);
  const state = {lastRefreshAt, setLastRefreshAt, getItems};
  return {useCustomerServiceStore: {getState: jest.fn(() => state)}};
});

jest.mock('../../src/diag/accept-log', () => ({
  logDiag: jest.fn(),
  getDiagLog: jest.fn(() => ''),
  hasDiagLog: jest.fn(() => false),
  shareDiagLog: jest.fn(() => Promise.resolve()),
  shareCookieBank: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/services/realtime', () => ({
  isRealtimeSubscribed: jest.fn(() => false),
}));

import {computeAdaptiveIntervalMs} from '../../src/domain/sync-policy';
import {resetAdaptivePolling} from '../../src/services/applications-sync';
import {MAX_POLL_INTERVAL_SEC} from '../../src/config/constants';

describe('applications-sync — computeAdaptiveIntervalMs', () => {
  it('idle=0 → базовый интервал', () => {
    expect(computeAdaptiveIntervalMs(15_000, 0)).toBe(15_000);
  });

  it('idle=1 → двойной интервал', () => {
    expect(computeAdaptiveIntervalMs(15_000, 1)).toBe(30_000);
  });

  it('idle=3 → восьмой интервал', () => {
    expect(computeAdaptiveIntervalMs(5_000, 3)).toBe(40_000);
  });

  it('потолок — MAX_POLL_INTERVAL_SEC (120 с)', () => {
    expect(computeAdaptiveIntervalMs(60_000, 2)).toBe(MAX_POLL_INTERVAL_SEC * 1000);
    expect(computeAdaptiveIntervalMs(60_000, 5)).toBe(120_000);
  });

  it('отрицательный idle принимается как 0', () => {
    expect(computeAdaptiveIntervalMs(15_000, -3)).toBe(15_000);
  });
});

describe('applications-sync — resetAdaptivePolling', () => {
  it('не падает без запуска синхронизации (без аргументов и с id)', () => {
    expect(() => resetAdaptivePolling()).not.toThrow();
    expect(() => resetAdaptivePolling(['acc-1', 'acc-2'])).not.toThrow();
    expect(() => resetAdaptivePolling([])).not.toThrow();
  });
});
