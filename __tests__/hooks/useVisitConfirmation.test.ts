/**
 * Тесты хука useVisitConfirmation.
 * Моким elma-api и используем fake timers для cooldown.
 * Никаких сетевых запросов.
 */

import React from 'react';
import renderer from 'react-test-renderer';
import {act} from 'react-test-renderer';
import {useVisitConfirmation} from '../../src/hooks/useVisitConfirmation';
import {sendVisitConfirmationCode, confirmVisit, clearVisitTemplateCache} from '../../src/services/elma-api';
import {generateVisitCode, validateVisitCode} from '../../src/utils/visit-code';
import type {ElmaAccount} from '../../src/types/account';

jest.mock('../../src/services/elma-api', () => ({
  sendVisitConfirmationCode: jest.fn(),
  confirmVisit: jest.fn(),
  clearVisitTemplateCache: jest.fn(),
  getTaskInstance: jest.fn(),
  isVisitConfirmed: jest.fn(),
  needsVisitConfirmation: jest.fn(),
  EXIT_CONFIRM_VISIT: '877fac69-f4d9-4745-80fd-5c3dbfc8b8dd',
  EXIT_DONE_CONFIRMED: 'eb83ef3d-0526-487f-9c50-17e00d162c82',
  fetchTaskById: jest.fn(),
  fetchProcessTemplate: jest.fn(),
  fetchFormDescriptor: jest.fn(),
  completeTaskByExit: jest.fn(),
  fetchTaskExitsNormalized: jest.fn(),
}));

jest.mock('../../src/utils/visit-code', () => ({
  generateVisitCode: jest.fn(),
  validateVisitCode: jest.fn(),
}));

const mockSendVisitConfirmationCode = sendVisitConfirmationCode as jest.MockedFunction<typeof sendVisitConfirmationCode>;
const mockConfirmVisit = confirmVisit as jest.MockedFunction<typeof confirmVisit>;
const mockGenerateVisitCode = generateVisitCode as jest.MockedFunction<typeof generateVisitCode>;
const mockValidateVisitCode = validateVisitCode as jest.MockedFunction<typeof validateVisitCode>;

jest.useFakeTimers();

const account = {id: 'acc-1', baseUrl: 'https://elma.example'} as unknown as ElmaAccount;

const mockInstance = {
  session_confirmation_code: null,
  code_for_comparison: null,
  send_sms_logs: null,
  session_has_been_confirmed: false,
  do_need_to_record_session: true,
  without_session_confirmation: null,
  reason_for_lack_of_confirmation: null,
};

const mockInstanceConfirmed = {...mockInstance, session_has_been_confirmed: true};

const onConfirmed = jest.fn();

const stateRef = React.createRef<ReturnType<typeof useVisitConfirmation> | null>(null);

function StateReader(props: {taskUuid: string; instanceId: string; instance: Record<string, unknown>}) {
  const state = useVisitConfirmation(account, props.taskUuid, props.instanceId, props.instance, onConfirmed);
  stateRef.current = state;
  return null;
}

let rootRef: renderer.ReactTestRenderer | null = null;

function setup() {
  clearVisitTemplateCache();
  mockGenerateVisitCode.mockReturnValue('1234');
  mockValidateVisitCode.mockReturnValue(true);
  mockSendVisitConfirmationCode.mockResolvedValue({ok: true, sendSmsLogs: 'SUCCESS: ', context: {}});
  mockConfirmVisit.mockResolvedValue({confirmed: true, instance: mockInstanceConfirmed});
  mockSendVisitConfirmationCode.mockClear();
  stateRef.current = null;
  rootRef = null;
  rootRef = renderer.create(React.createElement(StateReader, {taskUuid: 'task-uuid-1', instanceId: 'inst-uuid-1', instance: mockInstance}));
}

function mount() {
  if (!rootRef) {
    rootRef = renderer.create(React.createElement(StateReader, {taskUuid: 'task-uuid-1', instanceId: 'inst-uuid-1', instance: mockInstance}));
  }
}

function rerender() {
  if (rootRef) {
    act(() => {
      rootRef!.update(React.createElement(StateReader, {taskUuid: 'task-uuid-1', instanceId: 'inst-uuid-1', instance: mockInstance}));
    });
  }
}

function getState() {
  return stateRef.current!;
}

// ===========================================================================
// Тесты
// ===========================================================================

