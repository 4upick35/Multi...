/**
 * Фиксы гонок планировщика и пуш-режим: src/services/applications-sync.ts.
 *
 * Наблюдаемое поведение (dueAt/inflight наружу не выдаются, поэтому проверяем
 * через количество вызовов loadCollection, diag-лог и getRefreshAllStartedAt):
 *
 *  (а) overdue-ветка onSyncTick НЕ запускает второй параллельный запрос: если
 *      по просроченной учётке уже висит живой inflight — она просто
 *      пропускается, а не «дёргается повторно в тот же тик»;
 *  (б) таймаут ACCOUNT_TIMEOUT_MS в refreshApplicationsNow: dueAt сдвигается на
 *      THROTTLE_MAX_SHIFT_MS, а позднее завершившийся «призрак» (зависший
 *      loadCollection) НЕ перезаписывает dueAt меньшим значением — поколение
 *      запроса (gen) уже вытеснено;
 *  (в) принудительный сброс refreshAllNowRunning в onSyncTick НЕ происходит,
 *      пока цикл refreshApplicationsNow реально жив (обновляется
 *      refreshAllAliveAt) — второй конкурентный обход не запускается;
 *  (г) пуш-режим: при pushMode=true и realtime-подписке учётки периодический
 *      опрос не идёт; при pushMode=false — идёт как обычно; при pushMode=true
 *      и отвале realtime дольше PUSH_FALLBACK_DELAY_MS — страховочный опрос
 *      включается, а после восстановления подписки — снова гаснет.
 *
 * Реальной сети нет: loadCollection замокан, KeepAlive (тикер/delay) замокан,
 * сторы (auth/settings/customer-service) замоканы, realtime замокан (в т.ч.
 * isRealtimeSubscribed — приложение лениво require'ит его из applications-sync).
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
    pollIntervalSec: 30,
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

// realtime лениво require'ится из applications-sync (require('./realtime')) —
// мок по пути относительно теста резолвится в тот же модуль.
jest.mock('../../src/services/realtime', () => ({
  isRealtimeSubscribed: jest.fn(() => false),
}));

import {DeviceEventEmitter} from 'react-native';
import {
  startApplicationsSync,
  stopApplicationsSync,
  refreshApplicationsNow,
  setForegroundAccounts,
  getRefreshAllStartedAt,
} from '../../src/services/applications-sync';
import {SYNC_TICK_EVENT, delay} from '../../src/native/KeepAlive';
import {loadCollection} from '../../src/services/customer-service';
import {logDiag} from '../../src/diag/accept-log';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import type {ElmaAccount} from '../../src/types/account';

const mockLoadCollection = loadCollection as jest.MockedFunction<typeof loadCollection>;
const mockLogDiag = logDiag as jest.MockedFunction<typeof logDiag>;
const mockDelay = delay as jest.MockedFunction<typeof delay>;
const realtimeMock = jest.requireMock('../../src/services/realtime') as {
  isRealtimeSubscribed: jest.Mock;
};

/** pollIntervalSec=30 c Math.random→0: обычный интервал опроса ровно 30 с. */
const NORMAL_INTERVAL_MS = 30_000;
/** Разнос очереди: интервал/число учёток (2 учётки @30 с → 15 с), джиттер 0. */
const GAP_MS = 15_000;
/** Жёсткий таймаут одного запроса в refreshApplicationsNow. */
const ACCOUNT_TIMEOUT_MS = 15_000;
/** Сдвиг dueAt после таймаута запроса (THROTTLE_MAX_SHIFT_MS). */
const TIMEOUT_SHIFT_MS = 30_000;
/** Порог принудительного сброса зависшего refreshAllNow. */
const REFRESH_ALL_TIMEOUT_MS = 20_000;
/** Страховочный порог пуш-режима (PUSH_FALLBACK_DELAY_MS). */
const PUSH_FALLBACK_DELAY_MS = 15_000;
/** Пауза между учётками внутри refreshApplicationsNow в тесте (вместо 1.5–3 с). */
const SLOW_PAIR_DELAY_MS = 12_000;

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
const acc3 = makeAccount('acc-3');

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
  return mockLogDiag.mock.calls.some(call => String(call[1]).includes(fragment));
}

