import {create} from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ElmaAccount} from '../types/account';
import {STORAGE_KEYS} from '../config/constants';
import {useTasksStore} from './tasks-store';
import {useFeedStore} from './feed-store';
import {useCustomerServiceStore} from './customer-service-store';
import {useUiStore} from './ui-store';
import {AccountRegistry} from '../infrastructure/AccountRegistry';
import {
  saveAccountSecrets,
  loadAccountSecrets,
  deleteAccountSecrets,
} from '../infrastructure/SecretStore';
import {clearAcceptTemplatesForAccount} from '../services/accept-template-cache';
import {clearSeenApplicationAlertsForAccount} from '../services/seen-application-alerts';
import {cacheClearAccount} from '../infrastructure/elma-cache';
import {stopRealtime} from '../services/realtime';

// ---------------------------------------------------------------------------
// Singleton-реестр аккаунтов ( используется SessionManager-ом и сервисами )
// ---------------------------------------------------------------------------
export const accountRegistry = new AccountRegistry();

// ---------------------------------------------------------------------------
// Интерфейс стора (публичный API — БЕЗ ИЗМЕНЕНИЙ)
// ---------------------------------------------------------------------------

interface AuthState {
  accounts: ElmaAccount[];
  addAccount: (account: ElmaAccount) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  updateAccount: (id: string, data: Partial<ElmaAccount>) => Promise<void>;
  reorderAccounts: (orderedIds: string[]) => Promise<void>;
  loadAccounts: () => Promise<void>;
  getAccount: (id: string) => ElmaAccount | undefined;
}

// ---------------------------------------------------------------------------
// Персистентность: секреты (token/cookies) уходят в SecretStore,
// в AsyncStorage остаётся копия аккаунта БЕЗ этих полей.
// ---------------------------------------------------------------------------

/** Формат аккаунта в AsyncStorage: поля token/cookies опциональны (фолбэк). */
type PersistedAccount = Omit<ElmaAccount, 'token'> & {token?: string};

/** Копия аккаунта без выбранных секретных полей (для записи в AsyncStorage). */
function persistableCopy(
  account: ElmaAccount,
  stripToken: boolean,
  stripCookies: boolean,
): PersistedAccount {
  const copy: PersistedAccount = {...account};
  if (stripToken) {
    delete copy.token;
  }
  if (stripCookies) {
    delete copy.cookies;
  }
  return copy;
}

/**
 * Сохраняет аккаунты в AsyncStorage, предварительно выгружая секреты в SecretStore.
 * Фолбэк: если секреты сохранить не удалось — аккаунт пишется со старыми
 * полями token/cookies, чтобы не терять вход.
 */
async function persistAccounts(accounts: ElmaAccount[]): Promise<void> {
  const persisted: PersistedAccount[] = await Promise.all(
    accounts.map(async (account) => {
      if (typeof account.token !== 'string') {
        return persistableCopy(account, true, true);
      }
      const saved = await saveAccountSecrets(
        account.id,
        account.token,
        account.cookies,
      );
      if (!saved) {
        return persistableCopy(account, false, false);
      }
      return persistableCopy(account, true, true);
    }),
  );
  await AsyncStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(persisted));
}

/**
 * Восстанавливает секреты аккаунта при загрузке.
 *
 * а) секреты есть в SecretStore — подставляются в аккаунт;
 * б) секретов нет, но в JSON есть token/cookies — миграция в SecretStore
 *    с обязательной проверкой чтением; только после успешной проверки
 *    поля считаются выгруженными (иначе остаётся старая схема).
 *
 * Поля вырезаются из хранилища только если их значение подтверждено чтением —
 * при расхождении открытая копия остаётся на месте (не теряем данные).
 */
