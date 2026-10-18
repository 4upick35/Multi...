/**
 * action-queue — персистентная очередь отложенных действий.
 *
 * AsyncStorage и elma-api замоканы — реальных запросов к ELMA нет.
 *
 * Проверяем:
 *  - постановку в очередь и чтение (включая запись в AsyncStorage);
 *  - дедупликацию по kind+accountId+entityId (payload/state обновляются,
 *    attempts НЕ сбрасывается);
 *  - удаление записи;
 *  - TTL 24 часа (старая запись удаляется, ничего не выполняется);
 *  - accept-application НЕ выполняется автоматически (нужна капча);
 *  - schedule-visit с заполненным datetime_of_session удаляется
 *    без запуска процесса;
 *  - submit-exit при 412 / «задача уже закрыта» считается выполненным;
 *  - рост attempts и переход в 'unknown' при сетевой ошибке;
 *  - пропуск записи при неизвестном аккаунте и при паузе аккаунта.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_ACTIONS_STORAGE_KEY,
  enqueuePendingAction,
  getPendingActions,
  processPendingActions,
  removePendingAction,
  subscribePendingActions,
} from '../../src/services/action-queue';
import {
  fetchCollectionItemsByIds,
  runScheduleVisit,
  submitTask,
} from '../../src/services/elma-api';
import {useAuthStore} from '../../src/store/auth-store';
import {
  clearThrottle,
  recordThrottleError,
} from '../../src/infrastructure/AccountThrottle';

jest.mock('../../src/services/elma-api', () => ({
  fetchCollectionItemsByIds: jest.fn(),
  runScheduleVisit: jest.fn(),
  submitTask: jest.fn(),
}));

jest.mock('../../src/store/auth-store', () => ({
  useAuthStore: {getState: jest.fn()},
}));

const mockedFetchItems = fetchCollectionItemsByIds as unknown as jest.Mock;
const mockedRunVisit = runScheduleVisit as unknown as jest.Mock;
const mockedSubmit = submitTask as unknown as jest.Mock;
const mockedGetState = useAuthStore.getState as unknown as jest.Mock;

const ACCOUNT = {
  id: 'acc-1',
  name: 'Мастер',
  baseUrl: 'https://elma.test',
  portal: 'customer_service',
  token: 'token-1',
  userId: 'user-1',
  color: '#4CAF50',
  isActive: true,
};

const EXIT_UUID = '2d8f3a10-6b4e-4f2a-9c3d-1a2b3c4d5e6f';

const VISIT_PAYLOAD = {
  applicationId: 'app-1',
  templateId: 'tpl-1',
  templateVersion: 6,
  formCode: 'form-1',
  visitDateIso: '2026-10-20T10:00:00.000Z',
  masterId: 'master-1',
};

const EXIT_PAYLOAD = {
  taskUuid: 'task-1',
  instanceId: 'inst-1',
  exitId: EXIT_UUID,
};

/** Опустошить очередь: модуль живёт между тестами, состояние общее. */
async function clearQueue(): Promise<void> {
  const list = await getPendingActions();
  for (const action of list) {
    await removePendingAction(action.id);
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockedGetState.mockReturnValue({accounts: [ACCOUNT]});
  mockedFetchItems.mockResolvedValue({items: []});
  mockedRunVisit.mockResolvedValue({ok: true});
  mockedSubmit.mockResolvedValue({ok: true});
  clearThrottle(ACCOUNT.id);
  await clearQueue();
});

afterEach(() => {
  clearThrottle(ACCOUNT.id);
});

