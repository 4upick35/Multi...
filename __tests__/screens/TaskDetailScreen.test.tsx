/**
 * TaskDetailScreen — безопасность действий по выходам задачи.
 *
 * Регресс к багу: экран рендерил fallback-кнопки с выдуманными exit-ключами,
 * ELMA отвечала 403 и банит сессию аккаунта.
 *
 * - при пустом списке выходов НЕ рендерятся и НЕ вызываются 'submit'/'complete';
 * - при наличии реальных выходов рендерятся их title (без хардкода);
 * - при нажатии кнопки «Действия» вызывается fetchTaskExitsNormalized;
 * - на сервер уходит только реально загруженный UUID-выход;
 * - ошибка 403 показывается без повторного запроса.
 *
 * Все сетевые вызовы замоканы — реальных запросов к ELMA нет.
 */

import React from 'react';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import {Alert} from 'react-native';
import {PaperProvider} from 'react-native-paper';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');

jest.mock('../../src/services/elma-api', () => {
  const actual = jest.requireActual('../../src/services/elma-api');
  return {
    ...actual,
    submitTask: jest.fn(),
    fetchTaskExitsNormalized: jest.fn(),
    fetchTaskTemplateExits: jest.fn(),
    searchWorkerQuery: jest.fn(),
    fetchTaskById: jest.fn(),
  };
});

import TaskDetailScreen from '../../src/screens/tasks/TaskDetailScreen';
import {useTasksStore} from '../../src/store/tasks-store';
import {useAuthStore} from '../../src/store/auth-store';
import {
  submitTask,
  fetchTaskExitsNormalized,
  fetchTaskTemplateExits,
  fetchTaskById,
  searchWorkerQuery,
  EXIT_CONFIRM_VISIT,
} from '../../src/services/elma-api';

const mockedSubmit = submitTask as jest.Mock;
const mockedExits = fetchTaskExitsNormalized as jest.Mock;
const mockedTemplateExits = fetchTaskTemplateExits as jest.Mock;
const mockedFetchTaskById = fetchTaskById as jest.Mock;
const mockedSearchWorkerQuery = searchWorkerQuery as jest.Mock;

const EXIT_A = '2d8f3a10-6b4e-4f2a-9c3d-1a2b3c4d5e6f';
const EXIT_B = '9c1e7b22-3f5a-4d18-8e7b-6f5e4d3c2b1a';

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
};

const task = {
  id: 'task-1',
  accountId: 'acc-1',
  name: 'CheckObject',
  subject: 'Проверка объекта',
  status: 'assignment',
  priority: 'normal',
  createdAt: '2026-01-01',
  isOverdue: false,
  instanceId: 'inst-1',
  taskId: 'task-1',
  templateNsAndCode: 'customer_service:check_object',
  path: '/items/7f1c0d2e-9a4b-4c31-8d5e-2b6a4f9c1e77',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedTemplateExits.mockResolvedValue([]);
  // По умолчанию instance в задаче нет: форма открывается без предзаполнения.
  mockedFetchTaskById.mockResolvedValue({task: null});
  useAuthStore.setState({accounts: [account]});
  useTasksStore.setState({tasksByAccount: {'acc-1': [task]}});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function renderScreen(
  onBack: () => void = jest.fn(),
  onExecution?: () => void,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <PaperProvider>
        <TaskDetailScreen
          taskId={task.id}
          accountId={account.id}
          onBack={onBack}
          onExecution={onExecution}
        />
      </PaperProvider>,
    );
  });
  return tree;
}

type PressableNode = {props: {onPress: () => void | Promise<void> | undefined}};

function findButton(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (n) => n.props.children === label && typeof n.props.onPress === 'function',
  )[0];
}

async function press(node: PressableNode): Promise<void> {
  await act(async () => {
    await node.props.onPress();
  });
}

function renderedStrings(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => typeof n.props.children === 'string')
    .map((n) => n.props.children as string);
}

