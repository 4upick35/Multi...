// ---------------------------------------------------------------------------
// TaskService — доменный сервис задач.
// Инкапсулирует: загрузку, нормализацию, фильтрацию, маппинг статусов/приоритетов.
// Зависит от интерфейсов персистентности (TaskPersistence, AccountPersistence)
// и API-слоя (elma-api) — НЕ от zustand-сторов напрямую.
// ---------------------------------------------------------------------------

import {ElmaTask, ElmaTaskItemRef} from '../types/task';
import {logDiag} from '../diag/accept-log';
import {ElmaAccount} from '../types/account';
import {
  TaskPersistence,
  AccountPersistence,
} from '../interfaces/persistence';
import {maskValue} from '../utils/mask';
import {
  fetchTasks,
  resolveUserNames,
  isPortalTasksAvailable,
} from '../services/elma-api';
import {ElmaRequestError, ElmaRequestKind} from '../types/errors';
import {persistUpdatedAccount} from './account-persistence';

// ---------------------------------------------------------------------------
// #18: Service template exclusion list (from HAR1/HAR2 task filters)
// These are system/internal templates that should be filtered out
// from user-visible task lists.
// ---------------------------------------------------------------------------

/** Service templates to exclude from task lists (HAR1/HAR2 q= filter). */
export const SERVICE_TEMPLATE_PATTERNS: string[] = [
  '_clients._leads:_call',
  '_clients._leads:_meeting',
  '_clients._leads:_webinar',
  '_clients._leads:_letter',
];

/**
 * Check if a task's templateNsAndCode matches a service/internal template.
 * Used to filter out system templates from user-visible task lists.
 */
export function isServiceTemplate(templateNsAndCode: string): boolean {
  if (!templateNsAndCode) {
    return false;
  }
  return SERVICE_TEMPLATE_PATTERNS.some(
    (pattern) => templateNsAndCode === pattern || templateNsAndCode.startsWith(pattern + ':'),
  );
}

/**
 * Извлечь ссылку на элемент клиентского сервиса из поля `__item` задачи.
 * Формат в API ELMA: {namespace, code, id} (порядок ключей не гарантирован).
 */
export function extractItemRef(raw: unknown): ElmaTaskItemRef | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  const code = typeof o.code === 'string' ? o.code : '';
  if (!id || !code) {
    return undefined;
  }
  return {
    namespace: typeof o.namespace === 'string' && o.namespace ? o.namespace : 'customer_service',
    code,
    id,
  };
}

/**
 * Идентификатор узла процесса (nodeId) для задачи.
 * В API ELMA path задачи выглядит как '/items/<nodeId>',
 * а в публичном шаблоне узлы лежат в process.items[<nodeId>] — берём последний сегмент.
 */
export function taskNodeIdFromPath(path: string): string {
  if (!path) {
    return '';
  }
  // Берём последний сегмент как есть: '/items/<uuid>' → '<uuid>',
  // а незавершённый путь '/items/' → '' (пустой последний сегмент).
  const segments = path.split('/');
  return segments[segments.length - 1] || '';
}

/** Узел процесса «Исполнение заявок», под форму которого заточен экран «Выполнение работ». */
export const EXECUTION_NODE_ID = '2df706a0-c078-4a96-82f3-782c1aa9120d';
/** Шаблон задачи «Провести диагностику / работы по заявке». */
export const EXECUTION_TEMPLATE_NS_CODE = 'customer_service.applications:execution_of_field_applications';

/**
 * Доступен ли для задачи экран «Выполнение работ» (проверка офлайн, без запросов).
 * Первичный признак — узел процесса, запасной — шаблон (на случай пересоздания узла).
 */
export function isExecutionScreenSupported(task: {templateNsAndCode?: string; path?: string} | null): boolean {
  if (!task) {
    return false;
  }
  if (taskNodeIdFromPath(task.path || '') === EXECUTION_NODE_ID) {
    return true;
  }
  return (task.templateNsAndCode || '') === EXECUTION_TEMPLATE_NS_CODE;
}

// ---------------------------------------------------------------------------
// Status / priority normalization (чистые функции маппинга)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  assignment: 'Назначена',
  in_progress: 'В работе',
  new: 'Новая',
  completed: 'Завершена',
  closed: 'Завершена',
  canceled: 'Отменена',
  cancelled: 'Отменена',
  suspended: 'Приостановлена',
  rejected: 'Отклонена',
  approved: 'Согласована',
  overdue: 'Просрочена',
};

const STATUS_COLORS: Record<string, string> = {
  assignment: '#FF9800',
  in_progress: '#2196F3',
  new: '#9C27B0',
  completed: '#4CAF50',
  closed: '#4CAF50',
  canceled: '#9E9E9E',
  cancelled: '#9E9E9E',
  suspended: '#FF9800',
  rejected: '#E53935',
  approved: '#4CAF50',
  overdue: '#E53935',
};

/** Терминальные статусы задачи: закрыта/отменена — действия недоступны. */
const CLOSED_STATUSES = ['closed', 'completed', 'canceled', 'cancelled', 'rejected'];

