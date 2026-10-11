/**
 * Watchdog (self-recovery) фоновой синхронизации заявок
 * (src/services/applications-sync.ts).
 *
 * Наблюдаемое поведение:
 *  (а) нативный тикер молчит (нет SYNC_TICK_EVENT) дольше
 *      SELF_RECOVERY_MULTIPLIER × интервал → watchdog перезапускает тикер
 *      (повторный startSyncTicker), переподписывается и сразу прогоняет тик;
 *      живой тикер, наоборот, повторного запуска не провоцирует;
 *  (б) «зависший» refreshApplicationsNow (флаг refreshAllNowRunning не может
 *      сброситься сам) принудительно сбрасывается по REFRESH_ALL_TIMEOUT_MS,
 *      после чего тик снова запускает обновление, а не пропускается навсегда.
 *
 * Реальной сети нет: loadCollection замокан, KeepAlive (тикер/delay) замокан,
 * сторы (auth/settings/customer-service) замоканы.
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
  const state = {pollIntervalSec: 30, syncPaused: false};
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

import {DeviceEventEmitter} from 'react-native';
import {
  startApplicationsSync,
  stopApplicationsSync,
  refreshApplicationsNow,
  getLastTickAt,
  getRefreshAllStartedAt,
} from '../../src/services/applications-sync';
import {startSyncTicker, stopSyncTicker, delay, SYNC_TICK_EVENT} from '../../src/native/KeepAlive';
import {loadCollection} from '../../src/services/customer-service';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import type {ElmaAccount} from '../../src/types/account';

const mockStartSyncTicker = startSyncTicker as jest.MockedFunction<typeof startSyncTicker>;
const mockStopSyncTicker = stopSyncTicker as jest.MockedFunction<typeof stopSyncTicker>;
const mockDelay = delay as jest.MockedFunction<typeof delay>;
const mockLoadCollection = loadCollection as jest.MockedFunction<typeof loadCollection>;

/** pollIntervalSec=5 c Math.random→0: интервал опроса ровно 5 с. */
const TICK_MS = 5_000;
/** Watchdog опрашивает раз в min(3 × интервал, 30 с) = 15 с. */
const WATCHDOG_MS = TICK_MS * 3;
/** Жёсткий таймаут зависшего refreshAllNow. */
const REFRESH_ALL_TIMEOUT_MS = 20_000;
/** Разнос между стартами учёток (ACCOUNT_SYNC_MIN_GAP_MS, джиттер обнулён). */
const GAP_MS = 10_000;

function makeAccount(id: string): ElmaAccount {
  return {
    id,
    name: id,
    baseUrl: 'https://elma.example',
    portal: 'p',
    token: 'tok',
    userId: id,
    color: '#6200EE',
    isActive: true,
  };
}

const acc1 = makeAccount('acc-1');
const acc2 = makeAccount('acc-2');

/** Нативный тикер «прокачал» один тик в JS. */
function emitTick(): void {
  DeviceEventEmitter.emit(SYNC_TICK_EVENT);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Math, 'random').mockReturnValue(0);

  const settings = useSettingsStore.getState();
  settings.pollIntervalSec = TICK_MS / 1000;
  settings.syncPaused = false;
  useAuthStore.getState().accounts = [acc1, acc2];
  // Чистим in-place: setLastRefreshAt пишет в тот же объект.
  const lastRefreshAt = useCustomerServiceStore.getState().lastRefreshAt;
  Object.keys(lastRefreshAt).forEach(key => delete lastRefreshAt[key]);

  mockLoadCollection.mockResolvedValue({ok: true});
  mockDelay.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  stopApplicationsSync();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ===========================================================================
// (а) Долгое молчание тикера → перезапуск тикера
// ===========================================================================

