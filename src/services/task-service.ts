// ---------------------------------------------------------------------------
// task-service.ts — обёртка-делегат над domain/TaskService.
// Сохраняет ВСЕ оригинальные экспорты для обратной совместимости.
// ---------------------------------------------------------------------------

import {ElmaTask} from '../types/task';
import {ElmaAccount} from '../types/account';
import {ElmaRequestKind} from '../types/errors';
import {taskService} from '../di/container';
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

export function taskFromRaw(
  raw: Record<string, unknown>,
  account: ElmaAccount,
): ElmaTask {
  return taskService.taskFromRaw(raw, account);
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
