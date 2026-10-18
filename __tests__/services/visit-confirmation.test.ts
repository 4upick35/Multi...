/**
 * Тесты: generateVisitCode, validateVisitCode, getTaskInstance,
 * isVisitConfirmed, needsVisitConfirmation, sendVisitConfirmationCode,
 * confirmVisit, clearVisitTemplateCache.
 *
 * Все сетевые запросы моканы через HttpTransport. Реальных обращений к сети нет.
 */

import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import {
  generateVisitCode,
  validateVisitCode,
} from '../../src/utils/visit-code';
import {
  sendVisitConfirmationCode,
  confirmVisit,
  clearVisitTemplateCache,
  EXECUTION_FIELD_IDS,
  TEMPLATE_ID,
  FORM_CODE,
  FORM_VERSION,
  EXIT_CONFIRM_VISIT,
} from '../../src/services/elma-api';
import {
  getTaskInstance,
  isVisitConfirmed,
  needsVisitConfirmation,
  isVisitWithoutConfirmation,
  buildVisitLongFields,
} from '../../src/domain/visit';
import type {ElmaAccount} from '../../src/types/account';
import {delay} from '../../src/native/KeepAlive';

jest.mock('../../src/infrastructure/HttpTransport', () => ({
  HttpTransport: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    clearClient: jest.fn(),
  })),
}));

jest.mock('../../src/native/KeepAlive', () => ({
  delay: jest.fn(() => Promise.resolve()),
}));

const mockDelay = delay as jest.MockedFunction<typeof delay>;

const mockRequest = (HttpTransport as unknown as jest.Mock).mock.results[0].value
  .request as jest.Mock;

const account = {id: 'acc-1', baseUrl: 'https://elma.example'} as unknown as ElmaAccount;

// ---------------------------------------------------------------------------
// Мок-задачи
// ---------------------------------------------------------------------------

const mockTask = {
  id: 'task-uuid-1',
  instance: {
    session_confirmation_code: null,
    code_for_comparison: null,
    send_sms_logs: null,
    session_has_been_confirmed: false,
    do_need_to_record_session: true,
    without_session_confirmation: null,
    reason_for_lack_of_confirmation: null,
    __templateId: TEMPLATE_ID,
  },
};

const confirmedTask = {
  id: 'task-uuid-2',
  instance: {
    ...mockTask.instance,
    session_has_been_confirmed: true,
    session_confirmation_code: '3864',
  },
};

const noVisitTask = {
  id: 'task-uuid-3',
  instance: {
    session_confirmation_code: null,
    code_for_comparison: null,
    send_sms_logs: null,
    session_has_been_confirmed: false,
    do_need_to_record_session: false,
    without_session_confirmation: null,
  },
};

// ---------------------------------------------------------------------------
// Мок шаблона и дескриптора
// ---------------------------------------------------------------------------

const mockTemplate = {
  context: [
    {code: 'session_confirmation_code', type: 'STRING', array: false, single: true, view: {name: 'Код подтверждения визита'}},
    {code: 'code_for_comparison', type: 'STRING', array: false, single: true, view: {name: 'Код для сравнения'}},
    {code: 'do_need_to_record_session', type: 'BOOLEAN', array: false, single: true, view: {name: 'Нужна фиксация визита?'}},
  ],
};

const mockDescriptor = {
  descriptor: {
    fields: [
      {code: 'code_is_mandatory', type: 'BOOLEAN', array: false, single: true, view: {name: 'Код обязательный'}},
      {code: 'code_is_generation', type: 'BOOLEAN', array: false, single: true, view: {name: 'Генерация'}},
    ],
  },
};

beforeEach(() => {
  mockRequest.mockReset();
  mockDelay.mockReset();
  mockDelay.mockResolvedValue(undefined);
  clearVisitTemplateCache();
  mockRequest.mockResolvedValue({data: mockTemplate});
});

