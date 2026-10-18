/**
 * Разнос очереди опроса учёток: computeQueueGapMs из src/services/applications-sync.ts.
 *
 * Чистая функция: разнос = интервал опроса / число учёток в очереди,
 * но не меньше QUEUE_MIN_GAP_MS (страховочный минимум 1000 мс).
 *
 * Реальной сети нет: сторы/тикеры замоканы — импортируется только модуль
 * applications-sync ради экспортированной функции.
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

import {computeQueueGapMs} from '../../src/domain/sync-policy';

describe('applications-sync — computeQueueGapMs', () => {
  it('интервал делится на число учёток очереди', () => {
    expect(computeQueueGapMs(15_000, 4)).toBe(3_750);
  });

  it('одна учётка в очереди — разнос равен интервалу', () => {
    expect(computeQueueGapMs(15_000, 1)).toBe(15_000);
  });

  it('очередь больше интервала — страховочный минимум QUEUE_MIN_GAP_MS (1000 мс)', () => {
    expect(computeQueueGapMs(15_000, 100)).toBe(1_000);
  });

  it('некорректный (0) счётчик очереди принимается как 1 учётка', () => {
    expect(computeQueueGapMs(30_000, 0)).toBe(30_000);
  });

  it('короткий интервал не опускает разнос ниже 1000 мс', () => {
    expect(computeQueueGapMs(500, 4)).toBe(1_000);
  });
});
