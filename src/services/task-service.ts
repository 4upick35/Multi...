// ---------------------------------------------------------------------------
// task-service.ts — обёртка-делегат над domain/TaskService.
// Сохраняет ВСЕ оригинальные экспорты для обратной совместимости.
// ---------------------------------------------------------------------------

import {ElmaTask} from '../types/task';
import {ElmaAccount} from '../types/account';
import {ElmaRequestKind} from '../types/errors';
import {useTasksStore} from '../store/tasks-store';
import {useAuthStore} from '../store/auth-store';
import {TaskService} from '../domain/TaskService';

// ---------------------------------------------------------------------------
// Адаптеры персистентности: подключаем zustand-сторы к доменному сервису
// ---------------------------------------------------------------------------

const taskPersistence = {
  setTasks: (accountId: string, tasks: ElmaTask[]) =>
    useTasksStore.getState().setTasks(accountId, tasks),
  addOrUpdateTask: (accountId: string, task: ElmaTask) =>
    useTasksStore.getState().addOrUpdateTask(accountId, task),
  markSyncSuccess: (accountId: string) =>
    useTasksStore.getState().markSyncSuccess(accountId),
  markSyncError: (accountId: string, kind: ElmaRequestKind, msg: string) =>
    useTasksStore.getState().markSyncError(accountId, kind, msg),
};

const accountPersistence = {
  updateAccount: (accountId: string, data: Partial<ElmaAccount>) =>
    useAuthStore.getState().updateAccount(accountId, data),
};

// ---------------------------------------------------------------------------
// Singleton-экземпляр доменного сервиса
// ---------------------------------------------------------------------------

const taskService = new TaskService(taskPersistence, accountPersistence);

// ---------------------------------------------------------------------------
// Re-export типов (обратная совместимость)
// ---------------------------------------------------------------------------

export interface RefreshResult {
  ok: boolean;
  error?: string;
  kind?: ElmaRequestKind;
}

/**
 * Загрузить и нормализовать задачи аккаунта.
 * Делегирует в TaskService.refreshAccountTasks.
 */
export async function refreshAccountTasks(
  account: ElmaAccount,
): Promise<RefreshResult> {
  return taskService.refreshAccountTasks(account);
}

// ---------------------------------------------------------------------------
// Статусы / приоритеты — делегирование в domain/TaskService (DRY)
// ---------------------------------------------------------------------------

export function getStatusLabel(status: string): string {
  return taskService.getStatusLabel(status);
}

export function getStatusColor(status: string): string {
  return taskService.getStatusColor(status);
}

export function getPriorityLabel(priority: string | number): string {
  return taskService.getPriorityLabel(priority);
}

export function getPriorityColor(priority: string | number): string {
  return taskService.getPriorityColor(priority);
}
