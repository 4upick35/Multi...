/**
 * Пропущенные ветки src/services/applications-sync.ts:
 *
 *  (а) overdue-ветка onSyncTick: учётка очереди, у которой последний успешный
 *      обновление старше 2 × pollIntervalSec, берётся в работу в первую
 *      очередь — даже если более ранняя по dueAt учётка только что обновлялась;
 *  (б) ACCOUNT_TIMEOUT_MS в refreshApplicationsNow: зависший loadCollection
 *      обрывается таймаутом 15 с, dueAt сдвигается, флаг refreshAllNow
 *      сбрасывается — обход завершается, а не висит;
 *  (в) kind='unauthorized' в refreshOneAccount: это НЕ сетевой сбой
 *      (бэкофф 5 с с удвоением), а обычный интервал опроса.
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

jest.mock('../../src/diag/accept-log', () => ({
  logDiag: jest.fn(),
  getDiagLog: jest.fn(() => ''),
  hasDiagLog: jest.fn(() => false),
  shareDiagLog: jest.fn(() => Promise.resolve()),
  shareCookieBank: jest.fn(() => Promise.resolve()),
}));

import {DeviceEventEmitter} from 'react-native';
import {
  startApplicationsSync,
  stopApplicationsSync,
  refreshApplicationsNow,
  setForegroundAccounts,
  getRefreshAllStartedAt,
} from '../../src/services/applications-sync';
import {SYNC_TICK_EVENT} from '../../src/native/KeepAlive';
import {loadCollection} from '../../src/services/customer-service';
import {logDiag} from '../../src/diag/accept-log';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import type {ElmaAccount} from '../../src/types/account';

const mockLoadCollection = loadCollection as jest.MockedFunction<typeof loadCollection>;
const mockLogDiag = logDiag as jest.MockedFunction<typeof logDiag>;

/** pollIntervalSec=30 c Math.random→0: обычный интервал опроса ровно 30 с. */
const NORMAL_INTERVAL_MS = 30_000;
/** Разнос очереди: интервал/число учёток (2 учётки @30 с → 15 с), джиттер 0. */
const GAP_MS = 15_000;
/** Жёсткий таймаут одного запроса в refreshApplicationsNow. */
const ACCOUNT_TIMEOUT_MS = 15_000;
/** Сдвиг dueAt после таймаута запроса (THROTTLE_MAX_SHIFT_MS). */
const TIMEOUT_SHIFT_MS = 30_000;

type Call = {id: string; t: number};

/** Моменты вызовов loadCollection с указанием учётки. */
let calls: Call[] = [];

function callsFor(id: string): Call[] {
  return calls.filter(c => c.id === id);
}

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

/** Прокачать ms миллисекунд, испуская тик каждую секунду. */
async function tickFor(ms: number): Promise<void> {
  for (let passed = 0; passed < ms; passed += 1_000) {
    await jest.advanceTimersByTimeAsync(1_000);
    emitTick();
  }
}

/** Дождаться завершения уже запущенных (asynchronous) обновлений. */
async function flush(): Promise<void> {
  await jest.advanceTimersByTimeAsync(0);
}

