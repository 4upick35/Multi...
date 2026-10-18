/**
 * Ускоренный (foreground) опрос заявок: src/services/applications-sync.ts.
 *
 * Наблюдаемое поведение (dueAt наружу не выдаётся, поэтому проверяем
 * моменты вызовов loadCollection):
 *  (а) после setForegroundAccounts(['acc-1']) и успешного обновления следующие
 *      вызовы идут заметно чаще обычного интервала (~5 с вместо >=15 с);
 *  (б) после ошибки загрузки ускорение НЕ действует: повтор не раньше
 *      обычного интервала, хотя foreground-учётка задана;
 *  (в) setForegroundAccount(null) возвращает обычное поведение
 *      (разнос очереди = интервал/число учёток, интервал >=15 с).
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
  const state = {pollIntervalSec: 30, syncPaused: false, priorityAccountIds: [] as string[]};
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
  setForegroundAccounts,
} from '../../src/services/applications-sync';
import {SYNC_TICK_EVENT} from '../../src/native/KeepAlive';
import {loadCollection} from '../../src/services/customer-service';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import type {ElmaAccount} from '../../src/types/account';

const mockLoadCollection = loadCollection as jest.MockedFunction<typeof loadCollection>;

/** pollIntervalSec=15 c Math.random→0: обычный интервал опроса ровно 15 с. */
const NORMAL_INTERVAL_MS = 15_000;
/** Math.random→0: разнос очереди для одной учётки @15 с (= её интервал). */
const GAP_MS = 15_000;
/** Math.random→0: разнос для двух учёток @15 с (15000/2 = 7500 → тик на 8 с). */
const TWO_ACCOUNT_GAP_MS = 8_000;
/** Math.random→0: ускоренный интервал (FAST_POLL_INTERVAL_SEC). */
const BOOST_INTERVAL_MS = 5_000;
/** Math.random→0: ускоренный разнос (FAST_MIN_GAP_MS). */
const BOOST_GAP_MS = 4_000;

/** Моменты вызовов loadCollection (для проверки интервалов). */
let callTimes: number[] = [];

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

/** Нативный тикер «прокачал» один тик в JS. */
function emitTick(): void {
  DeviceEventEmitter.emit(SYNC_TICK_EVENT);
}

/** Прокачать ms миллисекунд, испуская тик каждую секунду. */
async function tickFor(ms: number): Promise<void> {
  for (let passed = 0; passed < ms; passed += 1_000) {
    await jest.advanceTimersByTimeAsync(1_000);
    emitTick();
  }
}

/** Первая загрузка успешна, все последующие — ошибка kind='other'. */
function failAfterFirstSuccess(): void {
  mockLoadCollection.mockImplementation(async () => {
    callTimes.push(Date.now());
    if (callTimes.length === 1) {
      return {ok: true};
    }
    return {ok: false, error: 'boom', kind: 'other'};
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Math, 'random').mockReturnValue(0);
  callTimes = [];

  const settings = useSettingsStore.getState();
  settings.pollIntervalSec = NORMAL_INTERVAL_MS / 1000;
  settings.syncPaused = false;
  useAuthStore.getState().accounts = [acc1];
  const lastRefreshAt = useCustomerServiceStore.getState().lastRefreshAt;
  Object.keys(lastRefreshAt).forEach(key => delete lastRefreshAt[key]);

  mockLoadCollection.mockImplementation(async () => {
    callTimes.push(Date.now());
    return {ok: true};
  });
});