async function restoreAccountSecrets(
  account: ElmaAccount,
): Promise<{account: ElmaAccount; persisted: PersistedAccount}> {
  let secrets = await loadAccountSecrets(account.id);
  const jsonToken = typeof account.token === 'string' ? account.token : undefined;

  if (!secrets || secrets.token === undefined) {
    if (jsonToken !== undefined) {
      const saved = await saveAccountSecrets(
        account.id,
        jsonToken,
        account.cookies,
      );
      if (saved) {
        const verified = await loadAccountSecrets(account.id);
        if (
          verified &&
          verified.token === jsonToken &&
          (account.cookies === undefined ||
            verified.cookies === account.cookies)
        ) {
          secrets = verified;
        }
      }
    }
  }

  const restored: ElmaAccount = {...account};
  if (secrets && secrets.token !== undefined) {
    restored.token = secrets.token;
  }
  if (secrets && secrets.cookies !== undefined) {
    restored.cookies = secrets.cookies;
  }

  const stripToken =
    secrets !== null &&
    secrets.token !== undefined &&
    (jsonToken === undefined || secrets.token === jsonToken);
  const stripCookies =
    secrets !== null &&
    (account.cookies === undefined || secrets.cookies === account.cookies);

  return {
    account: restored,
    persisted: persistableCopy(account, stripToken, stripCookies),
  };
}

// ---------------------------------------------------------------------------
// Best-effort: очистка кэшей аккаунта не должна ломать удаление аккаунта
// ---------------------------------------------------------------------------

async function bestEffort(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch {
    // Тихо
  }
}

// ---------------------------------------------------------------------------
// Zustand store: делегирует CRUD AccountRegistry, хранит зеркало в RAM
// ---------------------------------------------------------------------------

export const useAuthStore = create<AuthState>((set) => ({
  accounts: [],

  addAccount: async (account: ElmaAccount) => {
    accountRegistry.add(account);
    const accounts = accountRegistry.getAll();
    set({accounts});
    await persistAccounts(accounts);
  },

  removeAccount: async (id: string) => {
    stopRealtime(id);
    accountRegistry.remove(id);
    const accounts = accountRegistry.getAll();
    set({accounts});
    useTasksStore.getState().removeAccountTasks(id);
    useFeedStore.getState().clearAccount(id);
    useCustomerServiceStore.getState().clearAccount(id);
    if (useUiStore.getState().activeAccountId === id) {
      useUiStore.getState().setActiveAccountId(null);
    }
    await bestEffort(() => clearAcceptTemplatesForAccount(id));
    await bestEffort(() => clearSeenApplicationAlertsForAccount(id));
    await bestEffort(() => cacheClearAccount(id));
    await persistAccounts(accounts);
    await deleteAccountSecrets(id);
  },

  updateAccount: async (id: string, data: Partial<ElmaAccount>) => {
    accountRegistry.update(id, data);
    const accounts = accountRegistry.getAll();
    set({accounts});
    await persistAccounts(accounts);
  },

  reorderAccounts: async (orderedIds: string[]) => {
    accountRegistry.reorder(orderedIds);
    const accounts = accountRegistry.getAll();
    set({accounts});
    await persistAccounts(accounts);
  },

  loadAccounts: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.accounts);
      if (raw) {
        const parsed: ElmaAccount[] = JSON.parse(raw);
        // Удаляем учётки магазинов (userKind === 'default') — они больше не поддерживаются
        const filtered = parsed.filter((a) => a.userKind !== 'default');
        const removedDefaults = filtered.length !== parsed.length;

        const restored: ElmaAccount[] = [];
        const persisted: PersistedAccount[] = [];
        for (const account of filtered) {
          const result = await restoreAccountSecrets(account);
          restored.push(result.account);
          persisted.push(result.persisted);
        }

        const persistedJson = JSON.stringify(persisted);
        if (removedDefaults || persistedJson !== JSON.stringify(filtered)) {
          await AsyncStorage.setItem(STORAGE_KEYS.accounts, persistedJson);
        }

        accountRegistry.loadAll(restored);
        set({accounts: accountRegistry.getAll()});
      }
    } catch {}
  },

  getAccount: (id: string) => accountRegistry.get(id),
}));