describe('applications-sync — watchdog перезапускает молчащий тикер', () => {
  it('тикер молчит дольше 3 × интервал → повторный startSyncTicker', async () => {
    startApplicationsSync([acc1]);

    expect(mockStartSyncTicker).toHaveBeenCalledTimes(1);
    // Второй вызов stopSyncTicker — стартовая остановка внутри startApplicationsSync.
    expect(mockStopSyncTicker).toHaveBeenCalledTimes(1);
    const startedAt = getLastTickAt();
    expect(startedAt).toBe(Date.now());

    // Даём стартовому обновлению завершиться (inflight снимается в finally).
    await jest.advanceTimersByTimeAsync(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);

    // До порога watchdog молчит: тикер не перезапускается, lastTickAt не двигается.
    await jest.advanceTimersByTimeAsync(WATCHDOG_MS);
    expect(mockStartSyncTicker).toHaveBeenCalledTimes(1);
    expect(getLastTickAt()).toBe(startedAt);

    // Ни одного SYNC_TICK_EVENT за 3 × интервал — самовосстановление.
    await jest.advanceTimersByTimeAsync(WATCHDOG_MS);
    expect(mockStartSyncTicker).toHaveBeenCalledTimes(2);
    expect(mockStopSyncTicker).toHaveBeenCalledTimes(2);
    // Watchdog переподписался и сам прогнал тик: lastTickAt обновлён.
    expect(getLastTickAt()).toBe(startedAt + 2 * WATCHDOG_MS);
    // Тик после перезапуска запускает отложенное обновление.
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
  });

  it('живой тикер не провоцирует watchdog: повторного startSyncTicker нет', async () => {
    startApplicationsSync([acc1]);
    expect(mockStartSyncTicker).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 40; i += 1) {
      await jest.advanceTimersByTimeAsync(1_000);
      emitTick();
    }

    expect(getLastTickAt()).toBe(Date.now());
    expect(mockStartSyncTicker).toHaveBeenCalledTimes(1);
    expect(mockStopSyncTicker).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// (б) Зависший refreshAllNow → сброс по таймауту → тик снова обновляет
// ===========================================================================

describe('applications-sync — сброс зависшего refreshAllNow по таймауту', () => {
  it('до REFRESH_ALL_TIMEOUT_MS тик заблокирован, после сброса тик снова запускает обновление', async () => {
    // Пауза между учётками внутри refreshApplicationsNow «зависает» навсегда:
    // finally не выполняется, флаг refreshAllNowRunning не сбрасывается сам.
    mockDelay.mockImplementation(() => new Promise<void>(() => {}));

    startApplicationsSync([acc1, acc2]);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    const startedAt = Date.now();

    refreshApplicationsNow();
    expect(getRefreshAllStartedAt()).toBe(startedAt);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // Тик раньше таймаута: обновление заблокировано, сбрасывать рано.
    await jest.advanceTimersByTimeAsync(5_000);
    emitTick();
    expect(getRefreshAllStartedAt()).toBe(startedAt);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // Прошло больше REFRESH_ALL_TIMEOUT_MS: тик принудительно снимает флаг
    // и по обычному пути запускает обновление просроченной учётки.
    await jest.advanceTimersByTimeAsync(REFRESH_ALL_TIMEOUT_MS - 5_000 + 1);
    emitTick();
    expect(getRefreshAllStartedAt()).toBe(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    expect(getLastTickAt()).toBe(startedAt + REFRESH_ALL_TIMEOUT_MS + 1);
  });

  it('повторный refreshApplicationsNow пока флаг жив — no-op (без второго обновления)', async () => {
    startApplicationsSync([acc1, acc2]);
    await jest.advanceTimersByTimeAsync(0);
    const startedAt = Date.now();
    const callsAfterStart = mockLoadCollection.mock.calls.length;

    refreshApplicationsNow();
    refreshApplicationsNow();
    refreshApplicationsNow();

    expect(getRefreshAllStartedAt()).toBe(startedAt);
    expect(mockLoadCollection).toHaveBeenCalledTimes(callsAfterStart + 1);
  });

  it('после успешного завершения refreshAllNow флаг сбрасывается штатно и тики не блокируются', async () => {
    startApplicationsSync([acc1, acc2]);
    await jest.advanceTimersByTimeAsync(0);
    const callsAfterStart = mockLoadCollection.mock.calls.length;

    await refreshApplicationsNow();
    expect(getRefreshAllStartedAt()).toBe(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(callsAfterStart + 2);

    // Штатные тики продолжают запускать обновления.
    await jest.advanceTimersByTimeAsync(GAP_MS);
    emitTick();
    expect(getRefreshAllStartedAt()).toBe(0);
    expect(mockLoadCollection.mock.calls.length).toBeGreaterThan(callsAfterStart + 2);
  });
});