/** Задача уже закрыта (терминальный статус) — кнопки действий показывать нельзя. */
export function isTaskClosed(status: string | null | undefined): boolean {
  return CLOSED_STATUSES.includes(String(status || '').toLowerCase());
}

const PRIORITY_RANGES: Array<{min: number; max: number; label: string; color: string}> = [
  {min: 75, max: 100, label: 'Критический', color: '#E53935'},
  {min: 50, max: 74, label: 'Высокий', color: '#FF9800'},
  {min: 25, max: 49, label: 'Средний', color: '#FFC107'},
  {min: 0, max: 24, label: 'Низкий', color: '#4CAF50'},
];

// ---------------------------------------------------------------------------
// RefreshResult
// ---------------------------------------------------------------------------

export interface RefreshResult {
  ok: boolean;
  error?: string;
  kind?: ElmaRequestKind;
}

// ---------------------------------------------------------------------------
// TaskService
// ---------------------------------------------------------------------------

/**
 * Доменный сервис задач.
 *
 * Инкапсулирует бизнес-логику: загрузку, нормализацию и фильтрацию задач.
 * Использует интерфейсы персистентности (TaskPersistence, AccountPersistence)
 * вместо прямых импортов zustand-сторов — это позволяет тестировать
 * с моками и заменять хранилища.
 *
 * API-вызовы (fetchTasks, resolveUserNames)
 * делегируются в elma-api.ts, который использует HttpTransport.
 */
export class TaskService {
  constructor(
    private taskPersistence: TaskPersistence,
    private accountPersistence: AccountPersistence,
  ) {}

  // -----------------------------------------------------------------------
  // Публичные методы
  // -----------------------------------------------------------------------

  /** Нормализовать одну задачу из ответа GET /api/bpm/tasks/{uuid}. */
  taskFromRaw(raw: Record<string, unknown>, account: ElmaAccount): ElmaTask {
    return this.normalizeRawTask(raw, account, new Map());
  }