// ===========================================================================
// generateVisitCode / validateVisitCode
// ===========================================================================

describe('generateVisitCode', () => {
  it('возвращает строку из 4 цифр в диапазоне 1000..9999', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateVisitCode();
      expect(code).toMatch(/^\d{4}$/);
      const n = parseInt(code, 10);
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThanOrEqual(9999);
    }
  });
});

describe('validateVisitCode', () => {
  it('принимает 4-значные коды', () => {
    expect(validateVisitCode('1234')).toBe(true);
    expect(validateVisitCode('0000')).toBe(true);
    expect(validateVisitCode('9999')).toBe(true);
  });

  it('отклоняет не-4-значные', () => {
    expect(validateVisitCode('123')).toBe(false);
    expect(validateVisitCode('12345')).toBe(false);
    expect(validateVisitCode('abcd')).toBe(false);
    expect(validateVisitCode('')).toBe(false);
    expect(validateVisitCode('1 23')).toBe(false);
  });
});

// ===========================================================================
// getTaskInstance / isVisitConfirmed / needsVisitConfirmation
// ===========================================================================

describe('getTaskInstance', () => {
  it('извлекает instance из задачи', () => {
    const instance = getTaskInstance(mockTask);
    expect(instance.session_has_been_confirmed).toBe(false);
  });

  it('возвращает пустой объект при null', () => {
    expect(getTaskInstance(null)).toEqual({});
  });

  it('возвращает пустой объект при отсутствии instance', () => {
    expect(getTaskInstance({id: 'x'})).toEqual({});
  });
});

describe('isVisitConfirmed', () => {
  it('true когда session_has_been_confirmed === true', () => {
    expect(isVisitConfirmed(confirmedTask.instance)).toBe(true);
  });

  it('false когда session_has_been_confirmed === false', () => {
    expect(isVisitConfirmed(mockTask.instance)).toBe(false);
  });
});

describe('needsVisitConfirmation', () => {
  it('true когда do_need_to_record_session && !session_has_been_confirmed', () => {
    expect(needsVisitConfirmation(mockTask.instance)).toBe(true);
  });

  it('false когда session_has_been_confirmed уже true', () => {
    expect(needsVisitConfirmation(confirmedTask.instance)).toBe(false);
  });

  it('false когда do_need_to_record_session === false', () => {
    expect(needsVisitConfirmation(noVisitTask.instance)).toBe(false);
  });

  it('false когда without_session_confirmation === true — «Без подтверждения визита» снимает код из СМС', () => {
    expect(
      needsVisitConfirmation({
        do_need_to_record_session: true,
        session_has_been_confirmed: false,
        without_session_confirmation: true,
      }),
    ).toBe(false);
  });
});

// ===========================================================================
// isVisitWithoutConfirmation / buildVisitLongFields (HAR23/HAR24)
// ===========================================================================

/** Длинные ключи полей визита: <LONG_KEY_PREFIX>.<UUID поля>.<код>. */
const VISIT_LONG_PREFIX =
  'customer_service.applications._process_execution_of_field_applications.';

/** Задача пришла уже с отметкой «Без подтверждения визита» (HAR24). */
const instanceWithoutConfirmation = {
  do_need_to_record_session: true,
  session_has_been_confirmed: false,
  without_session_confirmation: true,
  reason_for_lack_of_confirmation: 'Клиента нет дома, дома супруга. Клиент трубку не берёт',
  send_sms_logs: 'SUCCESS: 202',
};

describe('isVisitWithoutConfirmation', () => {
  it('true когда without_session_confirmation === true', () => {
    expect(isVisitWithoutConfirmation(instanceWithoutConfirmation)).toBe(true);
  });

  it('false когда отметки нет или она не true', () => {
    expect(isVisitWithoutConfirmation(mockTask.instance)).toBe(false);
    expect(isVisitWithoutConfirmation(noVisitTask.instance)).toBe(false);
    expect(isVisitWithoutConfirmation({without_session_confirmation: null})).toBe(false);
    expect(isVisitWithoutConfirmation({})).toBe(false);
  });
});

