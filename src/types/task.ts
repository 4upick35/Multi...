export interface ElmaTask {
  id: string;
  accountId: string;
  baseUrl?: string;
  name: string;
  subject: string;
  status: string;
  rawState?: string;
  priority: string;
  priorityLabel?: string;
  priorityColor?: string;
  createdAt: string;
  dueDate?: string;
  performerName?: string;
  authorName?: string;
  description?: string;
  isOverdue: boolean;
  instanceId?: string;
  taskId?: string;
  /** Ссылка на элемент клиентского сервиса, к которому относится задача (поле __item). */
  itemRef?: ElmaTaskItemRef;
  templateNsAndCode?: string;
  path?: string;
}

/** Ссылка на элемент приложения ELMA: {namespace, code, id}. */
export interface ElmaTaskItemRef {
  namespace: string;
  code: string;
  id: string;
}

export type TaskFilter = 'all' | 'active' | 'overdue' | 'completed';