afterEach(() => {
  stopApplicationsSync();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ===========================================================================
// (а) Boost: после setForegroundAccount обновления идут ~ каждые 5 с
// ===========================================================================

describe('applications-sync — foreground-ускорение', () => {
  it('после setForegroundAccount и успеха следующие обновления чаще обычного интервала', async () => {
    startApplicationsSync([acc1]);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    expect(callTimes).toHaveLength(1);

    // dueAt учётки сейчас в будущем (t0+15 с) — сбрасываем в 0.
    setForegroundAccounts(['acc-1']);

    // Обычный разнос 10 с / обычный интервал 15 с — здесь boost: 4 с.
    await tickFor(BOOST_GAP_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    expect(callTimes[1] - callTimes[0]).toBe(BOOST_GAP_MS);

    // Следующее обновление через BOOST_INTERVAL_MS (5 с) вместо >=15 с.
    await tickFor(BOOST_INTERVAL_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    expect(callTimes[2] - callTimes[1]).toBe(BOOST_INTERVAL_MS);
    expect(callTimes[2] - callTimes[1]).toBeLessThan(NORMAL_INTERVAL_MS);
  });

  it('без setForegroundAccount: без изменений данных интервал адаптивно растёт', async () => {
    startApplicationsSync([acc1]);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);

    // 1-й повтор: idle=0 → обычный интервал (разнос очереди 15 с его маскирует).
    await tickFor(NORMAL_INTERVAL_MS - 1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    await tickFor(1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    expect(callTimes[1] - callTimes[0]).toBe(NORMAL_INTERVAL_MS);

    // 2-й повтор: sig не изменился → idle=1 → ×2 ±20%
    // (Math.random→0 → effective − 20% = 24 с вместо 15 с).
    const ADAPTIVE_INTERVAL_MS = NORMAL_INTERVAL_MS * 2 - Math.round(NORMAL_INTERVAL_MS * 2 * 0.2);
    await tickFor(ADAPTIVE_INTERVAL_MS - 1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    await tickFor(1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    expect(callTimes[2] - callTimes[1]).toBe(ADAPTIVE_INTERVAL_MS);
    // Для одной учётки разнос очереди совпадает с её интервалом опроса.
    expect(GAP_MS).toBe(NORMAL_INTERVAL_MS);
  });
  it('две учётки ускоряются обе: обе успевают за ~8 с вместо 15 с на каждую', async () => {
    const acc2 = makeAccount('acc-2');
    useAuthStore.getState().accounts = [acc1, acc2];

    startApplicationsSync([acc1, acc2]);
    await jest.advanceTimersByTimeAsync(0);
    // Первая учётка — сразу, вторая — после обычного разноса.
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    await tickFor(TWO_ACCOUNT_GAP_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    expect(callTimes[1] - callTimes[0]).toBe(TWO_ACCOUNT_GAP_MS);

    setForegroundAccounts(['acc-1', 'acc-2']);

    // Обе учётки обновляются по кругу: старт каждые 4 с, полный круг ~8 с.
    await tickFor(BOOST_GAP_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    await tickFor(BOOST_GAP_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(4);
    expect(callTimes[2] - callTimes[1]).toBe(BOOST_GAP_MS);
    expect(callTimes[3] - callTimes[2]).toBe(BOOST_GAP_MS);
    expect(callTimes[3] - callTimes[1]).toBeLessThan(NORMAL_INTERVAL_MS);
  });
});

// ===========================================================================
// (б) После ошибки ускорение не действует
// ===========================================================================

describe('applications-sync — нет ускорения после сбоя', () => {
  it('после ошибки загрузки повтор идёт не раньше обычного интервала', async () => {
    failAfterFirstSuccess();

    startApplicationsSync([acc1]);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);

    setForegroundAccounts(['acc-1']);

    // Вторая попытка ускорена (разнос 4 с) и падает → boost выключается.
    await tickFor(BOOST_GAP_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // Ускорённый повтор был бы на +5 с (t=9 с); обычный — на +15 с (t=19 с).
    // Тикаем до t=14 с: ускорённый повтор уже случился бы, обычный — ещё нет.
    await tickFor(NORMAL_INTERVAL_MS - BOOST_GAP_MS - 1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // Обычный интервал от момента ошибки: вызов на t=19 с.
    await tickFor(5_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(NORMAL_INTERVAL_MS);
  });
});

// ===========================================================================
// (в) setForegroundAccount(null) возвращает обычное поведение
// ===========================================================================

describe('applications-sync — снятие foreground-ускорения', () => {
  it('после setForegroundAccount(null) разнос и интервал снова обычные', async () => {
    startApplicationsSync([acc1]);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);

    // Включаем и сразу выключаем: dueAt уже сброшен в 0, но boost выключен.
    setForegroundAccounts(['acc-1']);
    setForegroundAccounts([]);

    // Без boost первый возможен только после обычного разноса 10 с
    // (boost позволил бы старт уже на 4-й секунде).
    await tickFor(GAP_MS - 1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    await tickFor(1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    expect(callTimes[1] - callTimes[0]).toBe(GAP_MS);

    // Дальше обычный интервал (boost дал бы повтор уже через 5 с).
    await tickFor(NORMAL_INTERVAL_MS - 1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    await tickFor(1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    expect(callTimes[2] - callTimes[1]).toBe(NORMAL_INTERVAL_MS);
  });

  it('после сбоя setForegroundAccount(null) не ускоряет повтор', async () => {
    failAfterFirstSuccess();

    startApplicationsSync([acc1]);
    await jest.advanceTimersByTimeAsync(0);
    setForegroundAccounts(['acc-1']);

    // Ошибка на ускоренном разносе (t=4 с), затем foreground снят.
    await tickFor(BOOST_GAP_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    setForegroundAccounts([]);

    // Повтор после сбоя — не раньше обычного интервала от момента ошибки.
    await tickFor(NORMAL_INTERVAL_MS - BOOST_GAP_MS - 1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
    await tickFor(5_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(NORMAL_INTERVAL_MS);
  });
});