/** Отложенный promise:resolve/reject извне (для «зависшего» запроса). */
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Math, 'random').mockImplementation(() => 0);

  const settings = useSettingsStore.getState();
  settings.pollIntervalSec = NORMAL_INTERVAL_MS / 1000;
  settings.syncPaused = false;
  settings.priorityAccountIds = [];
  settings.pushMode = false;
  useAuthStore.getState().accounts = [acc1, acc2, acc3];
  const lastRefreshAt = useCustomerServiceStore.getState().lastRefreshAt;
  Object.keys(lastRefreshAt).forEach(key => delete lastRefreshAt[key]);

  realtimeMock.isRealtimeSubscribed.mockReturnValue(false);
  mockDelay.mockImplementation(() => Promise.resolve());
  calls = [];

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
// (а) Overdue-ветка не запускает второй параллельный запрос
// ===========================================================================

describe('applications-sync — overdue-ветка не дублирует живой inflight', () => {
  it('просроченная учётка с живым inflight не дёргается повторно в тот же тик', async () => {
    mockLoadCollection.mockImplementation(async account => {
      calls.push({id: account.id, t: Date.now()});
      if (account.id === 'acc-2') {
        // Запрос завис навсегда: inflight по acc-2 остаётся висеть.
        return await new Promise(() => {});
      }
      return {ok: true};
    });

    startApplicationsSync([acc1, acc2]);
    await flush();
    expect(calls.map(c => c.id)).toEqual(['acc-1']);

    // t=10 с: acc-2 просрочена (lastRefreshAt=0) и её dueAt прошёл → старт.
    await tickFor(GAP_MS);
    await flush();
    expect(calls.map(c => c.id)).toEqual(['acc-1', 'acc-2']);

    // acc-2 по-прежнему просрочена (lastRefreshAt не обновился — запрос висит)
    // и её dueAt в прошлом, но живой inflight запрещает второй параллельный
    // запрос: повторного loadCollection по acc-2 нет.
    await tickFor(30_000);
    expect(callsFor('acc-2')).toHaveLength(1);

    // Обычный темп очереди при этом не сломан: acc-1 обновилась на t=30 с.
    expect(callsFor('acc-1').map(c => c.t - calls[0].t)).toEqual([0, NORMAL_INTERVAL_MS]);
  });
});

// ===========================================================================
// (б) Таймаут refreshApplicationsNow: «призрак» не перезаписывает dueAt
// ===========================================================================