describe('TaskDetailScreen — безопасные действия по выходам', () => {
  it('кнопка «Действия» вызывает fetchTaskExitsNormalized', async () => {
    mockedExits.mockResolvedValue([]);
    const tree = renderScreen();

    const loadBtn = findButton(tree, 'Действия');
    expect(loadBtn).toBeTruthy();

    await press(loadBtn as PressableNode);

    expect(mockedExits).toHaveBeenCalledTimes(1);
    expect(mockedExits.mock.calls[0][1]).toBe('task-1');
  });

  it('пустой список: нет fallback-кнопок, показывается «Нет доступных действий», submitTask не вызывается', async () => {
    mockedExits.mockResolvedValue([]);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);

    const texts = renderedStrings(tree);
    expect(texts).toContain('Нет доступных действий');

    // Ни одной захардкоженной fallback-кнопки
    expect(findButton(tree, 'Принять задачу')).toBeUndefined();
    expect(findButton(tree, 'Завершить')).toBeUndefined();

    // В отрендеренном тексте нет литералов exit-ключей
    expect(texts.join(' ')).not.toMatch(/submit|complete/i);

    // И ничего не ушло на сервер
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('после пустого списка кнопка «Действия» остаётся — повторная загрузка возможна', async () => {
    mockedExits.mockResolvedValue([]);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    expect(findButton(tree, 'Действия')).toBeTruthy();
    expect(renderedStrings(tree)).toContain('Нет доступных действий');

    await press(findButton(tree, 'Действия') as PressableNode);
    expect(mockedExits).toHaveBeenCalledTimes(2);
  });

  it('реальные выходы рендерятся своими title; подтверждение визита отфильтровано', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Согласование времени'},
      {id: EXIT_CONFIRM_VISIT, key: 'visit', title: 'Подтверждение визита'},
      {id: EXIT_B, key: 'exit-b', title: 'Внесение данных о выполненных работах'},
    ]);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);

    expect(findButton(tree, 'Согласование времени')).toBeTruthy();
    expect(findButton(tree, 'Внесение данных о выполненных работах')).toBeTruthy();
    expect(findButton(tree, 'Подтверждение визита')).toBeUndefined();

    // Хардкод-кнопки не появляются и при непустом списке
    expect(findButton(tree, 'Принять задачу')).toBeUndefined();
    expect(findButton(tree, 'Завершить')).toBeUndefined();
  });

  it('нажатие выхода отправляет на сервер только его UUID', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Согласование времени'},
      {id: EXIT_B, key: 'exit-b', title: 'Внесение данных о выполненных работах'},
    ]);
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Внесение данных о выполненных работах') as PressableNode);

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    const [, instanceId, taskId, exitId] = mockedSubmit.mock.calls[0];
    expect(instanceId).toBe('inst-1');
    expect(taskId).toBe('task-1');
    expect(exitId).toBe(EXIT_B);
    expect(['submit', 'complete']).not.toContain(exitId);
  });

  it('не-UUID идентификатор от сервера блокируется без сетевого запроса', async () => {
    mockedExits.mockResolvedValue([
      {id: 'submit', key: 'submit', title: 'Принять'},
    ]);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Принять') as PressableNode);

    expect(mockedSubmit).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Ошибка',
      expect.stringContaining('Действия'),
    );
  });

  it('ошибка 403 от submitTask показывается без повторного запроса', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Согласование времени'},
    ]);
    mockedSubmit.mockResolvedValue({
      ok: false,
      status: 403,
      error:
        'Сервер отклонил действие (403): действие недоступно или не разрешено для этой задачи. Нажмите «Действия», чтобы обновить список выходов.',
    });
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Согласование времени') as PressableNode);

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Ошибка',
      expect.stringContaining('(403)'),
    );
  });

  it('шаблон не загрузился → кнопки выходов не показываются и submit не уходит', async () => {
    mockedExits.mockResolvedValue([{id: EXIT_A, key: 'exit-a', title: 'Готово'}]);
    mockedTemplateExits.mockResolvedValue(null);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);

    // Кнопки выходов fail closed: проверить обязательные поля не удалось.
    expect(findButton(tree, 'Готово')).toBeUndefined();
    expect(renderedStrings(tree)).toContain(
      'Не удалось проверить действия задачи. Нажмите «Действия» ещё раз.',
    );
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('выход с обязательным полем открывает форму, submit уходит с значениями', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Отказ от выполнения'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Отказ от выполнения',
        formFields: [
          {
            code: 'comment_for_refuse',
            required: true,
            label: 'Комментарий к отказу',
            type: 'STRING',
          },
        ],
      },
    ]);
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);

    // Шаблон грузится только по кнопке «Действия» и с nodeId из path задачи
    expect(mockedTemplateExits).toHaveBeenCalledTimes(1);
    expect(mockedTemplateExits.mock.calls[0][1]).toBe('customer_service:check_object');
    expect(mockedTemplateExits.mock.calls[0][2]).toBe('7f1c0d2e-9a4b-4c31-8d5e-2b6a4f9c1e77');

    await press(findButton(tree, 'Отказ от выполнения') as PressableNode);

    // Форма открыта, отправки пока не было
    expect(tree.root.findAllByProps({testID: 'exit-form'}).length).toBeGreaterThan(0);
    expect(mockedSubmit).not.toHaveBeenCalled();

    const input = tree.root.findAll(
      n => n.props.testID === 'exit-field-comment_for_refuse' &&
        typeof n.props.onChangeText === 'function',
    )[0];
    expect(input).toBeTruthy();
    await act(async () => {
      input.props.onChangeText('Не успел выехать по регламенту');
    });

    await press(findButton(tree, 'Отправить') as PressableNode);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    const [, instanceId, taskId, exitId, values] = mockedSubmit.mock.calls[0];
    expect(instanceId).toBe('inst-1');
    expect(taskId).toBe('task-1');
    expect(exitId).toBe(EXIT_A);
    expect(values).toEqual({comment_for_refuse: 'Не успел выехать по регламенту'});

    // Успех закрывает форму и возвращает на список задач
    expect(Alert.alert).toHaveBeenCalledWith('Успех', 'Действие выполнено');
    expect(tree.root.findAllByProps({testID: 'exit-form'}).length).toBe(0);
  });

  it('незаполненное обязательное поле блокирует «Отправить»: submitTask не вызван', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Отказ от выполнения'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Отказ от выполнения',
        formFields: [
          {
            code: 'comment_for_refuse',
            required: true,
            label: 'Комментарий к отказу',
            type: 'STRING',
          },
        ],
      },
    ]);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Отказ от выполнения') as PressableNode);

    expect(tree.root.findAllByProps({testID: 'exit-form'}).length).toBeGreaterThan(0);

    const submit = tree.root.findAllByProps({testID: 'exit-form-submit'})[0];
    expect(submit.props.disabled).toBe(true);

    await press(submit as PressableNode);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('неподдерживаемое поле блокирует отправку и просит веб-клиент ELMA', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Отказ от выполнения'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Отказ от выполнения',
        formFields: [
          {
            code: 'reason_of_refuse',
            required: true,
            label: 'Причина отказа',
            type: 'SYS_COLLECTION',
            collection: {
              namespace: '_system_catalogs',
              code: 'results_of_work',
            },
          },
        ],
      },
    ]);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Отказ от выполнения') as PressableNode);

    expect(renderedStrings(tree)).toContain(
      'Поле «Причина отказа» нужно заполнить в веб-клиенте ELMA',
    );
    const submit = tree.root.findAllByProps({testID: 'exit-form-submit'})[0];
    expect(submit.props.disabled).toBe(true);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('ENUM-поле: варианты видны из шаблона, после выбора «Отправить» активна, значение — массив кодов', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Изменить дату визита'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Изменить дату визита',
        formFields: [
          {
            code: 'rescheduling_reason',
            required: true,
            label: 'Причина переноса визита',
            type: 'ENUM',
            enumItems: [
              {code: 'rescheduling_date_by_performer', name: 'Перенос даты исполнителем'},
              {code: 'postponement_of_date_by_client', name: 'Перенос даты клиентом'},
            ],
          },
        ],
      },
    ]);
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Изменить дату визита') as PressableNode);

    expect(tree.root.findAllByProps({testID: 'exit-form'}).length).toBeGreaterThan(0);

    // Варианты пришли из шаблона: строки видны сразу, без сетевого запроса
    const texts = renderedStrings(tree);
    expect(texts).toContain('Причина переноса визита *');
    expect(texts).toContain('Перенос даты исполнителем');
    expect(texts).toContain('Перенос даты клиентом');
    expect(mockedSearchWorkerQuery).not.toHaveBeenCalled();

    // Обязательное ENUM не выбрано — отправка заблокирована
    expect(
      tree.root.findAllByProps({testID: 'exit-form-submit'})[0].props.disabled,
    ).toBe(true);

    await press(
      findButton(tree, 'Перенос даты клиентом') as PressableNode,
    );

    expect(
      tree.root.findAllByProps({testID: 'exit-form-submit'})[0].props.disabled,
    ).toBe(false);

    await press(findButton(tree, 'Отправить') as PressableNode);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    const [, , , exitId, values] = mockedSubmit.mock.calls[0];
    expect(exitId).toBe(EXIT_A);
    // ENUM в контексте объявлен как array — уходит массив из одного кода
    expect(values).toEqual({
      rescheduling_reason: ['postponement_of_date_by_client'],
    });
  });

  it('DATETIME «только время»: открывается сразу time-пикер, значение уходит как 1970-01-01T…', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Выезд согласован'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Выезд согласован',
        formFields: [
          {
            code: 'time_of_visit',
            required: true,
            label: 'Время визита',
            type: 'DATETIME',
            additionalType: 'time',
          },
        ],
      },
    ]);
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Выезд согласован') as PressableNode);

    expect(tree.root.findAllByProps({testID: 'exit-form'}).length).toBeGreaterThan(0);
    expect(renderedStrings(tree)).toContain('Выбрать время');

    await press(findButton(tree, 'Выбрать время') as PressableNode);

    const pickers = tree.root.findAll(n => n.type === 'DateTimePicker');
    expect(pickers).toHaveLength(1);
    // Только время: шага даты нет
    expect(pickers[0].props.mode).toBe('time');

    await act(async () => {
      pickers[0].props.onChange({type: 'set'}, new Date(2026, 0, 5, 19, 30));
    });

    expect(tree.root.findAll(n => n.type === 'DateTimePicker')).toHaveLength(0);

    await press(findButton(tree, 'Отправить') as PressableNode);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    const [, , , exitId, values] = mockedSubmit.mock.calls[0];
    expect(exitId).toBe(EXIT_A);
    expect(values.time_of_visit).toBe(new Date(1970, 0, 1, 19, 30).toISOString());
  });

  it('предзаполнение STRING из instance: значение уже стоит в форме и уходит на submit', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Отказ от выполнения'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Отказ от выполнения',
        formFields: [
          {
            code: 'comment_for_refuse',
            required: true,
            label: 'Комментарий к отказу',
            type: 'STRING',
          },
        ],
      },
    ]);
    mockedFetchTaskById.mockResolvedValue({
      task: {instance: {comment_for_refuse: 'Указано в задаче'}},
    });
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Отказ от выполнения') as PressableNode);

    // instance грузится один раз и только по нажатию выхода с полями
    expect(mockedFetchTaskById).toHaveBeenCalledTimes(1);
    expect(mockedFetchTaskById.mock.calls[0][0]).toBe(account);
    expect(mockedFetchTaskById.mock.calls[0][1]).toBe('task-1');

    const input = tree.root.findAll(
      n => n.props.testID === 'exit-field-comment_for_refuse' &&
        typeof n.props.onChangeText === 'function',
    )[0];
    expect(input.props.value).toBe('Указано в задаче');
    // Обязательное поле уже заполнено — мастер просто подтверждает
    expect(
      tree.root.findAllByProps({testID: 'exit-form-submit'})[0].props.disabled,
    ).toBe(false);

    await press(findButton(tree, 'Отправить') as PressableNode);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    const values = mockedSubmit.mock.calls[0][4];
    expect(values).toEqual({comment_for_refuse: 'Указано в задаче'});
  });

  it('предзаполнение «только время» из instance: показывается локальное время, значение не искажается', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Выезд согласован'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Выезд согласован',
        formFields: [
          {
            code: 'time_of_visit',
            required: true,
            label: 'Время визита',
            type: 'DATETIME',
            additionalType: 'time',
          },
        ],
      },
    ]);
    mockedFetchTaskById.mockResolvedValue({
      task: {instance: {time_of_visit: '1970-01-01T12:00:00.000Z'}},
    });
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Выезд согласован') as PressableNode);

    // Значение из задачи — реальный момент времени, показывается в локальном поясе
    const shownLocal = new Date('1970-01-01T12:00:00.000Z')
      .toLocaleTimeString('ru')
      .slice(0, 5);
    expect(renderedStrings(tree).some(text => text.includes(shownLocal))).toBe(true);
    expect(
      tree.root.findAllByProps({testID: 'exit-form-submit'})[0].props.disabled,
    ).toBe(false);

    await press(findButton(tree, 'Отправить') as PressableNode);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    const values = mockedSubmit.mock.calls[0][4];
    expect(values.time_of_visit).toBe('1970-01-01T12:00:00.000Z');
  });

  it('предзаполнение ENUM из instance: вариант уже выбран и уходит массивом кодов', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Изменить дату визита'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Изменить дату визита',
        formFields: [
          {
            code: 'rescheduling_reason',
            required: true,
            label: 'Причина переноса визита',
            type: 'ENUM',
            enumItems: [
              {code: 'rescheduling_date_by_performer', name: 'Перенос даты исполнителем'},
              {code: 'postponement_of_date_by_client', name: 'Перенос даты клиентом'},
            ],
          },
        ],
      },
    ]);
    mockedFetchTaskById.mockResolvedValue({
      task: {instance: {rescheduling_reason: ['rescheduling_date_by_performer']}},
    });
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Изменить дату визита') as PressableNode);

    const texts = renderedStrings(tree);
    expect(texts).toContain('Перенос даты исполнителем');
    expect(texts).toContain('Перенос даты клиентом');
    // Выбранный вариант подсвечен, без сетевых запросов
    const picked = tree.root.findAll(
      n => n.props.testID === 'exit-option-rescheduling_date_by_performer',
    )[0];
    expect(picked.props.mode).toBe('contained');
    expect(mockedSearchWorkerQuery).not.toHaveBeenCalled();
    expect(
      tree.root.findAllByProps({testID: 'exit-form-submit'})[0].props.disabled,
    ).toBe(false);

    await press(findButton(tree, 'Отправить') as PressableNode);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    const values = mockedSubmit.mock.calls[0][4];
    expect(values).toEqual({rescheduling_reason: ['rescheduling_date_by_performer']});
  });

  it('неудачный fetchTaskById: форма открывается без предзаполнения, запрос не блокирует', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_A, key: 'exit-a', title: 'Отказ от выполнения'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_A,
        name: 'Отказ от выполнения',
        formFields: [
          {
            code: 'comment_for_refuse',
            required: true,
            label: 'Комментарий к отказу',
            type: 'STRING',
          },
        ],
      },
    ]);
    mockedFetchTaskById.mockRejectedValue(new Error('network down'));
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Отказ от выполнения') as PressableNode);

    expect(mockedFetchTaskById).toHaveBeenCalledTimes(1);
    expect(tree.root.findAllByProps({testID: 'exit-form'}).length).toBeGreaterThan(0);

    const input = tree.root.findAll(
      n => n.props.testID === 'exit-field-comment_for_refuse' &&
        typeof n.props.onChangeText === 'function',
    )[0];
    expect(input.props.value).toBe('');
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('выход без обязательных полей отправляется как раньше', async () => {
    mockedExits.mockResolvedValue([
      {id: EXIT_B, key: 'exit-b', title: 'Внесение данных о выполненных работах'},
    ]);
    mockedTemplateExits.mockResolvedValue([
      {
        id: EXIT_B,
        name: 'Внесение данных о выполненных работах',
        formFields: [{code: 'comment', required: false}],
      },
    ]);
    mockedSubmit.mockResolvedValue({ok: true});
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);
    await press(findButton(tree, 'Внесение данных о выполненных работах') as PressableNode);

    expect(mockedTemplateExits).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    // Формы нет — instance для предзаполнения не запрашивается
    expect(mockedFetchTaskById).not.toHaveBeenCalled();
    const [, , , exitId] = mockedSubmit.mock.calls[0];
    expect(exitId).toBe(EXIT_B);
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Нужно заполнить форму',
      expect.anything(),
    );
  });

  it('узел задачи «Исполнение заявок» — экран открывается', async () => {
    useTasksStore.setState({
      tasksByAccount: {
        'acc-1': [
          {
            ...task,
            templateNsAndCode: 'customer_service.applications:execution_of_field_applications',
            path: '/items/2df706a0-c078-4a96-82f3-782c1aa9120d',
          },
        ],
      },
    });
    const onExecution = jest.fn();
    const tree = renderScreen(jest.fn(), onExecution);

    await press(findButton(tree, 'Выполнение работ') as PressableNode);

    expect(onExecution).toHaveBeenCalledTimes(1);
  });

  it('чужой шаблон («Связаться с клиентом») — кнопки «Выполнение работ» нет', async () => {
    useTasksStore.setState({
      tasksByAccount: {
        'acc-1': [
          {
            ...task,
            templateNsAndCode: 'customer_service.applications:preparation_of_exit_applications',
            path: '/items/bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
          },
        ],
      },
    });
    const onExecution = jest.fn();
    const tree = renderScreen(jest.fn(), onExecution);

    expect(findButton(tree, 'Выполнение работ')).toBeUndefined();
    expect(onExecution).not.toHaveBeenCalled();
  });

  it('getexits пуст → кнопки-выходы берутся из шаблона узла (Связаться с клиентом)', async () => {
    useTasksStore.setState({
      tasksByAccount: {
        'acc-1': [
          {
            ...task,
            templateNsAndCode: 'customer_service.applications:preparation_of_exit_applications',
            path: '/items/bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
          },
        ],
      },
    });
    mockedExits.mockResolvedValue([]);
    mockedTemplateExits.mockResolvedValue([
      {id: EXIT_A, name: 'Выезд согласован', formFields: []},
      {id: EXIT_B, name: 'Изменить дату визита', formFields: []},
    ]);
    const tree = renderScreen();

    await press(findButton(tree, 'Действия') as PressableNode);

    expect(findButton(tree, 'Выезд согласован')).toBeTruthy();
    expect(findButton(tree, 'Изменить дату визита')).toBeTruthy();
    expect(renderedStrings(tree)).not.toContain('Нет доступных действий');
  });
});
