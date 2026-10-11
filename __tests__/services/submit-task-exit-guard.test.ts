/**
 * submitTask — защита от «странных запросов» и поведение на 403/412.
 *
 * - на сервер уходят только UUID-идентификаторы выходов от ELMA;
 * - выход выполняется официальным PUT /api/bpm/tasks/{uuid} одним запросом;
 * - 403/412 НЕ ретраятся (один запрос, понятный текст ошибки);
 * - неуспешная отправка не пересекается с рефрешем токена (/guard/cookie).
 *
 * Транспорт замокан — реальных запросов к ELMA нет.
 */

jest.mock('../../src/infrastructure/HttpTransport', () => ({
  HttpTransport: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    clearClient: jest.fn(),
  })),
}));

jest.mock('../../src/infrastructure/TokenRefresher', () => ({
  refreshTokenWithCookies: jest.fn().mockResolvedValue({ok: false}),
}));

import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import {refreshTokenWithCookies} from '../../src/infrastructure/TokenRefresher';
import {submitTask, submitTaskWithData, EXECUTION_FIELD_IDS} from '../../src/services/elma-api';

const mockRequest = (HttpTransport as unknown as jest.Mock).mock.results[0].value
  .request as jest.Mock;
const mockedRefresh = refreshTokenWithCookies as jest.Mock;

const account = {
  id: 'acc-1',
  baseUrl: 'https://elma.test',
  token: 'token-1',
  cookies: '',
} as any;

const EXIT_UUID = '2d8f3a10-6b4e-4f2a-9c3d-1a2b3c4d5e6f';

function axiosError(status: number) {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.isAxiosError = true;
  err.response = {status};
  err.code = 'ERR_BAD_REQUEST';
  return err;
}

beforeEach(() => {
  mockRequest.mockReset();
  mockedRefresh.mockClear();
});

describe('submitTask — только UUID-выходы', () => {
  it.each(['submit', 'complete', 'return', 'exit-1', ''])(
    'блокирует "%s" без сетевого запроса',
    async (exitId) => {
      const res = await submitTask(account, 'inst-1', 'task-1', exitId);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Недопустимый идентификатор');
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('UUID-выход уходит ровно одним официальным PUT /api/bpm/tasks/{uuid}', async () => {
    mockRequest.mockResolvedValue({data: {}});
    const res = await submitTask(account, 'inst-1', 'task-1', EXIT_UUID);
    expect(res).toEqual({ok: true});
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][1]).toBe('put');
    expect(mockRequest.mock.calls[0][2]).toBe('/api/bpm/tasks/task-1');
    expect(mockRequest.mock.calls[0][3]).toEqual({
      instanceId: 'inst-1',
      data: {__comment: null, __action: true, __skipSave: [], __exit: EXIT_UUID},
    });
  });

  it('fieldValues попадают в data рядом со служебными ключами', async () => {
    mockRequest.mockResolvedValue({data: {}});
    const res = await submitTask(account, 'inst-1', 'task-1', EXIT_UUID, {
      reason_of_refuse: ['abc'],
    });
    expect(res).toEqual({ok: true});
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][1]).toBe('put');
    expect(mockRequest.mock.calls[0][3]).toEqual({
      instanceId: 'inst-1',
      data: {
        reason_of_refuse: ['abc'],
        __comment: null,
        __action: true,
        __skipSave: [],
        __exit: EXIT_UUID,
      },
    });
  });
});

describe('submitTask — 403/412 без ретраев', () => {
  it('403: один запрос, понятный текст и статус в результате', async () => {
    mockRequest.mockRejectedValue(axiosError(403));
    const res = await submitTask(account, 'inst-1', 'task-1', EXIT_UUID);

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toContain('(403)');
    expect(res.error).toContain('Действия');
  });

  it('412: один запрос, понятный текст и статус в результате', async () => {
    mockRequest.mockRejectedValue(axiosError(412));
    const res = await submitTask(account, 'inst-1', 'task-1', EXIT_UUID);

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(412);
    expect(res.error).toContain('(412)');
  });

  it('при 403 рефреш токена не вызывается (нет пересечения с /guard/cookie)', async () => {
    mockRequest.mockRejectedValue(axiosError(403));
    await submitTask(account, 'inst-1', 'task-1', EXIT_UUID);

    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// submitTaskWithData — выход с данными формы ОДНИМ PUT (HAR23)
// ===========================================================================

const LONG_PREFIX = 'customer_service.applications._process_execution_of_field_applications';

describe('submitTaskWithData — тело как в веб-клиенте ELMA', () => {
  it('наружу уходит ровно {instanceId, data} с полями (короткий + длинный ключ) и служебными ключами', async () => {
    mockRequest.mockResolvedValue({data: {}});

    const res = await submitTaskWithData(account, {
      taskUuid: 'task-1',
      instanceId: 'inst-1',
      exitId: EXIT_UUID,
      body: {
        instanceId: 'ignored',
        __action: 'ignored',
        __exit: 'ignored',
        sn_of_technology: 'SN-777',
      },
    });

    expect(res).toEqual({ok: true});
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][1]).toBe('put');
    expect(mockRequest.mock.calls[0][2]).toBe('/api/bpm/tasks/task-1');

    const sent = mockRequest.mock.calls[0][3] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['data', 'instanceId']);
    expect(sent.instanceId).toBe('inst-1');

    const data = sent.data as Record<string, unknown>;
    const longKey =
      `${LONG_PREFIX}.${EXECUTION_FIELD_IDS['sn_of_technology']}.sn_of_technology`;

    expect(data).toEqual({
      sn_of_technology: 'SN-777',
      [longKey]: 'SN-777',
      __comment: null,
      __action: true,
      __skipSave: [],
      __exit: EXIT_UUID,
    });
    expect(data['__comment']).toBeNull();
    expect(data['__action']).toBe(true);
    expect(data['__skipSave']).toEqual([]);
    expect(data['__exit']).toBe(EXIT_UUID);
  });

  it('не-UUID exitId блокируется без сетевого запроса', async () => {
    const res = await submitTaskWithData(account, {
      taskUuid: 'task-1',
      instanceId: 'inst-1',
      exitId: 'complete',
      body: {sn_of_technology: 'SN-777'},
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Недопустимый идентификатор');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('403/412 не ретраятся: один запрос, понятный текст и статус', async () => {
    mockRequest.mockRejectedValue(axiosError(403));
    const res = await submitTaskWithData(account, {
      taskUuid: 'task-1',
      instanceId: 'inst-1',
      exitId: EXIT_UUID,
      body: {sn_of_technology: 'SN-777'},
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toContain('(403)');
    expect(res.error).toContain('Действия');
    expect(mockedRefresh).not.toHaveBeenCalled();
  });
});