  /**
   * Загрузить и нормализовать задачи аккаунта.
   * Порядок operations идентичен оригинальному refreshAccountTasks.
   */
  async refreshAccountTasks(account: ElmaAccount): Promise<RefreshResult> {
    try {
      logDiag(
        'tasks',
        'refreshAccountTasks start acc=' + maskValue(account.id) + ' userId=' + maskValue(account.userId),
      );

      // #27: Проверяем доступность страницы задач перед запросом.
      // Загрузку это НЕ блокирует: веб-версия берёт задачи из customer_service,
      // поэтому портал tasks может быть недоступен — просто пишем в лог.
      const tasksAvailable = await isPortalTasksAvailable(account);
      if (!tasksAvailable) {
        logDiag('tasks', 'portal/tasks disabled for ' + maskValue(account.id) + ' — fetching anyway');
      }

      const result = await fetchTasks(account);
      let rawTasks = result.tasks as Record<string, unknown>[];

      logDiag('tasks', 'acc=' + maskValue(account.id) + ' raw=' + rawTasks.length + ' userId=' + maskValue(account.userId || '') + ' ids=' + rawTasks.slice(0, 3).map(t => String(t.__id || '')).join(','));

      // Клиентская фильтрация: оставляем только задачи, где текущий пользователь
      // является исполнителем (performers) или автором (__createdBy).
      if (account.userId && rawTasks.length > 0) {
        const uid = account.userId;
        const beforeCount = rawTasks.length;
        rawTasks = rawTasks.filter((t) => {
          const performers = t.performers;
          if (Array.isArray(performers) && performers.includes(uid)) {
            return true;
          }
          const createdBy = t.__createdBy;
          if (typeof createdBy === 'string' && createdBy === uid) {
            return true;
          }
          return false;
        });
        if (rawTasks.length !== beforeCount) {
          logDiag('tasks', 'acc=' + maskValue(account.id) + ' afterClientFilter=' + rawTasks.length + ' before=' + beforeCount);
        }
      }

      // #18: Исключить служебные шаблоны (_clients._leads:_call и др.)
      {
        const beforeServiceFilter = rawTasks.length;
        rawTasks = rawTasks.filter((t) => {
          const template = String(t.templateNsAndCode || '');
          return !isServiceTemplate(template);
        });
        if (rawTasks.length !== beforeServiceFilter) {
          logDiag('tasks', 'acc=' + maskValue(account.id) + ' afterTemplateFilter=' + rawTasks.length + ' before=' + beforeServiceFilter);
        }
      }

      // Собрать уникальные GUID пользователей из __createdBy и performers
      const userIds = new Set<string>();
      for (const t of rawTasks) {
        const createdBy = t.__createdBy;
        if (typeof createdBy === 'string' && createdBy) {
          userIds.add(createdBy);
        }
        if (Array.isArray(t.performers)) {
          for (const p of t.performers) {
            if (typeof p === 'string' && p) {
              userIds.add(p);
            }
          }
        }
        // Также поддерживаем объектный формат performers: {name: string}
        if (
          t.performers &&
          typeof t.performers === 'object' &&
          !Array.isArray(t.performers) &&
          'name' in (t.performers as Record<string, unknown>)
        ) {
          // Объектный performers — нет GUID для резолва, имя берём из поля
        }
      }

      // Разрешить GUID → читаемые имена
      const nameMap = await resolveUserNames(account, [...userIds]);

      const tasks: ElmaTask[] = rawTasks.map((t) =>
        this.normalizeRawTask(t, account, nameMap),
      );

      // Сохранить задачи и пометить успешную синхронизацию
      this.taskPersistence.setTasks(account.id, tasks);
      this.taskPersistence.markSyncSuccess(account.id);

      // Persist новый токен, если был обновлён транспортом
      persistUpdatedAccount(this.accountPersistence, account.id, result.updatedAccount);

      return {ok: true};
    } catch (e: unknown) {
      if (e instanceof ElmaRequestError) {
        this.taskPersistence.markSyncError(account.id, e.kind, e.message);
        return {ok: false, error: e.message, kind: e.kind};
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.taskPersistence.markSyncError(account.id, 'other', msg);
      return {ok: false, error: msg, kind: 'other'};
    }
  }

  // -----------------------------------------------------------------------
  // Статусы / приоритеты (чистые функции маппинга)
  // -----------------------------------------------------------------------

  getStatusLabel(status: string): string {
    return STATUS_LABELS[status] || status;
  }

  getStatusColor(status: string): string {
    return STATUS_COLORS[status] || '#9E9E9E';
  }

  getPriorityLabel(priority: string | number): string {
    const num = typeof priority === 'number' ? priority : parseInt(priority, 10);
    if (isNaN(num)) {
      return String(priority);
    }
    for (const r of PRIORITY_RANGES) {
      if (num >= r.min && num <= r.max) {
        return r.label;
      }
    }
    return String(num);
  }

  getPriorityColor(priority: string | number): string {
    const num = typeof priority === 'number' ? priority : parseInt(priority, 10);
    if (isNaN(num)) {
      return '#9E9E9E';
    }
    for (const r of PRIORITY_RANGES) {
      if (num >= r.min && num <= r.max) {
        return r.color;
      }
    }
    return '#9E9E9E';
  }

  // -----------------------------------------------------------------------
  // Приватные методы
  // -----------------------------------------------------------------------

  /**
   * Нормализовать сырой объект задачи ELMA в доменную модель ElmaTask.
   * Порядок извлечения полей идентичен оригиналу из task-service.ts.
   */
  private normalizeRawTask(
    t: Record<string, unknown>,
    account: ElmaAccount,
    nameMap: Map<string, string>,
  ): ElmaTask {
    // Resolve author name from GUID
    const createdByRaw = t.__createdBy;
    const authorGuid =
      typeof createdByRaw === 'string' ? createdByRaw : '';
    const authorName = authorGuid ? (nameMap.get(authorGuid) || authorGuid) : '';

    // Resolve performer names from GUIDs
    const performersRaw = t.performers;
    let performerName = '';
    if (Array.isArray(performersRaw)) {
      performerName = performersRaw
        .map((p) => {
          if (typeof p === 'string') {
            return nameMap.get(p) || p;
          }
          if (p && typeof p === 'object' && 'name' in p) {
            return String((p as Record<string, unknown>).name);
          }
          return String(p);
        })
        .join(', ');
    } else if (
      performersRaw &&
      typeof performersRaw === 'object' &&
      'name' in (performersRaw as Record<string, unknown>)
    ) {
      performerName = String(
        (performersRaw as Record<string, unknown>).name,
      );
    }

    const priorityRaw =
      ((t.priority as Record<string, unknown>)?.name as string) ||
      (t.priority as string) ||
      '';

    return {
      id: (t.__id as string) || (t.id as string) || '',
      accountId: account.id,
      baseUrl: account.baseUrl,
      name: (t.__name as string) || (t.name as string) || '',
      subject:
        (t.__name as string) ||
        (t.name as string) ||
        (t.subject as string) ||
        '',
      status:
        ((t.state as Record<string, unknown>)?.name as string) ||
        (t.state as string) ||
        ((t.__status as Record<string, unknown>)?.name as string) ||
        '',
      rawState:
        ((t.state as Record<string, unknown>)?.name as string) ||
        (t.state as string) ||
        '',
      priority: priorityRaw,
      priorityLabel: this.getPriorityLabel(priorityRaw),
      priorityColor: this.getPriorityColor(priorityRaw),
      createdAt: (t.__createdAt as string) || '',
      dueDate: (t.dueDate as string) || (t.end_date as string),
      performerName,
      authorName,
      description:
        (t.description as string) ||
        ((t.__item as Record<string, unknown>)?.description as string) ||
        '',
      isOverdue: t.dueDate
        ? new Date(t.dueDate as string) < new Date()
        : false,
      instanceId:
        ((t.instance as Record<string, unknown>)?.__id as string) ||
        ((t.instance as Record<string, unknown>)?.id as string) ||
        (t.instanceId as string) ||
        '',
      taskId: (t.__id as string) || (t.id as string) || '',
      itemRef: extractItemRef(t.__item),
      templateNsAndCode: String(t.templateNsAndCode || ''),
      path: String(t.path || ''),
    };
  }
}
