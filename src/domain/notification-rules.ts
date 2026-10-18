/** Тип локального уведомления по содержанию title/body portal-сообщения. */
export type NotificationKind = 'task-new' | 'application-new' | 'status' | 'other';

/**
 * Классифицировать feed-уведомление по нормализованному тексту (title + body,
 * нижний регистр): новые задачи / новые заявки / смена статуса / прочее.
 */
export function classifyNotification(title: string, body: string): NotificationKind {
  const text = `${title} ${body}`.toLowerCase();
  if (text.includes('задач')) {
    if (
      text.includes('поставлена') ||
      text.includes('назначена') ||
      text.includes('создана') ||
      text.includes('новая задача') ||
      text.includes('вам назначена')
    ) {
      return 'task-new';
    }
    return 'status';
  }
  if (text.includes('заявк')) {
    if (
      text.includes('новая заявка') ||
      text.includes('появилась') ||
      text.includes('создана заявка') ||
      text.includes('поступила')
    ) {
      return 'application-new';
    }
    return 'status';
  }
  return 'other';
}