describe('buildVisitLongFields', () => {
  it('даёт 4 длинных ключа визита с исходными значениями (HAR23)', () => {
    const fields = buildVisitLongFields(instanceWithoutConfirmation);

    const keys = Object.keys(fields);
    expect(keys).toHaveLength(4);
    for (const key of keys) {
      expect(key.startsWith(VISIT_LONG_PREFIX)).toBe(true);
    }
    // только длинная форма — коротких ключей полей визита нет
    for (const code of [
      'session_confirmation_code',
      'send_sms_logs',
      'without_session_confirmation',
      'reason_for_lack_of_confirmation',
    ]) {
      expect(keys).not.toContain(code);
    }
    expect(keys).toContain(
      `${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.session_confirmation_code}.session_confirmation_code`,
    );
    expect(keys).toContain(
      `${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.send_sms_logs}.send_sms_logs`,
    );
    expect(keys).toContain(
      `${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.without_session_confirmation}.without_session_confirmation`,
    );
    expect(keys).toContain(
      `${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.reason_for_lack_of_confirmation}.reason_for_lack_of_confirmation`,
    );

    expect(
      fields[
        `${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.session_confirmation_code}.session_confirmation_code`
      ],
    ).toBe('');
    expect(
      fields[`${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.send_sms_logs}.send_sms_logs`],
    ).toBe('SUCCESS: 202');
    expect(
      fields[
        `${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.without_session_confirmation}.without_session_confirmation`
      ],
    ).toBe(true);
    expect(
      fields[
        `${VISIT_LONG_PREFIX}${EXECUTION_FIELD_IDS.reason_for_lack_of_confirmation}.reason_for_lack_of_confirmation`
      ],
    ).toBe('Клиента нет дома, дома супруга. Клиент трубку не берёт');
  });

  it('пустой объект для задачи без фиксации визита', () => {
    expect(buildVisitLongFields({})).toEqual({});
    expect(buildVisitLongFields(noVisitTask.instance)).toEqual({});
    expect(
      buildVisitLongFields({
        do_need_to_record_session: false,
        session_has_been_confirmed: false,
        without_session_confirmation: false,
      }),
    ).toEqual({});
  });
});

// ===========================================================================
// sendVisitConfirmationCode — тело запроса
// ===========================================================================

