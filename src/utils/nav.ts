/** Допустимые цели перехода из внешнего deep-link/уведомления. */
export const ALLOWED_NAV_TARGETS: string[] = ['applications', 'tasks'];

/** Проверка, что цель перехода разрешена. */
export function isAllowedNavTarget(target: unknown): boolean {
  return typeof target === 'string' && ALLOWED_NAV_TARGETS.includes(target);
}

/**
 * Нормализация accountId из внешнего источника: допускаем только
 * идентификатор одного из известных локальных аккаунтов.
 */
export function sanitizeNavAccountId(accountId: unknown, knownIds: string[]): string | null {
  if (typeof accountId !== 'string') {
    return null;
  }
  const value = accountId.trim();
  if (!value || value.length > 64) {
    return null;
  }
  return knownIds.includes(value) ? value : null;
}