describe('useVisitConfirmation', () => {
  afterEach(() => {
    jest.clearAllTimers();
    stateRef.current = null;
    rootRef = null;
  });

  it('начинает с idle состояния', () => {
    setup();
    expect(getState().step).toBe('idle');
    expect(getState().generatedCode).toBe('');
    expect(getState().cooldownLeft).toBe(0);
    expect(getState().error).toBe('');
    expect(getState().withoutConfirmation).toBe(false);
    expect(getState().reason).toBe('');
  });

  it('sendCode при ok генерирует код, ставит step=sent и запускает cooldown 60с', async () => {
    setup();
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    await getState().sendCode();
    rerender();

    expect(mockGenerateVisitCode).toHaveBeenCalled();
    expect(mockSendVisitConfirmationCode).toHaveBeenCalledWith(account, {
      taskUuid: 'task-uuid-1',
      code: '5678',
      instance: mockInstance,
    });
    expect(getState().step).toBe('sent');
    expect(getState().sendSmsLogs).toBe('SUCCESS: ');
    expect(getState().cooldownLeft).toBe(60);
  });

  it('повторная отправка недоступна пока cooldownLeft > 0', async () => {
    setup();
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    await getState().sendCode();
    rerender();
    const callCount = mockSendVisitConfirmationCode.mock.calls.length;

    await getState().sendCode();

    expect(mockSendVisitConfirmationCode.mock.calls.length).toBe(callCount);
  });

  it('sendCode при ok=false ставит step=error с текстом send_sms_logs', async () => {
    setup();
    mockSendVisitConfirmationCode.mockResolvedValue({ok: false, sendSmsLogs: 'FUNCTION ERROR: отсутствует заявка', context: {}});
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    await getState().sendCode();
    rerender();

    expect(getState().step).toBe('error');
    expect(getState().error).toContain('FUNCTION ERROR:');
  });

  it('sendCode при ERROR: в send_sms_logs ставит step=error', async () => {
    setup();
    mockSendVisitConfirmationCode.mockResolvedValue({ok: false, sendSmsLogs: 'ERROR: 500 - Internal Server Error', context: {}});
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    await getState().sendCode();
    rerender();

    expect(getState().step).toBe('error');
    expect(getState().error).toContain('ERROR:');
  });

  it('sendCode при ok=false с текстом без ERROR: показывает реальный ответ сервера', async () => {
    setup();
    mockSendVisitConfirmationCode.mockResolvedValue({ok: false, sendSmsLogs: 'СМС не отправлено: неверный номер', context: {}});
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    await getState().sendCode();
    rerender();

    expect(getState().step).toBe('error');
    expect(getState().error).toBe('СМС не отправлено: неверный номер');
    expect(getState().sendSmsLogs).toBe('СМС не отправлено: неверный номер');
  });

  it('sendCode при ok=false с пустым sendSmsLogs ставит обобщённую ошибку', async () => {
    setup();
    mockSendVisitConfirmationCode.mockResolvedValue({ok: false, sendSmsLogs: '', context: {}});
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    await getState().sendCode();
    rerender();

    expect(getState().step).toBe('error');
    expect(getState().error).toBe('Ошибка отправки СМС');
    expect(getState().sendSmsLogs).toBe('');
  });

  it('confirm при !withoutConfirmation и пустом коде ставит error', async () => {
    setup();
    mockValidateVisitCode.mockReturnValue(false);
    mount();

    getState().setCode('');
    rerender();

    await getState().confirm();
    rerender();

    expect(mockConfirmVisit).not.toHaveBeenCalled();
    expect(getState().error).toBe('Код должен содержать 4 цифры');
  });

  it('confirm при !withoutConfirmation и 3 цифрах ставит error', async () => {
    setup();
    mockValidateVisitCode.mockReturnValue(false);
    mount();

    getState().setCode('123');
    rerender();

    await getState().confirm();
    rerender();

    expect(mockConfirmVisit).not.toHaveBeenCalled();
    expect(getState().error).toBe('Код должен содержать 4 цифры');
  });

  it('withoutConfirmation=true требует причину', async () => {
    setup();
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    getState().setWithoutConfirmation(true);
    getState().setReason('');
    rerender();

    await getState().confirm();
    rerender();

    expect(mockConfirmVisit).not.toHaveBeenCalled();
    expect(getState().error).toBe('Укажите причину отсутствия подтверждения');
  });

  it('confirmVisit confirmed=false ставит step=error', async () => {
    setup();
    mockConfirmVisit.mockResolvedValue({confirmed: false, instance: mockInstance});
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    getState().setCode('1234');
    rerender();

    await getState().confirm();
    rerender();

    expect(mockConfirmVisit).toHaveBeenCalled();
    expect(getState().step).toBe('error');
    expect(getState().error).toBe('Неверный код подтверждения');
  });

  it('confirmVisit confirmed=true ставит step=confirmed и вызывает onConfirmed', async () => {
    setup();
    mockConfirmVisit.mockResolvedValue({confirmed: true, instance: mockInstanceConfirmed});
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    getState().setCode('1234');
    rerender();

    await getState().confirm();
    rerender();

    expect(getState().step).toBe('confirmed');
    expect(onConfirmed).toHaveBeenCalled();
  });

  it('confirmVisit confirmed=false и код НЕ совпадает с сгенерированным — step=error', async () => {
    setup();
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mockConfirmVisit.mockResolvedValue({confirmed: false, instance: mockInstance});
    onConfirmed.mockClear();
    mount();

    await getState().sendCode();
    rerender();
    expect(getState().generatedCode).toBe('5678');

    getState().setCode('9999');
    rerender();

    await getState().confirm();
    rerender();

    expect(mockConfirmVisit).toHaveBeenCalled();
    expect(getState().step).toBe('error');
    expect(getState().error).toBe('Неверный код подтверждения');
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('confirmVisit confirmed=false без sendCode (generatedCode пуст) — step=error', async () => {
    setup();
    mockConfirmVisit.mockResolvedValue({confirmed: false, instance: mockInstance});
    mockValidateVisitCode.mockReturnValue(true);
    onConfirmed.mockClear();
    mount();

    getState().setCode('1234');
    rerender();

    await getState().confirm();
    rerender();

    expect(getState().step).toBe('error');
    expect(getState().error).toBe('Неверный код подтверждения');
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('reset возвращает начальное состояние', () => {
    setup();
    mockSendVisitConfirmationCode.mockResolvedValue({ok: true, sendSmsLogs: 'SUCCESS: ', context: {}});
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    getState().setCode('1234');
    getState().setWithoutConfirmation(true);
    getState().setReason('test');

    getState().reset();

    expect(getState().step).toBe('idle');
    expect(getState().code).toBe('');
    expect(getState().withoutConfirmation).toBe(false);
    expect(getState().reason).toBe('');
    expect(getState().error).toBe('');
  });

  it('cooldown очищается при размонтировании', () => {
    setup();
    mockGenerateVisitCode.mockReturnValue('5678');
    mockValidateVisitCode.mockReturnValue(true);
    mount();

    getState().sendCode();
    rootRef!.unmount();
    rootRef = null;

    // После размонтирования состояние сбрасывается
    stateRef.current = null;
    expect(stateRef.current).toBeNull();
  });

   it('sendCode при ok после прогрева cooldown возвращается к sent', async () => {
     setup();
     mockGenerateVisitCode.mockReturnValue('5678');
     mockValidateVisitCode.mockReturnValue(true);
     mount();

     await getState().sendCode();
     rerender();
     expect(getState().step).toBe('sent');
     expect(getState().cooldownLeft).toBe(60);

     // После advanceTimers cooldown должен дойти до 0
     jest.advanceTimersByTime(60000);
     rerender();
     expect(getState().cooldownLeft).toBe(0);
     expect(getState().step).toBe('sent');
   });

   it('после полного прохождения cooldown sendCode доступен повторно (исправление бага)', async () => {
     setup();
     mockGenerateVisitCode.mockReturnValue('5678');
     mockValidateVisitCode.mockReturnValue(true);
     mount();

     await getState().sendCode();
     rerender();
     expect(mockSendVisitConfirmationCode.mock.calls.length).toBe(1);

     // Продвигаем таймер на 60+ секунд — cooldown должен завершиться
     jest.advanceTimersByTime(61000);
     rerender();
     expect(getState().cooldownLeft).toBe(0);

     // Повторная отправка должна пройти (mock вызовется второй раз)
     await getState().sendCode();
     rerender();
     expect(mockSendVisitConfirmationCode.mock.calls.length).toBe(2);
     expect(getState().step).toBe('sent');
   });

   it('reset останавливает cooldown и позволяет отправить снова', async () => {
     setup();
     mockGenerateVisitCode.mockReturnValue('5678');
     mockValidateVisitCode.mockReturnValue(true);
     mount();

     await getState().sendCode();
     rerender();
     expect(getState().cooldownLeft).toBe(60);

     getState().reset();
     rerender();
     expect(getState().cooldownLeft).toBe(0);
     expect(getState().step).toBe('idle');

     // После reset отправка должна быть доступна
     await getState().sendCode();
     rerender();
     expect(mockSendVisitConfirmationCode.mock.calls.length).toBe(2);
   });
});
