jest.mock('../../src/services/elma-api', () => ({
  fetchTasks: jest.fn(),
  resolveUserNames: jest.fn(),
  isPortalTasksAvailable: jest.fn(),
  isServiceTemplate: jest.fn(),
}));

import {TaskService, isServiceTemplate, isExecutionScreenSupported} from '../../src/domain/TaskService';
import {
  fetchTasks,
  resolveUserNames,
  isPortalTasksAvailable,
} from '../../src/services/elma-api';
import {ElmaRequestError} from '../../src/types/errors';
import type {TaskPersistence, AccountPersistence} from '../../src/interfaces/persistence';
import type {ElmaAccount} from '../../src/types/account';

const mockedFetchTasks = fetchTasks as jest.MockedFunction<typeof fetchTasks>;
const mockedResolveUserNames = resolveUserNames as jest.MockedFunction<typeof resolveUserNames>;
const mockedIsPortalTasksAvailable = isPortalTasksAvailable as jest.MockedFunction<typeof isPortalTasksAvailable>;

// Фабрика мока аккаунта
function makeAccount(overrides: Partial<ElmaAccount> = {}): ElmaAccount {
  return {
    id: 'acc-1',
    name: 'Test Account',
    baseUrl: 'https://test.elma.ru',
    portal: 'portal',
    token: 'token-123',
    userId: 'user-guid-1',
    color: '#6200EE',
    isActive: true,
    ...overrides,
  };
}

// Фабрика мока персистентности задач
function makeTaskPersistence(): TaskPersistence {
  return {
    setTasks: jest.fn(),
    addOrUpdateTask: jest.fn(),
    markSyncSuccess: jest.fn(),
    markSyncError: jest.fn(),
  };
}

