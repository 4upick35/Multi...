import {ElmaAccount} from '../types/account';

/**
 * Разрешить ID активного аккаунта.
 *
 * Приоритет:
 *  1. activeAccountId, если он присутствует в списке accounts
 *  2. Первый аккаунт из списка
 *  3. null, если.accounts пуст
 */
export function resolveActiveAccountId(
  accounts: ElmaAccount[],
  activeAccountId: string | null,
): string | null {
  if (activeAccountId != null && accounts.some((a) => a.id === activeAccountId)) {
    return activeAccountId;
  }
  return accounts.length > 0 ? accounts[0].id : null;
}
