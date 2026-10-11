/**
 * Приоритетные учётки из настроек: src/services/applications-sync.ts.
 *
 * Наблюдаемое поведение (dueAt наружу не выдаётся, поэтому проверяем
 * моменты вызовов loadCollection):
 *  (а) при priorityAccountIds: ['acc-1'] и pollIntervalSec: 30 после успешного
 *      обновления следующий старт acc-1 наступает через 4–6 с (границы
 *      проверяются управлением Math.random), а разнос очереди (lastQueueStartRef
 *      / gapRef) его НЕ блокирует;
 *  (б) acc-2 приоритетной не является: за 60 с у неё есть обновления и её
 *      интервал обычный (~30 с), а не «прилипший» к 5 с;
 *  (в) за один тик стартует не более одной учётки вообще: приоритетная учётка
 *      занимает тик, очередь стартует в «свободные» тики;
 *  (г) applyPriorityAccounts(['acc-1']) сдвигает ближайший опрос acc-1 на
 *      ближайший тик (разнос для приоритетной не действует);
 *  (д) после сбоя приоритетной учётки ускорение не действует: повтор не раньше
 *      обычного интервала;
 *  (е) без приоритета интервал acc-1 обычный (30 с);
 *  (ж) число приоритетных учёток не влияет на темп очереди: за одно и то же
 *      окно очередная учётка acc-3 стартует одинаково при 1, 2 и 3
 *      приоритетных.
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
  applyPriorityAccounts,
} from '../../src/services/applications-sync';
import {SYNC_TICK_EVENT} from '../../src/native/KeepAlive';
import {loadCollection} from '../../src/services/customer-service';
import {useAuthStore} from '../../src/store/auth-store';
import {useSettingsStore} from '../../src/store/settings-store';
import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import type {ElmaAccount} from '../../src/types/account';

const mockLoadCollection = loadCollection as jest.MockedFunction<typeof loadCollection>;

/** pollIntervalSec=30 с Math.random→0: обычный интервал опроса ровно 30 с. */
const NORMAL_INTERVAL_MS = 30_000;
/** Math.random→0: разнос очереди (интервал/число учёток; 2 учётки @30 с → 15 с). */
const GAP_MS = 15_000;
/** Приоритетная учётка: 5 с ± 1 с → границы интервала. */
const PRIORITY_MIN_MS = 4_000;
const PRIORITY_MAX_MS = 6_000;

type Call = {id: string; t: number};

/** Моменты вызовов loadCollection с указанием учётки. */
let calls: Call[] = [];

/** Текущее значение Math.random (позволяет управлять джиттером по ходу теста). */
let randomValue = 0;

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
const acc4 = makeAccount('acc-4');

/** Учётка, которая всегда остаётся в очереди (не приоритетная) — за ней и следим. */
const QUEUE_ID = 'acc-3';

function setPriority(ids: string[]): void {
  useSettingsStore.getState().priorityAccountIds = ids;
}

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

