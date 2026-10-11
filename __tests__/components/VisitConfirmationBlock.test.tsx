/**
 * VisitConfirmationBlock — два состояния блока подтверждения визита.
 *
 * А) визит НЕ подтверждён: активная кнопка «Отправить код клиенту», поле кода,
 *    чекбокс «Без подтверждения визита» и кнопка «Подтвердить визит»;
 * Б) визит подтверждён: зелёная карточка «Верифицирован», кнопка отправки
 *    присутствует, но серая (disabled); поля кода, чекбокса и кнопки
 *    «Подтвердить визит» нет; кнопки «Продолжить» больше нет.
 *
 * Подтверждение визита НЕ завершает задачу: submitTask/completeTaskByExit
 * из UI-слоя не вызываются — только onConfirmed().
 *
 * Все сетевые вызовы замоканы, реальных запросов к ELMA нет.
 */

import React from 'react';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {PaperProvider} from 'react-native-paper';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('../../src/services/elma-api', () => {
  const actual = jest.requireActual('../../src/services/elma-api');
  return {
    ...actual,
    sendVisitConfirmationCode: jest.fn(),
    confirmVisit: jest.fn(),
    submitTask: jest.fn(),
    completeTaskByExit: jest.fn(),
  };
});

import {VisitConfirmationBlock} from '../../src/components/VisitConfirmationBlock';
import {
  sendVisitConfirmationCode,
  confirmVisit,
  submitTask,
  completeTaskByExit,
} from '../../src/services/elma-api';
import type {ElmaAccount} from '../../src/types/account';

const mockedSend = sendVisitConfirmationCode as jest.Mock;
const mockedConfirm = confirmVisit as jest.Mock;
const mockedSubmit = submitTask as jest.Mock;
const mockedComplete = completeTaskByExit as jest.Mock;

jest.useFakeTimers();

const account = {
  id: 'acc-1',
  name: 'Мастер',
  baseUrl: 'https://elma.test',
  portal: 'customer_service',
  email: 'user@example.com',
  color: '#4CAF50',
  userId: 'user-1',
  token: 'token-1',
  cookies: '',
  isActive: true,
  userKind: 'portal',
} as unknown as ElmaAccount;

const baseInstance = {
  do_need_to_record_session: true,
  session_has_been_confirmed: false,
};

const confirmedInstance = {
  do_need_to_record_session: true,
  session_has_been_confirmed: true,
};

const onConfirmed = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockedSend.mockResolvedValue({ok: true, sendSmsLogs: 'SUCCESS: ', context: {}});
  mockedConfirm.mockResolvedValue({confirmed: true, instance: confirmedInstance});
});

function renderBlock(instance: Record<string, unknown>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <PaperProvider>
        <VisitConfirmationBlock
          account={account}
          taskUuid="task-uuid-1"
          instanceId="inst-uuid-1"
          instance={instance}
          onConfirmed={onConfirmed}
        />
      </PaperProvider>,
    );
  });
  return tree;
}

function findButton(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    n => n.props.children === label && typeof n.props.disabled === 'boolean',
  )[0];
}

function findLabel(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(n => n.props.label === label)[0];
}

function renderedStrings(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll(n => typeof n.props.children === 'string')
    .map(n => n.props.children as string);
}

function textContains(tree: ReactTestRenderer, substring: string): boolean {
  return tree.root
    .findAll(n => n.props.children !== undefined && n.props.children !== null)
    .some(n => {
      const c = n.props.children;
      const joined = Array.isArray(c) ? c.join('') : c;
      return typeof joined === 'string' && joined.includes(substring);
    });
}

async function press(node: {props: {onPress: () => void | Promise<void> | undefined}}) {
  await act(async () => {
    await node.props.onPress();
  });
}