describe('очередь: базовые операции', () => {
  it('enqueue + getPendingActions: запись попадает в очередь и в AsyncStorage', async () => {
    await enqueuePendingAction({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: VISIT_PAYLOAD,
    });

    const list = await getPendingActions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: VISIT_PAYLOAD,
      attempts: 0,
      state: 'pending',
    });
    expect(typeof list[0].id).toBe('string');
    expect(list[0].id).not.toBe('');
    expect(list[0].createdAt).toBeGreaterThan(0);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      PENDING_ACTIONS_STORAGE_KEY,
      expect.any(String),
    );
    const stored = await AsyncStorage.getItem(PENDING_ACTIONS_STORAGE_KEY);
    expect(JSON.parse(String(stored))).toHaveLength(1);
  });

  it('дедупликация по kind+accountId+entityId: payload и state обновляются, attempts сохраняется', async () => {
    await enqueuePendingAction({
      kind: 'submit-exit',
      accountId: ACCOUNT.id,
      entityId: 'task-1',
      payload: EXIT_PAYLOAD,
    });

    // Первая попытка падает — attempts растёт.
    mockedSubmit.mockResolvedValue({ok: false, error: 'Network Error'});
    await processPendingActions();
    const failed = await getPendingActions();
    expect(failed).toHaveLength(1);
    expect(failed[0].attempts).toBe(1);
    expect(failed[0].state).toBe('error');

    // Повторная постановка того же действия не создаёт вторую запись.
    await enqueuePendingAction({
      kind: 'submit-exit',
      accountId: ACCOUNT.id,
      entityId: 'task-1',
      payload: {...EXIT_PAYLOAD, exitId: 'other-exit'},
    });

    const list = await getPendingActions();
    expect(list).toHaveLength(1);
    expect(list[0].attempts).toBe(1);
    expect(list[0].state).toBe('pending');
    expect(list[0].payload.exitId).toBe('other-exit');

    // Тот же entityId с другим kind — уже другая запись.
    await enqueuePendingAction({
      kind: 'accept-application',
      accountId: ACCOUNT.id,
      entityId: 'task-1',
      payload: {applicationId: 'task-1'},
    });
    expect(await getPendingActions()).toHaveLength(2);
  });

  it('removePendingAction убирает запись из очереди и из хранилища', async () => {
    await enqueuePendingAction({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: VISIT_PAYLOAD,
    });
    const [created] = await getPendingActions();

    await removePendingAction(created.id);

    expect(await getPendingActions()).toHaveLength(0);
    const stored = await AsyncStorage.getItem(PENDING_ACTIONS_STORAGE_KEY);
    expect(JSON.parse(String(stored))).toHaveLength(0);

    // Повторное удаление не падает.
    await removePendingAction(created.id);
    expect(await getPendingActions()).toHaveLength(0);
  });

  it('subscribePendingActions: уведомление при изменении и отписка', async () => {
    const seen: number[] = [];
    const unsubscribe = subscribePendingActions(() => seen.push(seen.length + 1));

    await enqueuePendingAction({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: VISIT_PAYLOAD,
    });
    expect(seen).toHaveLength(1);

    const [created] = await getPendingActions();
    await removePendingAction(created.id);
    expect(seen).toHaveLength(2);

    unsubscribe();
    await enqueuePendingAction({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-2',
      payload: VISIT_PAYLOAD,
    });
    expect(seen).toHaveLength(2);
  });
});