describe('sendVisitConfirmationCode', () => {
  /** Переопределяем mockRequest для шаблона/дескриптора и задачи */
  function setupMocks(template = mockTemplate, descriptor = mockDescriptor, task = mockTask) {
    mockRequest.mockReset();
    // Последовательные вызовы: задача (fetchTaskById внутри sendVisitConfirmationCode),
    // шаблон, дескриптор (версии берутся из задачи/шаблона), widgets/execute
    mockRequest.mockResolvedValueOnce({data: {task: task}});
    mockRequest.mockResolvedValueOnce({data: template});
    mockRequest.mockResolvedValueOnce({data: descriptor});
    mockRequest.mockResolvedValueOnce({data: {context: {}, send_sms_logs: 'SUCCESS: '}});
  }

  it('отправляет POST /api/widgets/execute с правильным телом', async () => {
    setupMocks();

    const result = await sendVisitConfirmationCode(account, {
      taskUuid: 'task-uuid-1',
      code: '3864',
    });

    // Последний вызов — /api/widgets/execute
    const calls = mockRequest.mock.calls;
    const lastCall = calls[calls.length - 1];
    const [, method, url] = lastCall;
    expect(method).toBe('post');
    expect(url).toBe('/api/widgets/execute');

    const body = lastCall[3] as Record<string, unknown>;
    expect(body.namespace).toBe('customer_service.applications');
    expect(body.code).toBe(FORM_CODE);
    expect(body.version).toBe(FORM_VERSION);
    expect(body.func).toBe('sendCode');
    expect(body.args).toEqual([]);
    expect(body.context.code_for_comparison).toBe('3864');
    expect(body.context.__validateResult).toEqual({kind: 'BlobObject'});
    expect(body.extraContexts).toHaveLength(1);
    expect(body.extraContexts[0].name).toBe('ViewContext');
    expect(result.ok).toBe(true);
  });

  it('context.code_for_comparison совпадает с переданным кодом', async () => {
    setupMocks();

    await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '7721'});

    const calls = mockRequest.mock.calls;
    const lastCall = calls[calls.length - 1];
    const body = lastCall[3] as Record<string, unknown>;
    expect(body.context.code_for_comparison).toBe('7721');
  });

  it('ok=true когда send_sms_logs.startsWith("SUCCESS")', async () => {
    setupMocks();

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '1234'});
    expect(result.ok).toBe(true);
    expect(result.sendSmsLogs).toBe('SUCCESS: ');
  });

  it('ok=false когда send_sms_logs содержит ERROR:', async () => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({data: {task: mockTask}});
    mockRequest.mockResolvedValueOnce({data: mockTemplate});
    mockRequest.mockResolvedValueOnce({data: mockDescriptor});
    mockRequest.mockResolvedValueOnce({data: {context: {}, send_sms_logs: 'ERROR: 500 - Internal Server Error'}});

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '1234'});
    expect(result.ok).toBe(false);
    expect(result.sendSmsLogs).toContain('ERROR:');
  });

  it('ok=false когда send_sms_logs содержит FUNCTION ERROR:', async () => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({data: {task: mockTask}});
    mockRequest.mockResolvedValueOnce({data: mockTemplate});
    mockRequest.mockResolvedValueOnce({data: mockDescriptor});
    mockRequest.mockResolvedValueOnce({data: {context: {}, send_sms_logs: 'FUNCTION ERROR: отсутствует заявка'}});

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '1234'});
    expect(result.ok).toBe(false);
    expect(result.sendSmsLogs).toContain('FUNCTION ERROR:');
  });

  it('предоставленный instance используется напрямую', async () => {
    const customInstance = {
      session_confirmation_code: null,
      code_for_comparison: null,
      do_need_to_record_session: true,
      session_has_been_confirmed: false,
      some_field: 'value',
    };

    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({data: mockTemplate});
    mockRequest.mockResolvedValueOnce({data: mockDescriptor});
    mockRequest.mockResolvedValueOnce({data: {context: {}, send_sms_logs: 'SUCCESS: '}});

    await sendVisitConfirmationCode(account, {
      taskUuid: 'task-uuid-1',
      code: '3864',
      instance: customInstance,
    });

    const calls = mockRequest.mock.calls;
    const lastCall = calls[calls.length - 1];
    const body = lastCall[3] as Record<string, unknown>;
    expect(body.context.some_field).toBe('value');
  });
});

// ===========================================================================
// confirmVisit — тело запроса
// ===========================================================================

