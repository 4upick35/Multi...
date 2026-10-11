import {ElmaAccount} from '../types/account';
import {AccountPersistence} from '../interfaces/persistence';

/** Сохранить обновлённые токен/cookies аккаунта через порт AccountPersistence. */
export function persistUpdatedAccount(
  persistence: AccountPersistence,
  accountId: string,
  update?: Partial<ElmaAccount>,
): void {
  if (!update) {
    return;
  }
  if (update.token) {
    persistence.updateAccount(accountId, {token: update.token});
  }
  if (update.cookies) {
    persistence.updateAccount(accountId, {cookies: update.cookies});
  }
}