describe('очередь: обработка', () => {
  it('TTL: запись старше 24 часов удаляется без выполнения', async () => {
    const realNow = Date.now;
    const staleNow = realNow() - 25 * 60 * 60 * 1000;
    Date.now = () => staleNow;
    try {
      await enqueuePendingAction({
        kind: 'schedule-visit',
        accountId: ACCOUNT.id,
        entityId: 'app-1',
        payload: VISIT_PAYLOAD,
      });
    } finally {
      Date.now = realNow;
    }
    expect(await getPendingActions()).toHaveLength(1);

    await processPendingActions();

    expect(await getPendingActions()).toHaveLength(0);
    expect(mockedFetchItems).not.toHaveBeenCalled();
    expect(mockedRunVisit).not.toHaveBeenCalled();
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('accept-application не выполняется автоматически (нужна капча)', async () => {
    await enqueuePendingAction({
      kind: 'accept-application',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: {applicationId: 'app-1'},
    });

    await processPendingActions();

    expect(mockedFetchItems).not.toHaveBeenCalled();
    expect(mockedRunVisit).not.toHaveBeenCalled();
    expect(mockedSubmit).not.toHaveBeenCalled();

    const list = await getPendingActions();
    expect(list).toHaveLength(1);
    expect(list[0].state).toBe('pending');
    expect(list[0].attempts).toBe(0);
  });

  it('schedule-visit: заявке уже назначен визит — запись удаляется без запуска процесса', async () => {
    mockedFetchItems.mockResolvedValue({
      items: [{raw: {datetime_of_session: '2026-10-20T10:00:00.000Z'}}],
    });
    await enqueuePendingAction({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: VISIT_PAYLOAD,
    });

    await processPendingActions();

    expect(mockedFetchItems).toHaveBeenCalledWith(
      ACCOUNT,
      'customer_service',
      'applications',
      ['app-1'],
    );
    expect(mockedRunVisit).not.toHaveBeenCalled();
    expect(await getPendingActions()).toHaveLength(0);
  });

  it('schedule-visit: визит не назначен — процесс запускается, при успехе запись удаляется', async () => {
    mockedFetchItems.mockResolvedValue({items: [{raw: {datetime_of_session: ''}}]});
    await enqueuePendingAction({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: VISIT_PAYLOAD,
    });

    await processPendingActions();

    expect(mockedRunVisit).toHaveBeenCalledWith(ACCOUNT, {
      templateId: 'tpl-1',
      templateVersion: 6,
      applicationId: 'app-1',
      formCode: 'form-1',
      visitDateIso: '2026-10-20T10:00:00.000Z',
      masterId: 'master-1',
    });
    expect(await getPendingActions()).toHaveLength(0);
  });

  it('schedule-visit: ошибка запуска — attempts растёт, запись остаётся', async () => {
    mockedFetchItems.mockResolvedValue({items: []});
    mockedRunVisit.mockResolvedValue({ok: false, error: 'Network Error'});
    await enqueuePendingAction({
      kind: 'schedule-visit',
      accountId: ACCOUNT.id,
      entityId: 'app-1',
      payload: VISIT_PAYLOAD,
    });

    await processPendingActions();

    const list = await getPendingActions();
    expect(list).toHaveLength(1);
    expect(list[0].attempts).toBe(1);
    expect(list[0].state).toBe('error');
    expect(list[0].lastError).toBe('Network Error');
  });

  it('submit-exit: 412 — состояние задачи изменилось, считаем выполненным', async () => {
    mockedSubmit.mockResolvedValue({
      ok: false,
      status: 412,
      error: 'Сервер отклонил действие (412): состояние задачи изменилось.',
    });
    await enqueuePendingAction({
      kind: 'submit-exit',
      accountId: ACCOUNT.id,
      entityId: 'task-1',
      payload: EXIT_PAYLOAD,
    });

    await processPendingActions();

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledWith(
      ACCOUNT,
      'inst-1',
      'task-1',
      EXIT_UUID,
      undefined,
    );
    expect(await getPendingActions()).toHaveLength(0);
  });

  it('submit-exit: ошибка «задача уже закрыта» — запись удаляется', async () => {
    mockedSubmit.mockResolvedValue({
      ok: false,
      error: 'Задача уже закрыта (задача выполнена ранее).',
    });
    await enqueuePendingAction({
      kind: 'submit-exit',
      accountId: ACCOUNT.id,
      entityId: 'task-1',
      payload: EXIT_PAYLOAD,
    });

    await processPendingActions();

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(await getPendingActions()).toHaveLength(0);
  });

  it('submit-exit: сетевая ошибка — attempts растёт, после 5 попыток state=unknown', async () => {
    mockedSubmit.mockResolvedValue({ok: false, error: 'Network Error'});
    await enqueuePendingAction({
      kind: 'submit-exit',
      accountId: ACCOUNT.id,
      entityId: 'task-1',
      payload: {...EXIT_PAYLOAD, values: {comment: 'ok'}},
    });

    await processPendingActions();

    expect(mockedSubmit).toHaveBeenCalledWith(ACCOUNT, 'inst-1', 'task-1', EXIT_UUID, {
      comment: 'ok',
    });
    let list = await getPendingActions();
    expect(list).toHaveLength(1);
    expect(list[0].attempts).toBe(1);
    expect(list[0].state).toBe('error');
    expect(list[0].lastError).toBe('Network Error');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await processPendingActions();
    }

    list = await getPendingActions();
    expect(list).toHaveLength(1);
    expect(list[0].attempts).toBe(5);
    expect(list[0].state).toBe('unknown');
    expect(mockedSubmit).toHaveBeenCalledTimes(5);
  });

  it('неизвестный аккаунт — запись остаётся до TTL, запросы не уходят', async () => {
    await enqueuePendingAction({
      kind: 'submit-exit',
      accountId: 'acc-missing',
      entityId: 'task-1',
      payload: EXIT_PAYLOAD,
    });

    await processPendingActions();

    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(await getPendingActions()).toHaveLength(1);
  });

  it('пауза аккаунта — запись не обрабатывается до окончания паузы', async () => {
    await enqueuePendingAction({
      kind: 'submit-exit',
      accountId: ACCOUNT.id,
      entityId: 'task-1',
      payload: EXIT_PAYLOAD,
    });
    recordThrottleError(ACCOUNT.id);

    await processPendingActions();

    expect(mockedSubmit).not.toHaveBeenCalled();
    const list = await getPendingActions();
    expect(list).toHaveLength(1);
    expect(list[0].state).toBe('pending');
    expect(list[0].attempts).toBe(0);

    clearThrottle(ACCOUNT.id);

    await processPendingActions();
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(await getPendingActions()).toHaveLength(0);
  });
});