/** Первая загрузка успешна, все последующие — ошибка kind='other'. */
function failAfterFirstSuccess(): void {
  mockLoadCollection.mockImplementation(async (account) => {
    calls.push({id: account.id, t: Date.now()});
    if (calls.length === 1) {
      return {ok: true};
    }
    return {ok: false, error: 'boom', kind: 'other'};
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  randomValue = 0;
  jest.spyOn(Math, 'random').mockImplementation(() => randomValue);
  calls = [];

  const settings = useSettingsStore.getState();
  settings.pollIntervalSec = NORMAL_INTERVAL_MS / 1000;
  settings.syncPaused = false;
  settings.priorityAccountIds = [];
  useAuthStore.getState().accounts = [acc1, acc2];
  const lastRefreshAt = useCustomerServiceStore.getState().lastRefreshAt;
  Object.keys(lastRefreshAt).forEach(key => delete lastRefreshAt[key]);

  mockLoadCollection.mockImplementation(async (account) => {
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
// (а) Приоритетная учётка: следующий старт через 4–6 с, разнос не блокирует
// ===========================================================================

describe('applications-sync — приоритетные учётки', () => {
  it('следующий старт приоритетной acc-1 — через 4–6 с, разнос очереди его не блокирует', async () => {
    randomValue = 0;
    startApplicationsSync([acc1, acc2]);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('acc-1');

    // Обычный разнос очереди: acc-2 стартует на 10-й секунде.
    await tickFor(GAP_MS);
    expect(calls).toHaveLength(2);
    expect(calls[1].id).toBe('acc-2');

    // Приоритет включён сразу после старта очереди: обычный разнос
    // (был бы 4–10 с от t=10000) НЕ задерживает приоритетную учётку.
    setPriority(['acc-1']);
    applyPriorityAccounts(['acc-1']);
    await tickFor(1_000);
    expect(calls).toHaveLength(3);
    expect(calls[2].id).toBe('acc-1');
    expect(calls[2].t - calls[1].t).toBe(1_000);
    expect(calls[2].t - calls[1].t).toBeLessThan(PRIORITY_MIN_MS);

    // Нижняя граница: Math.random→0 → интервал ровно 4 с.
    await tickFor(3_000);
    expect(calls).toHaveLength(3);
    randomValue = 0.9999;
    await tickFor(1_000);
    expect(calls).toHaveLength(4);
    expect(calls[3].id).toBe('acc-1');
    const lower = calls[3].t - calls[2].t;
    expect(lower).toBe(PRIORITY_MIN_MS);
    expect(lower).toBeGreaterThanOrEqual(PRIORITY_MIN_MS);
    expect(lower).toBeLessThanOrEqual(PRIORITY_MAX_MS);

    // Верхняя граница: Math.random→1-ε → интервал ~6 с (не раньше 4 с).
    await tickFor(5_000);
    expect(calls).toHaveLength(4);
    await tickFor(1_000);
    expect(calls).toHaveLength(5);
    const upper = calls[4].t - calls[3].t;
    expect(upper).toBeGreaterThanOrEqual(PRIORITY_MIN_MS);
    expect(upper).toBeLessThanOrEqual(PRIORITY_MAX_MS);
  });

  it('acc-2 (не приоритетная) продолжает опрашиваться: интервал обычный (~30 с), а не 5 с', async () => {
    randomValue = 0;
    setPriority(['acc-1']);

    startApplicationsSync([acc1, acc2]);
    await flush();
    expect(callsFor('acc-1')).toHaveLength(1);
    expect(callsFor('acc-2')).toHaveLength(0);

    await tickFor(60_000);

    const acc2Calls = callsFor('acc-2');
    // Обновления есть — очередь не заблокирована приоритетной учёткой.
    expect(acc2Calls.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < acc2Calls.length; i += 1) {
      const delta = acc2Calls[i].t - acc2Calls[i - 1].t;
      // Обычный интервал, «прилипания» к 5 с нет.
      expect(delta).toBeGreaterThanOrEqual(NORMAL_INTERVAL_MS);
    }
    // Приоритетная обновляется заметно чаще обычной.
    expect(callsFor('acc-1').length).toBeGreaterThan(acc2Calls.length);
  });

  it('за один тик стартует не более одной учётки (приоритетные не дают залпа)', async () => {
    randomValue = 0;
    setPriority(['acc-1', 'acc-2']);
    useAuthStore.getState().accounts = [acc1, acc2, acc3];

    startApplicationsSync([acc1, acc2, acc3]);
    await flush();
    expect(calls.map(c => c.id)).toEqual(['acc-1']);

    // Догоняем до момента, когда и приоритетные, и очередь уже опрашиваются.
    await tickFor(60_000);
    await flush();

    // Одна метка времени = один тик: в каждом тике стартовала максимум ОДНА
    // учётка — приоритетная занимает тик, очередь ждёт «свободный».
    const startsPerTick = new Map<number, number>();
    for (const c of calls) {
      startsPerTick.set(c.t, (startsPerTick.get(c.t) ?? 0) + 1);
    }
    expect(Math.max(0, ...startsPerTick.values())).toBeLessThanOrEqual(1);

    // Очередь не заблокирована: acc-3 (единственная неприоритетная) обновляется.
    expect(callsFor('acc-1').length).toBeGreaterThanOrEqual(1);
    expect(callsFor('acc-2').length).toBeGreaterThanOrEqual(1);
    expect(callsFor('acc-3').length).toBeGreaterThanOrEqual(1);
  });

  it('число приоритетных учёток не влияет на темп очереди', async () => {
    randomValue = 0;
    const three = [acc1, acc2, acc3];
    const four = [acc1, acc2, acc3, acc4];

    const WINDOW_MS = 60_000;

    /**
     * Сброс синка и замер всех стартов за окно WINDOW_MS с данным приоритетом:
     * acc-3 нигде не приоритетная — её темп очереди и измеряем.
     */
    async function measure(
      accounts: ElmaAccount[],
      priority: string[],
      priorityIds: string[],
    ): Promise<{queue: number; priority: number}> {
      stopApplicationsSync();
      calls = [];
      const lastRefreshAt = useCustomerServiceStore.getState().lastRefreshAt;
      Object.keys(lastRefreshAt).forEach(key => delete lastRefreshAt[key]);
      setPriority(priority);
      useAuthStore.getState().accounts = accounts;
      startApplicationsSync(accounts);
      await tickFor(WINDOW_MS);
      await flush();
      return {
        queue: callsFor(QUEUE_ID).length,
        priority: calls.filter(c => priorityIds.includes(c.id)).length,
      };
    }

    // Прогон А: одна приоритетная учётка (acc-1), смотрим за acc-3.
    const one = await measure(three, ['acc-1'], ['acc-1']);
    // Прогон Б: две приоритетные (acc-1 и acc-2), те же три аккаунта, те же 60 с.
    const two = await measure(three, ['acc-1', 'acc-2'], ['acc-1', 'acc-2']);
    // Прогон В: три приоритетные (acc-4 входит в приоритет, acc-3 остаётся
    // очередной) — прямая проверка цели «1 против 3».
    const threeP = await measure(
      four,
      ['acc-1', 'acc-2', 'acc-4'],
      ['acc-1', 'acc-2', 'acc-4'],
    );

    // Sanity: манипуляция приоритетом действительно меняет число приоритетных
    // стартов (иначе замер ничего не доказывает).
    expect(two.priority).toBeGreaterThan(one.priority);
    expect(threeP.priority).toBeGreaterThan(two.priority);

    // Очередь не заблокирована: acc-3 опрашивается во всех прогонах.
    expect(one.queue).toBeGreaterThanOrEqual(1);
    expect(two.queue).toBeGreaterThanOrEqual(1);
    expect(threeP.queue).toBeGreaterThanOrEqual(1);

    // Регресс-защита: раньше каждый старт приоритетной учётки «съедал» тик
    // (проход 1 заканчивался return) и очередь замедлялась — acc-3 стартовала
    // бы реже при 2–3 приоритетных. Теперь стартов acc-3 в прогоне Б не меньше,
    // чем в прогоне А; отличие допускается только в пределах ±1 (сдвиг фазы).
    expect(two.queue).toBeGreaterThanOrEqual(one.queue - 1);
    expect(two.queue).toBeLessThanOrEqual(one.queue + 1);
    // То же для 1 против 3 приоритетных учёток.
    expect(threeP.queue).toBeGreaterThanOrEqual(one.queue - 1);
    expect(threeP.queue).toBeLessThanOrEqual(one.queue + 1);
  });

  it('applyPriorityAccounts сдвигает ближайший опрос acc-1 на ближайший тик (без разноса)', async () => {
    randomValue = 0;
    // Старт без приоритета: acc-1 ждёт обычный интервал (30 с).
    startApplicationsSync([acc1]);
    await flush();
    expect(calls).toHaveLength(1);

    // Приоритет появился после старта → сдвигаем dueAt в 0.
    setPriority(['acc-1']);
    applyPriorityAccounts(['acc-1']);

    // Следующий тик уже стартует: разнос очереди для приоритетной не действует.
    await tickFor(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[1].id).toBe('acc-1');
    expect(calls[1].t - calls[0].t).toBe(1_000);
    expect(calls[1].t - calls[0].t).toBeLessThan(NORMAL_INTERVAL_MS);

    // И следующее обновление — ускоренное (4–6 с вместо 30 с).
    await tickFor(4_000);
    expect(calls).toHaveLength(3);
    const delta = calls[2].t - calls[1].t;
    expect(delta).toBeGreaterThanOrEqual(PRIORITY_MIN_MS);
    expect(delta).toBeLessThanOrEqual(PRIORITY_MAX_MS);
  });

  it('после сбоя приоритетной учётки ускорение не действует', async () => {
    failAfterFirstSuccess();
    randomValue = 0;
    setPriority(['acc-1']);

    startApplicationsSync([acc1]);
    await flush();
    expect(calls).toHaveLength(1);

    // Ускорённый повтор на t=4 с падает → ускорение выключается.
    await tickFor(4_000);
    expect(calls).toHaveLength(2);

    // Ускорённый повтор был бы на t=8 с; обычный — не раньше t=34 с.
    await tickFor(29_000);
    expect(calls).toHaveLength(2);

    await tickFor(1_000);
    expect(calls).toHaveLength(3);
    expect(calls[2].t - calls[1].t).toBeGreaterThanOrEqual(NORMAL_INTERVAL_MS);
  });

  it('без приоритета интервал acc-1 обычный (30 с)', async () => {
    startApplicationsSync([acc1]);
    await flush();
    expect(calls).toHaveLength(1);

    await tickFor(NORMAL_INTERVAL_MS - 1_000);
    expect(calls).toHaveLength(1);
    await tickFor(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[1].t - calls[0].t).toBe(NORMAL_INTERVAL_MS);
    expect(GAP_MS).toBeLessThan(NORMAL_INTERVAL_MS);
  });
});