describe('confirmVisit', () => {
  it('отправляет PUT /api/bpm/tasks/{taskUuid} с правильным телом', async () => {
    mockRequest.mockResolvedValue({data: {session_has_been_confirmed: true, id: 'task-uuid-1'}});

    await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, method, url] = mockRequest.mock.calls[0];
    expect(method).toBe('put');
    expect(url).toBe('/api/bpm/tasks/task-uuid-1');

    const body = mockRequest.mock.calls[0][3] as Record<string, unknown>;
    expect(body.instanceId).toBe('inst-uuid-1');
    const data = body.data as Record<string, unknown>;
    expect(data.__exit).toBe(EXIT_CONFIRM_VISIT);
    expect(data.__action).toBe(true);
    expect(data.__skipSave).toEqual([]);
    expect(data.__comment).toBeNull();
    expect(data.session_confirmation_code).toBe('3864');
    expect(data.code_for_comparison).toBe('3864');
    expect(data.without_session_confirmation).toBe(false);
    expect(data.reason_for_lack_of_confirmation).toBeNull();
    expect(data.send_sms_logs).toBeNull();
  });

  it('тело содержит только короткие ключи (без длинных)', async () => {
    mockRequest.mockResolvedValue({data: {session_has_been_confirmed: true}});

    await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });

    const data = (mockRequest.mock.calls[0][3].data) as Record<string, unknown>;
    const longKeys = Object.keys(data).filter((k) => k.startsWith('customer_service.'));
    expect(longKeys).toHaveLength(0);
    for (const key of Object.keys(data)) {
      expect(key).not.toContain('.');
    }
  });

  it('поддерживает withoutConfirmation и reason', async () => {
    mockRequest.mockResolvedValue({data: {session_has_been_confirmed: false}});

    await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
      withoutConfirmation: true,
      reason: 'Мастер не пришёл',
    });

    const data = (mockRequest.mock.calls[0][3].data) as Record<string, unknown>;
    expect(data.without_session_confirmation).toBe(true);
    expect(data.reason_for_lack_of_confirmation).toBe('Мастер не пришёл');
  });

  it('поддерживает sendSmsLogs', async () => {
    mockRequest.mockResolvedValue({data: {session_has_been_confirmed: true}});

    await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
      sendSmsLogs: 'SUCCESS: ',
    });

    const data = (mockRequest.mock.calls[0][3].data) as Record<string, unknown>;
    expect(data.send_sms_logs).toBe('SUCCESS: ');
  });

  it('confirmed=true когда ответ содержит session_has_been_confirmed: true', async () => {
    mockRequest.mockResolvedValue({data: {session_has_been_confirmed: true}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });
    expect(result.confirmed).toBe(true);
  });

  it('confirmed=false когда ответ содержит session_has_been_confirmed: false', async () => {
    mockRequest.mockResolvedValue({data: {session_has_been_confirmed: false}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });
    expect(result.confirmed).toBe(false);
  });

  it('confirmed=true, если в ответе PUT флага нет, а задача на сервере уже верифицирована', async () => {
    mockRequest.mockReset();
    // PUT принят, но состояние визита в ответе не отражено
    mockRequest.mockResolvedValueOnce({data: {id: 'task-uuid-1'}});
    // GET задачи уже показывает подтверждение
    mockRequest.mockResolvedValueOnce({data: {instance: {session_has_been_confirmed: true, id: 'inst-uuid-1'}}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });

    expect(result.confirmed).toBe(true);
    expect(result.instance.session_has_been_confirmed).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[1][1]).toBe('get');
    expect(mockRequest.mock.calls[1][2]).toBe('/api/bpm/tasks/task-uuid-1');
  });

  it('флаг появляется не с первой перечитки — цикл опроса доходит до нужной попытки', async () => {
    mockRequest.mockReset();
    // PUT принят, флага нет
    mockRequest.mockResolvedValueOnce({data: {id: 'task-uuid-1'}});
    // первая перечитка — без флага
    mockRequest.mockResolvedValueOnce({data: {instance: {session_has_been_confirmed: false, id: 'inst-uuid-1'}}});
    // вторая перечитка — без флага
    mockRequest.mockResolvedValueOnce({data: {instance: {session_has_been_confirmed: false, id: 'inst-uuid-1'}}});
    // третья перечитка — флаг появился
    mockRequest.mockResolvedValueOnce({data: {instance: {session_has_been_confirmed: true, id: 'inst-uuid-1'}}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });

    expect(result.confirmed).toBe(true);
    expect(result.instance.session_has_been_confirmed).toBe(true);
    // PUT + 3 GET
    expect(mockRequest).toHaveBeenCalledTimes(4);
    for (let i = 1; i < 4; i++) {
      expect(mockRequest.mock.calls[i][1]).toBe('get');
    }
    // задержка тратится только между попытками: первая перечитка — без задержки
    expect(mockDelay).toHaveBeenCalledTimes(2);
    expect(mockDelay).toHaveBeenCalledWith(1500);
  });

  it('флаг так и не пришёл за все попытки — confirmed=false, число GET ограничено', async () => {
    mockRequest.mockReset();
    // PUT без флага
    mockRequest.mockResolvedValueOnce({data: {id: 'task-uuid-1'}});
    // все перечитки — без флага
    mockRequest.mockResolvedValue({data: {instance: {session_has_been_confirmed: false, id: 'inst-uuid-1'}}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });

    expect(result.confirmed).toBe(false);
    expect(result.instance.session_has_been_confirmed).toBe(false);
    // 1 PUT + 6 GET (CONFIRM_VISIT_POLL_ATTEMPTS)
    expect(mockRequest).toHaveBeenCalledTimes(7);
    const getCalls = mockRequest.mock.calls.filter(([, method]) => method === 'get');
    expect(getCalls).toHaveLength(6);
    // задержка между попытками: 6 перечиток, первая без задержки → 5 задержек
    expect(mockDelay).toHaveBeenCalledTimes(5);
  });
});