describe('VisitConfirmationBlock — визит не подтверждён', () => {
  it('заголовок, активная отправка кода, поле кода, чекбокс и подтверждение', () => {
    const tree = renderBlock(baseInstance);

    expect(renderedStrings(tree)).toContain('Подтверждение визита');

    const sendBtn = findButton(tree, 'Отправить код клиенту');
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.props.disabled).toBe(false);

    const codeInput = findLabel(tree, 'Введите код из СМС');
    expect(codeInput).toBeTruthy();
    expect(codeInput.props.editable).not.toBe(false);

    expect(renderedStrings(tree)).toContain('Без подтверждения визита');
    expect(findButton(tree, 'Подтвердить визит')).toBeTruthy();

    expect(renderedStrings(tree)).not.toContain('Верифицирован');
    expect(renderedStrings(tree)).not.toContain('Продолжить');
  });

  it('блок рендерится и когда процесс не требует фиксации визита', () => {
    const tree = renderBlock({do_need_to_record_session: false, session_has_been_confirmed: false});

    expect(renderedStrings(tree)).toContain('Подтверждение визита');
    expect(findButton(tree, 'Отправить код клиенту')).toBeTruthy();
    expect(findLabel(tree, 'Введите код из СМС')).toBeTruthy();
  });

  it('кнопка отправки: disabled на время отправки, повторная отправка на cooldown не уходит', async () => {
    const tree = renderBlock(baseInstance);

    let resolveSend!: (v: {ok: boolean; sendSmsLogs: string; context: object}) => void;
    mockedSend.mockImplementation(
      () => new Promise(resolve => { resolveSend = resolve; }),
    );

    const sendBtn = findButton(tree, 'Отправить код клиенту');
    let pending!: Promise<void>;
    act(() => {
      pending = sendBtn.props.onPress() as Promise<void>;
    });

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(findButton(tree, 'Отправить код клиенту').props.disabled).toBe(true);

    await act(async () => {
      resolveSend({ok: true, sendSmsLogs: 'SUCCESS: ', context: {}});
      await pending;
    });

    expect(textContains(tree, 'Сгенерированный код')).toBe(true);
    expect(textContains(tree, 'Повторная отправка будет доступна')).toBe(true);

    await press(findButton(tree, 'Отправить код клиенту'));
    expect(mockedSend).toHaveBeenCalledTimes(1);
  });
});

describe('VisitConfirmationBlock — визит подтверждён', () => {
  it('зелёный «Верифицирован», серая кнопка отправки, без поля кода и чекбокса', () => {
    const tree = renderBlock(confirmedInstance);

    expect(renderedStrings(tree)).toContain('Подтверждение визита');
    expect(renderedStrings(tree)).toContain('Верифицирован');

    const sendBtn = findButton(tree, 'Отправить код клиенту');
    expect(sendBtn).toBeTruthy();
    expect(sendBtn.props.disabled).toBe(true);

    expect(findLabel(tree, 'Введите код из СМС')).toBeUndefined();
    expect(renderedStrings(tree)).not.toContain('Без подтверждения визита');
    expect(findButton(tree, 'Подтвердить визит')).toBeUndefined();

    expect(renderedStrings(tree)).not.toContain('Продолжить');
  });

  it('состояние step=confirmed (только что подтвердили) — тоже «Верифицирован»', async () => {
    const tree = renderBlock(baseInstance);

    const codeInput = findLabel(tree, 'Введите код из СМС');
    await act(async () => {
      codeInput.props.onChangeText('1234');
    });

    await press(findButton(tree, 'Подтвердить визит'));

    expect(mockedConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirmed).toHaveBeenCalledTimes(1);

    expect(renderedStrings(tree)).toContain('Верифицирован');
    expect(renderedStrings(tree)).not.toContain('Продолжить');
    expect(findLabel(tree, 'Введите код из СМС')).toBeUndefined();
    expect(findButton(tree, 'Подтвердить визит')).toBeUndefined();

    const sendBtn = findButton(tree, 'Отправить код клиенту');
    expect(sendBtn.props.disabled).toBe(true);

    // Подтверждение визита не завершает задачу
    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(mockedComplete).not.toHaveBeenCalled();
  });
});