// Фабрика мока персистентности аккаунтов
function makeAccountPersistence(): AccountPersistence {
  return {
    updateAccount: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// isServiceTemplate
// ---------------------------------------------------------------------------
describe('isServiceTemplate', () => {
  it('возвращает true для сервисных шаблонов', () => {
    expect(isServiceTemplate('_clients._leads:_call')).toBe(true);
    expect(isServiceTemplate('_clients._leads:_meeting')).toBe(true);
    expect(isServiceTemplate('_clients._leads:_webinar')).toBe(true);
    expect(isServiceTemplate('_clients._leads:_letter')).toBe(true);
  });

  it('возвращает true для шаблонов с суффиксом', () => {
    expect(isServiceTemplate('_clients._leads:_call:something')).toBe(true);
  });

  it('возвращает false для обычных шаблонов', () => {
    expect(isServiceTemplate('normal_task')).toBe(false);
    expect(isServiceTemplate('_clients._leads:call')).toBe(false);
  });

  it('возвращает false для пустой строки', () => {
    expect(isServiceTemplate('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isExecutionScreenSupported
// ---------------------------------------------------------------------------
describe('isExecutionScreenSupported', () => {
  it('узел 2df706a0 → true', () => {
    expect(
      isExecutionScreenSupported({
        templateNsAndCode: 'customer_service:whatever',
        path: '/items/2df706a0-c078-4a96-82f3-782c1aa9120d',
      }),
    ).toBe(true);
  });

  it('шаблон execution_of_field_applications без узла → true', () => {
    expect(
      isExecutionScreenSupported({
        templateNsAndCode: 'customer_service.applications:execution_of_field_applications',
        path: '',
      }),
    ).toBe(true);
    expect(
      isExecutionScreenSupported({
        templateNsAndCode: 'customer_service.applications:execution_of_field_applications',
        path: '/items/7f1c0d2e-9a4b-4c31-8d5e-2b6a4f9c1e77',
      }),
    ).toBe(true);
  });

  it('чужой узел bfccc1f7 и шаблон preparation_of_exit_applications → false', () => {
    expect(
      isExecutionScreenSupported({
        templateNsAndCode: 'customer_service.applications:preparation_of_exit_applications',
        path: '/items/bfccc1f7-3994-46fc-8c4f-020eb6f0f434',
      }),
    ).toBe(false);
  });

  it('null и пустой объект → false', () => {
    expect(isExecutionScreenSupported(null)).toBe(false);
    expect(isExecutionScreenSupported({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TaskService — нормализация статусов/приоритетов
// ---------------------------------------------------------------------------
describe('TaskService — нормализация статусов и приоритетов', () => {
  let service: TaskService;
  const tp = makeTaskPersistence();
  const ap = makeAccountPersistence();

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TaskService(tp, ap);
  });

  describe('getStatusLabel', () => {
    it('маппит известные статусы', () => {
      expect(service.getStatusLabel('assignment')).toBe('Назначена');
      expect(service.getStatusLabel('in_progress')).toBe('В работе');
      expect(service.getStatusLabel('new')).toBe('Новая');
      expect(service.getStatusLabel('completed')).toBe('Завершена');
      expect(service.getStatusLabel('closed')).toBe('Завершена');
      expect(service.getStatusLabel('canceled')).toBe('Отменена');
      expect(service.getStatusLabel('cancelled')).toBe('Отменена');
      expect(service.getStatusLabel('suspended')).toBe('Приостановлена');
      expect(service.getStatusLabel('rejected')).toBe('Отклонена');
      expect(service.getStatusLabel('approved')).toBe('Согласована');
      expect(service.getStatusLabel('overdue')).toBe('Просрочена');
    });

    it('возвращает исходное значение для неизвестного статуса', () => {
      expect(service.getStatusLabel('unknown')).toBe('unknown');
    });
  });

  describe('getStatusLabel → getStatusColor', () => {
    it('маппит цвета для статусов', () => {
      expect(service.getStatusColor('assignment')).toBe('#FF9800');
      expect(service.getStatusColor('in_progress')).toBe('#2196F3');
      expect(service.getStatusColor('new')).toBe('#9C27B0');
      expect(service.getStatusColor('completed')).toBe('#4CAF50');
      expect(service.getStatusColor('rejected')).toBe('#E53935');
    });

    it('серый для неизвестного статуса', () => {
      expect(service.getStatusColor('xyz')).toBe('#9E9E9E');
    });
  });

  describe('getPriorityLabel', () => {
    it('числовой приоритет в диапазоне 75-100 → Критический', () => {
      expect(service.getPriorityLabel(80)).toBe('Критический');
    });

    it('числовой приоритет 50-74 → Высокий', () => {
      expect(service.getPriorityLabel(60)).toBe('Высокий');
    });

    it('числовой приоритет 25-49 → Средний', () => {
      expect(service.getPriorityLabel(35)).toBe('Средний');
    });

    it('числовой приоритет 0-24 → Низкий', () => {
      expect(service.getPriorityLabel(10)).toBe('Низкий');
    });

    it('строковый приоритет парсится в число', () => {
      expect(service.getPriorityLabel('80')).toBe('Критический');
    });

    it('нечисловой приоритет возвращается как есть', () => {
      expect(service.getPriorityLabel('urgent')).toBe('urgent');
    });
  });

  describe('getPriorityColor', () => {
    it('цвет для критического приоритета', () => {
      expect(service.getPriorityColor(90)).toBe('#E53935');
    });

    it('цвет для высокого приоритета', () => {
      expect(service.getPriorityColor(60)).toBe('#FF9800');
    });

    it('цвет для среднего приоритета', () => {
      expect(service.getPriorityColor(30)).toBe('#FFC107');
    });

    it('цвет для низкого приоритета', () => {
      expect(service.getPriorityColor(5)).toBe('#4CAF50');
    });

    it('серый для нечислового приоритета', () => {
      expect(service.getPriorityColor('abc')).toBe('#9E9E9E');
    });
  });
});

// ---------------------------------------------------------------------------
// TaskService — refreshAccountTasks
// ---------------------------------------------------------------------------
describe('TaskService — refreshAccountTasks', () => {
  let tp: TaskPersistence;
  let ap: AccountPersistence;
  let service: TaskService;

  beforeEach(() => {
    jest.clearAllMocks();
    tp = makeTaskPersistence();
    ap = makeAccountPersistence();
    service = new TaskService(tp, ap);
  });

  it('когда isPortalTasksAvailable = false → задачи всё равно загружаются через fetchTasks', async () => {
    const account = makeAccount();
    mockedIsPortalTasksAvailable.mockResolvedValue(false);
    mockedFetchTasks.mockResolvedValue({
      tasks: [
        {
          __id: 'task-1',
          __name: 'Задача 1',
          state: 'in_progress',
          performers: ['user-guid-1'],
        },
      ],
    });
    mockedResolveUserNames.mockResolvedValue(new Map());

    const result = await service.refreshAccountTasks(account);

    expect(result).toEqual({ok: true});
    expect(mockedFetchTasks).toHaveBeenCalledWith(account);
    expect(tp.markSyncSuccess).toHaveBeenCalledWith('acc-1');
    const saved = (tp.setTasks as jest.Mock).mock.calls[0][1];
    expect(saved).toHaveLength(1);
  });

  it('успешная загрузка задач с нормализацией', async () => {
    const account = makeAccount({userId: 'user-1'});
    mockedIsPortalTasksAvailable.mockResolvedValue(true);
    mockedFetchTasks.mockResolvedValue({
      tasks: [
        {
          __id: 'task-1',
          __name: 'Задача 1',
          state: {name: 'in_progress'},
          priority: {name: '50'},
          __createdBy: 'user-1',
          performers: ['user-2'],
          __createdAt: '2025-01-01',
          dueDate: '2026-12-31',
          description: 'Описание',
          templateNsAndCode: 'normal_template',
        },
      ],
    });
    mockedResolveUserNames.mockResolvedValue(
      new Map([['user-1', 'Имя'], ['user-2', 'Пользователь']]),
    );

    const result = await service.refreshAccountTasks(account);

    expect(result.ok).toBe(true);
    expect(tp.setTasks).toHaveBeenCalled();
    expect(tp.markSyncSuccess).toHaveBeenCalledWith('acc-1');

    const tasks = (tp.setTasks as jest.Mock).mock.calls[0][1];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-1');
    expect(tasks[0].status).toBe('in_progress');
    expect(tasks[0].priorityLabel).toBe('Высокий');
    expect(tasks[0].performerName).toBe('Пользователь');
    expect(tasks[0].authorName).toBe('Имя');
  });

  it('клиентская фильтрация: оставляет только задачи текущего пользователя', async () => {
    const account = makeAccount({userId: 'user-1'});
    mockedIsPortalTasksAvailable.mockResolvedValue(true);
    mockedFetchTasks.mockResolvedValue({
      tasks: [
        {
          __id: 'task-mine',
          __name: 'Моя задача',
          state: 'new',
          performers: ['user-1'],
          templateNsAndCode: 'normal',
        },
        {
          __id: 'task-other',
          __name: 'Чужая задача',
          state: 'new',
          performers: ['user-999'],
          templateNsAndCode: 'normal',
        },
        {
          __id: 'task-authored',
          __name: 'Я автор',
          state: 'new',
          __createdBy: 'user-1',
          performers: ['user-999'],
          templateNsAndCode: 'normal',
        },
      ],
    });
    mockedResolveUserNames.mockResolvedValue(new Map());

    await service.refreshAccountTasks(account);

    const tasks = (tp.setTasks as jest.Mock).mock.calls[0][1];
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t: {id: string}) => t.id)).toContain('task-mine');
    expect(tasks.map((t: {id: string}) => t.id)).toContain('task-authored');
  });

  it('исключение служебных шаблонов', async () => {
    const account = makeAccount({userId: 'user-1'});
    mockedIsPortalTasksAvailable.mockResolvedValue(true);
    mockedFetchTasks.mockResolvedValue({
      tasks: [
        {
          __id: 'task-normal',
          __name: 'Обычная',
          state: 'new',
          performers: ['user-1'],
          templateNsAndCode: 'normal',
        },
        {
          __id: 'task-service',
          __name: 'Служебный звонок',
          state: 'new',
          performers: ['user-1'],
          templateNsAndCode: '_clients._leads:_call',
        },
      ],
    });
    mockedResolveUserNames.mockResolvedValue(new Map());

    await service.refreshAccountTasks(account);

    const tasks = (tp.setTasks as jest.Mock).mock.calls[0][1];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('task-normal');
  });

  it('обрабатывает ошибку ElmaRequestError → markSyncError', async () => {
    const account = makeAccount();
    mockedIsPortalTasksAvailable.mockRejectedValue(
      new ElmaRequestError('network', 'Сеть недоступна'),
    );

    const result = await service.refreshAccountTasks(account);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Сеть недоступна');
    expect(result.kind).toBe('network');
    expect(tp.markSyncError).toHaveBeenCalledWith('acc-1', 'network', 'Сеть недоступна');
  });

  it('обрабатывает обычную ошибку → markSyncError с kind=other', async () => {
    const account = makeAccount();
    mockedIsPortalTasksAvailable.mockRejectedValue(new Error('Unexpected'));

    const result = await service.refreshAccountTasks(account);

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('other');
    expect(tp.markSyncError).toHaveBeenCalledWith('acc-1', 'other', 'Unexpected');
  });

  it('сохраняет обновлённый токен если updatedAccount в ответе', async () => {
    const account = makeAccount();
    mockedIsPortalTasksAvailable.mockResolvedValue(true);
    mockedFetchTasks.mockResolvedValue({
      tasks: [],
      updatedAccount: {token: 'new-token'},
    });
    mockedResolveUserNames.mockResolvedValue(new Map());

    await service.refreshAccountTasks(account);

    expect(ap.updateAccount).toHaveBeenCalledWith('acc-1', {token: 'new-token'});
  });
});