describe('sendVisitConfirmationCode — обработка ошибок', () => {
  it('возвращает ok=false когда fetchProcessTemplate бросает', async () => {
    mockRequest.mockReset();
    mockRequest.mockRejectedValue(new Error('NETWORK ERROR'));

    const result = await sendVisitConfirmationCode(account, {
      taskUuid: 'task-uuid-1',
      code: '1234',
    });

    expect(result.ok).toBe(false);
    expect(result.sendSmsLogs).toContain('ERROR');
  });

  it('возвращает ok=false когда fetchFormDescriptor бросает', async () => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({data: {task: mockTask}});
    mockRequest.mockResolvedValueOnce({data: mockTemplate});
    mockRequest.mockRejectedValue(new Error('DESCR ERROR'));

    const result = await sendVisitConfirmationCode(account, {
      taskUuid: 'task-uuid-1',
      code: '1234',
    });

    expect(result.ok).toBe(false);
    expect(result.sendSmsLogs).toContain('DESCR ERROR');
  });

  it('instance переданный напрямую без лишнего GET задачи', async () => {
    const customInstance = {
      session_confirmation_code: null,
      code_for_comparison: null,
      do_need_to_record_session: true,
      session_has_been_confirmed: false,
      some_field: 'value',
    };

    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({data: mockTemplate});
    mockRequest.mockResolvedValueOnce({data: mockDescriptor});
    mockRequest.mockResolvedValueOnce({data: {context: {}, send_sms_logs: 'SUCCESS: '}});

    await sendVisitConfirmationCode(account, {
      taskUuid: 'task-uuid-1',
      code: '3864',
      instance: customInstance,
    });

    // Должно быть 3 вызова: шаблон, дескриптор, widgets/execute. fetchTaskById НЕ вызывается.
    expect(mockRequest).toHaveBeenCalledTimes(3);
    const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
    const body = lastCall[3] as Record<string, unknown>;
    expect(body.context.some_field).toBe('value');
    expect(body.context.session_confirmation_code).toBeNull();
  });
});

// ===========================================================================
// confirmVisit — обработка ответа задачи vs инстанса
// ===========================================================================

