/**
 * Тесты: реальная причина ошибки сервера (тело ответа) в result.error
 * при выполнении задачи через submitTask (PUT /api/bpm/tasks/{uuid}).
 *
 * Транспорт мокается так же, как в visit-confirmation.test.ts.
 */

import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import {submitTask} from '../../src/services/elma-api';
import type {ElmaAccount} from '../../src/types/account';

jest.mock('../../src/infrastructure/HttpTransport', () => ({
  HttpTransport: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    clearClient: jest.fn(),
  })),
}));

const mockRequest = (HttpTransport as unknown as jest.Mock).mock.results[0].value
  .request as jest.Mock;

const account = {id: 'acc-1', baseUrl: 'https://elma.example'} as unknown as ElmaAccount;

const EXIT_ID = '877fac69-f4d9-4745-80fd-5c3dbfc8b8dd';

function axiosLikeError(status: number, data: unknown) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: {status, data},
  };
}

beforeEach(() => {
  mockRequest.mockReset();
});

describe('submitTask — причина ошибки из тела ответа 400', () => {
  it('объект {message: ...} в теле → result.error содержит текст сервера', async () => {
    mockRequest.mockRejectedValue(
      axiosLikeError(400, {
        message: 'Обязательное поле содержит недопустимое значение',
      }),
    );

    const result = await submitTask(account, 'instance-1', 'task-1', EXIT_ID);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain(
      'Обязательное поле содержит недопустимое значение',
    );
  });

  it('строка с JSON {"error": ...} в теле → result.error содержит текст сервера', async () => {
    mockRequest.mockRejectedValue(
      axiosLikeError(400, '{"error":"Нет доступа"}'),
    );

    const result = await submitTask(account, 'instance-1', 'task-1', EXIT_ID);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('Нет доступа');
  });
});