describe('applications-sync — «призрак» после ACCOUNT_TIMEOUT_MS не трогает dueAt', () => {
  it('позднее завершившийся запрос НЕ сдвигает dueAt ближе сдвига таймаута', async () => {
    startApplicationsSync([acc1]);
    await flush();
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    const startedAt = Date.now();

    // Дальше запрос зависает навсегда — гонится только таймер ACCOUNT_TIMEOUT_MS.
    const ghost = deferred();
    mockLoadCollection.mockImplementation(() => {
      calls.push({id: 'acc-1', t: Date.now()});
      return ghost.promise;
    });

    const run = refreshApplicationsNow();
    expect(getRefreshAllStartedAt()).toBe(startedAt);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(ACCOUNT_TIMEOUT_MS);
    await run;

    expect(getRefreshAllStartedAt()).toBe(0);
    expect(diagLogged(`account-timeout account=acc-1 shift=${TIMEOUT_SHIFT_MS}ms`)).toBe(true);
    expect(callsFor('acc-1')).toHaveLength(2);

    // «Призрак» завершается ПОСЛЕ таймаута сетевым сбоем: без поколения (gen)
    // dueAt сдвинулся бы на NETWORK_RETRY_MS (5 с) от t15 — раньше сдвига
    // таймаута (t15 + 30 с = t45) — и учётка опять опрашивалась бы рано.
    ghost.resolve({ok: false, error: 'boom', kind: 'network'});
    mockLoadCollection.mockImplementation(async account => {
      calls.push({id: account.id, t: Date.now()});
      return {ok: true};
    });
    await flush();

    // Все тики до t44: dueAt так и остался на t45 — повторов нет.
    await tickFor(29_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // t45: dueAt подошёл — учётка обновляется штатно.
    await tickFor(1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
  });
});

// ===========================================================================
// (в) Принудительный сброс refreshAllNowRunning при живом цикле
// ===========================================================================

describe('applications-sync — живой refreshAllNow не сбрасывается принудительно', () => {
  it('во время длинного обхода тик НЕ сбрасывает флаг и НЕ запускает второй обход', async () => {
    startApplicationsSync([acc1, acc2, acc3]);
    await flush();
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);
    const startedAt = Date.now();

    // Пауза между учётками «растягивается» до 12 с: обход живёт ~24 с
    // (дольше REFRESH_ALL_TIMEOUT_MS = 20 с), обновляя refreshAllAliveAt
    // на каждой итерации.
    mockDelay.mockImplementation(
      () => new Promise(resolve => setTimeout(resolve, SLOW_PAIR_DELAY_MS)),
    );

    const run = refreshApplicationsNow();
    expect(getRefreshAllStartedAt()).toBe(startedAt);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // t1..t12: обход идёт, на t12 стартует вторая учётка. Флаг жив.
    await tickFor(12_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);
    expect(getRefreshAllStartedAt()).toBe(startedAt);

    // t13..t21: с начала обхода прошло 21 с (> REFRESH_ALL_TIMEOUT_MS),
    // но цикл ЖИВ (последний пульс refreshAllAliveAt — t12) → принудительного
    // сброса нет и второй конкурентный обход не запускается.
    await tickFor(9_000);
    expect(getRefreshAllStartedAt()).toBe(startedAt);
    expect(mockLoadCollection).toHaveBeenCalledTimes(3);

    // t24: обход дошёл до acc-3 и завершился штатно — флаг сброшен сам,
    // второй обход не понадобился (acc-3 обновлена именно этим обходом).
    await tickFor(3_000);
    await run;
    expect(mockLoadCollection).toHaveBeenCalledTimes(4);
    expect(callsFor('acc-3')).toHaveLength(1);
    expect(getRefreshAllStartedAt()).toBe(0);
  });
});

// ===========================================================================
// (г) Пуш-режим
// ===========================================================================

describe('applications-sync — пуш-режим', () => {
  it('pushMode=true и subscribed → периодического опроса нет (только первичная загрузка)', async () => {
    useSettingsStore.getState().pushMode = true;
    realtimeMock.isRealtimeSubscribed.mockReturnValue(true);

    startApplicationsSync([acc1, acc2]);
    await flush();
    // Первичная загрузка каждой учётки при старте синка — есть.
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // Видимые учётки не дают повода опрашивать сервер: подписка живёт.
    setForegroundAccounts(['acc-1', 'acc-2']);
    await tickFor(60_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
  });

  it('pushMode=false → периодический опрос работает как обычно', async () => {
    useSettingsStore.getState().pushMode = false;
    realtimeMock.isRealtimeSubscribed.mockReturnValue(false);

    startApplicationsSync([acc1]);
    await flush();
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);

    await tickFor(NORMAL_INTERVAL_MS);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
  });

  it('pushMode=true и isRealtimeSubscribed=false дольше PUSH_FALLBACK_DELAY_MS → опрос включается, после подписки — гаснет', async () => {
    useSettingsStore.getState().pushMode = true;
    realtimeMock.isRealtimeSubscribed.mockReturnValue(false);

    startApplicationsSync([acc1]);
    await flush();
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);

    // Разрыв короче порога: страховочного опроса ещё нет.
    await tickFor(PUSH_FALLBACK_DELAY_MS - 1_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(1);

    // dueAt сдвигаем в «сейчас», чтобы проверка была про опрос-страховку,
    // а не про наступление обычного интервала.
    setForegroundAccounts(['acc-1']);

    // На 15-й секунде порог ещё не пройден (нужно строго больше), на 16-й — пройден.
    await tickFor(2_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);

    // Подписка восстановилась → периодический опрос снова выключен,
    // даже когда dueAt (t46) подходит.
    realtimeMock.isRealtimeSubscribed.mockReturnValue(true);
    await tickFor(30_000);
    expect(mockLoadCollection).toHaveBeenCalledTimes(2);
  });
});