describe('confirmVisit — обработка task vs instance ответа', () => {
  it('confirmed=true когда ответ — объект инстанса напрямую', async () => {
    mockRequest.mockResolvedValue({data: {session_has_been_confirmed: true, id: 'inst-uuid-1'}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });
    expect(result.confirmed).toBe(true);
    expect(result.instance.session_has_been_confirmed).toBe(true);
  });

  it('confirmed=true когда ответ — объект задачи с .instance (не теряется случай)', async () => {
    mockRequest.mockResolvedValue({data: {instance: {session_has_been_confirmed: true, id: 'inst-uuid-1'}}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });
    expect(result.confirmed).toBe(true);
    expect(result.instance.session_has_been_confirmed).toBe(true);
  });

  it('confirmed=false когда ответ — объект задачи с .instance и session_has_been_confirmed=false', async () => {
    mockRequest.mockResolvedValue({data: {instance: {session_has_been_confirmed: false, id: 'inst-uuid-1'}}});

    const result = await confirmVisit(account, {
      taskUuid: 'task-uuid-1',
      instanceId: 'inst-uuid-1',
      code: '3864',
    });
    expect(result.confirmed).toBe(false);
  });
});

// ===========================================================================
// sendVisitConfirmationCode — полнота fields / нормализация контекста (HAR21)
// ===========================================================================