/** Была ли в diag-логе строка с указанным фрагментом. */
function diagLogged(fragment: string): boolean {
  return mockLogDiag.mock.calls.some(
    call => String(call[1]).includes(fragment),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Math, 'random').mockImplementation(() => 0);
  calls = [];

  const settings = useSettingsStore.getState();
  settings.pollIntervalSec = NORMAL_INTERVAL_MS / 1000;
  settings.syncPaused = false;
  settings.priorityAccountIds = [];
  useAuthStore.getState().accounts = [acc1, acc2];
  const lastRefreshAt = useCustomerServiceStore.getState().lastRefreshAt;
  Object.keys(lastRefreshAt).forEach(key => delete lastRefreshAt[key]);

  mockLoadCollection.mockImplementation(async account => {
    calls.push({id: account.id, t: Date.now()});
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
// (а) Overdue-ветка onSyncTick: просроченная учётка важнее свежей с тем же due
// ===========================================================================

describe('applications-sync — overdue-ветка onSyncTick', () => {
  it('берёт в работу учётку без свежего обновления, хотя acc-1 уже due и обновлялась только что', async () => {
    // acc-1 обновляется успешно (lastRefreshAt = сейчас), acc-2 — нет:
    // её lastRefreshAt остаётся 0 → она «просрочена» (now - 0 > 2 × интервал).
    mockLoadCollection.mockImplementation(async account => {
      calls.push({id: account.id, t: Date.now()});
      if (account.id === 'acc-1') {
        return {ok: true};
      }
      return {ok: false, error: 'boom', kind: 'other'};
    });

    // acc-2 просрочена → очередь приходит к ней раньше, чем due acc-1 (30 с).
    setForegroundAccounts(['acc-1', 'acc-2']);

    const startedAt = Date.now();
    startApplicationsSync([acc1, acc2]);
    await flush();
    expect(calls.map(c => c.id)).toEqual(['acc-1']);

    // t=10 с: acc-2 просрочена → очередь приходит к ней раньше, чем due acc-1 (30 с).
    await tickFor(GAP_MS);
    await flush();
    expect(callsFor('acc-2')).toHaveLength(1);
    expect(callsFor('acc-1')).toHaveLength(1);

    // Свежая acc-1 и просроченная acc-2 ставятся в очередь одновременно (due=0);
    // первый тик, который пройдёт разнос очереди, — t=20 с (gap после старта acc-2).
    setForegroundAccounts(['acc-1', 'acc-2']);
    await tickFor(GAP_MS);
    await flush();

    // На общем due=0 выбрана ИМЕННО просроченная acc-2: без overdue-ветки
    // кандидатом стала бы acc-1 (первая с минимальным dueAt).
    const last = calls[calls.length - 1];
    expect(last.id).toBe('acc-2');
    expect(last.t - startedAt).toBe(2 * GAP_MS);
    expect(callsFor('acc-1')).toHaveLength(1);
    expect(callsFor('acc-2')).toHaveLength(2);
  });
});

// ===========================================================================
// (б) ACCOUNT_TIMEOUT_MS в refreshApplicationsNow
// ===========================================================================

describe('applications-sync — ACCOUNT_TIMEOUT_MS в refreshApplicationsNow', () => {
  it('зависший запрос обрывается таймаутом 15 с: лог account-timeout, флаг снят, тик не блокируется', async () => {
    startApplicationsSync([acc1]);
    await flush();
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    const startedAt = Date.now();

    // Дальше запрос зависает навсегда — гонится только таймер ACCOUNT_TIMEOUT_MS.
    mockLoadCollection.mockImplementation(() => new Promise(() => {}));

    const run = refreshApplicationsNow();
    expect(getRefreshAllStartedAt()).toBe(startedAt);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(ACCOUNT_TIMEOUT_MS);
    await run;

    // Таймаут пойман: dueAt сдвинут, флаг refreshAllNow сброшен в finally.
    expect(getRefreshAllStartedAt()).toBe(0);
    expect(diagLogged(`account-timeout account=acc-1 shift=${TIMEOUT_SHIFT_MS}ms`)).toBe(true);

    // Следующий тик обновления не запускает: dueAt сдвинут на 30 с.
    await tickFor(1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// (в) kind='unauthorized' — обычный интервал, а не сетевой бэкофф
// ===========================================================================

describe('applications-sync — kind=unauthorized', () => {
  it('повтор через обычный интервал (30 с), а не через сетевой бэкофф (5 с)', async () => {
    mockLoadCollection.mockImplementation(async account => {
      calls.push({id: account.id, t: Date.now()});
      return {ok: false, error: 'Unauthorized', kind: 'unauthorized'};
    });

    const startedAt = Date.now();
    startApplicationsSync([acc1]);
    await flush();
    expect(calls).toHaveLength(1);

    // Сетевой сбой вернул бы dueAt через NETWORK_RETRY_MS (5 с) — тик на 10-й
    // секунде (первая возможность с учётом разноса) уже запустил бы повтор.
    await tickFor(GAP_MS + 5_000);
    expect(calls).toHaveLength(1);

    // Не-сетевой сбой: следующий старт только через обычный интервал опроса.
    await tickFor(NORMAL_INTERVAL_MS - GAP_MS - 5_000);
    expect(calls).toHaveLength(2);
    expect(calls[1].t - startedAt).toBe(NORMAL_INTERVAL_MS);

    // Синк жив: учётка продолжает опрашиваться по обычному темпу.
    await tickFor(NORMAL_INTERVAL_MS);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});
