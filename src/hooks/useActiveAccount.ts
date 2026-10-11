// ---------------------------------------------------------------------------
// Хук для единообразного разрешения «текущего аккаунта» в экранах.
// Заменяет повторяющийся паттерн (8 экранов):
//   const accounts = useAuthStore(s => s.accounts);
//   const activeAccountId = useUiStore(s => s.activeAccountId);
//   const resolvedAccountId = activeAccountId || accounts[0]?.id;
//   const activeAccount = accounts.find(a => a.id === resolvedAccountId);
// ---------------------------------------------------------------------------

import {useMemo} from 'react';
import {useAuthStore} from '../store/auth-store';
import {useUiStore} from '../store/ui-store';
import {ElmaAccount} from '../types/account';
import {resolveActiveAccountId} from '../utils/resolve-active-account';

interface UseActiveAccountResult {
  /** Текущий аккаунт (undefined, если аккаунтов нет) */
  account: ElmaAccount | undefined;
  /** ID текущего аккаунта (null, если аккаунтов нет) */
  accountId: string | null;
  /** Все аккаунты */
  accounts: ElmaAccount[];
}

/**
 * Возвращает текущий активный аккаунт.
 * Приоритет: activeAccountId из ui-store → первый аккаунт из auth-store.
 */
export function useActiveAccount(): UseActiveAccountResult {
  const accounts = useAuthStore(s => s.accounts);
  const activeAccountId = useUiStore(s => s.activeAccountId);

  // Мемоизируем массив accounts, чтобы ссылка была стабильной между рендерами.
  const memoizedAccounts = useMemo(() => [...accounts], [accounts]);

  const resolvedAccountId = resolveActiveAccountId(memoizedAccounts, activeAccountId);
  const account = useMemo(() => memoizedAccounts.find((a) => a.id === resolvedAccountId), [memoizedAccounts, resolvedAccountId]);

  return {
    account,
    accountId: resolvedAccountId,
    accounts: memoizedAccounts,
  };
}