describe('sendVisitConfirmationCode — структура fields и context (HAR21 entry 583)', () => {
  /** Полный дескриптор SYS_COLLECTION как в ответе шаблона (HAR21). */
  const applicationsDescriptor = {
    code: 'applications',
    type: 'SYS_COLLECTION',
    searchable: false,
    indexed: false,
    deleted: false,
    array: true,
    required: false,
    columned: false,
    columnName: '',
    single: true,
    defaultValue: null,
    calcByFormula: false,
    formula: '',
    data: {code: 'applications', namespace: 'customer_service'},
    view: {name: 'Заявка'},
  };

  /** Шаблон с контекстом, где поля — ПОЛНЫЕ дескрипторы (как отдаёт сервер). */
  const richTemplate = {
    context: [
      applicationsDescriptor,
      {
        code: 'code_for_comparison',
        type: 'STRING',
        searchable: false,
        indexed: false,
        deleted: false,
        array: false,
        required: false,
        single: true,
        data: {},
        view: {name: 'Код для сравнения'},
      },
      {
        code: 'session_confirmation_code',
        type: 'STRING',
        array: false,
        required: false,
        single: true,
        data: {},
        view: {name: 'Код подтверждения визита'},
      },
    ],
  };

  function setup(
    template: Record<string, unknown> = richTemplate,
    descriptor = mockDescriptor,
    instance?: Record<string, unknown>,
    response: Record<string, unknown> = {context: {}, send_sms_logs: 'SUCCESS: '},
  ) {
    mockRequest.mockReset();
    if (!instance) {
      mockRequest.mockResolvedValueOnce({data: {task: mockTask}});
    }
    mockRequest.mockResolvedValueOnce({data: template});
    mockRequest.mockResolvedValueOnce({data: descriptor});
    mockRequest.mockResolvedValueOnce({data: response});
    return instance;
  }

  function lastBody(): Record<string, unknown> {
    const calls = mockRequest.mock.calls;
    return calls[calls.length - 1][3] as Record<string, unknown>;
  }

  it('fields содержит applications с data.namespace и data.code (дескрипторы не урезаны)', async () => {
    setup();

    await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    const body = lastBody();
    const fields = body.fields as Record<string, unknown>[];
    const applications = fields.filter((f) => f.code === 'applications');
    expect(applications).toHaveLength(1);

    const data = applications[0].data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(data.namespace).toBe('customer_service');
    expect(data.code).toBe('applications');
    expect(applications[0].required).toBe(false);
    expect(applications[0].searchable).toBe(false);
    expect(applications[0].indexed).toBe(false);
  });

  it('code_for_comparison присутствует в fields ровно один раз и есть в context', async () => {
    setup();

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '7721'});

    const body = lastBody();
    const fields = body.fields as Record<string, unknown>[];
    expect(fields.filter((f) => f.code === 'code_for_comparison')).toHaveLength(1);
    expect((body.context as Record<string, unknown>).code_for_comparison).toBe('7721');
    expect(result.ok).toBe(true);
  });

  it('дубликаты по code в fields не появляются', async () => {
    setup();

    await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    const fields = lastBody().fields as Record<string, unknown>[];
    const codes = fields.map((f) => String(f.code));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('обязательные поля подтверждения добавляются, если их нет ни в шаблоне, ни в форме', async () => {
    setup();

    await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    const fields = lastBody().fields as Record<string, unknown>[];
    const codes = fields.map((f) => String(f.code));
    for (const required of [
      'code_for_comparison',
      'session_confirmation_code',
      'without_session_confirmation',
      'reason_for_lack_of_confirmation',
      'do_need_to_record_session',
      'session_has_been_confirmed',
      'confirmation_error',
    ]) {
      expect(codes).toContain(required);
    }
  });

  it('системные поля идут первыми и __name/__comment несут data.additionalType', async () => {
    setup();

    await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    const fields = lastBody().fields as Record<string, unknown>[];
    expect(fields.slice(0, 3).map((f) => f.code)).toEqual(['__createdBy', '__name', '__comment']);

    const nameView = fields[1].view as Record<string, unknown>;
    const commentView = fields[2].view as Record<string, unknown>;
    expect((nameView.data as Record<string, unknown>).additionalType).toBe('string');
    expect((commentView.data as Record<string, unknown>).additionalType).toBe('text');
  });

  it('applications-массив в инстансе нормализуется в строку (первый элемент)', async () => {
    const instance = {
      applications: ['01a0aa41-f1ff-7555-8d7b-b4ca70121441'],
      session_confirmation_code: null,
      do_need_to_record_session: true,
    };
    setup(richTemplate, mockDescriptor, instance);

    await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864', instance});

    const body = lastBody();
    expect((body.context as Record<string, unknown>).applications).toBe(
      '01a0aa41-f1ff-7555-8d7b-b4ca70121441',
    );
  });

  it('отсутствующий в инстансе session_confirmation_code уходит в context как null', async () => {
    const instance = {applications: '01a0aa41-f1ff-7555-8d7b-b4ca70121441'};
    setup(richTemplate, mockDescriptor, instance);

    await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864', instance});

    expect((lastBody().context as Record<string, unknown>).session_confirmation_code).toBeNull();
  });

  it('send_sms_logs читается из context ответа (как в HAR21)', async () => {
    setup(richTemplate, mockDescriptor, undefined, {
      context: {send_sms_logs: 'SUCCESS: 202'},
    });

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    expect(result.ok).toBe(true);
    expect(result.sendSmsLogs).toBe('SUCCESS: 202');
  });

  it('пустой send_sms_logs → ok=false и текст про пустой ответ', async () => {
    setup(richTemplate, mockDescriptor, undefined, {context: {send_sms_logs: null}});

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    expect(result.ok).toBe(false);
    expect(result.sendSmsLogs).toBe('Сервер не подтвердил отправку (пустой ответ)');
  });

  it('ответ вовсе без send_sms_logs → ok=false и текст про пустой ответ', async () => {
    setup(richTemplate, mockDescriptor, undefined, {context: {}});

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    expect(result.ok).toBe(false);
    expect(result.sendSmsLogs).toBe('Сервер не подтвердил отправку (пустой ответ)');
  });

  it('FUNCTION ERROR в context ответа возвращается как есть', async () => {
    setup(richTemplate, mockDescriptor, undefined, {
      context: {send_sms_logs: 'FUNCTION ERROR: отсутствует заявка'},
    });

    const result = await sendVisitConfirmationCode(account, {taskUuid: 'task-uuid-1', code: '3864'});

    expect(result.ok).toBe(false);
    expect(result.sendSmsLogs).toBe('FUNCTION ERROR: отсутствует заявка');
  });
});

// ===========================================================================
// clearVisitTemplateCache
// ===========================================================================

describe('clearVisitTemplateCache', () => {
  it('не бросает и очищает кэш', () => {
    expect(() => clearVisitTemplateCache()).not.toThrow();
  });
});