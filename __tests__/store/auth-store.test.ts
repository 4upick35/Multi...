import {useAuthStore, accountRegistry} from '../../src/store/auth-store';
import {useTasksStore} from '../../src/store/tasks-store';
import {useFeedStore} from '../../src/store/feed-store';
import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import {useUiStore} from '../../src/store/ui-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {STORAGE_KEYS} from '../../src/config/constants';
import type {ElmaAccount} from '../../src/types/account';
import type {AcceptTemplate} from '../../src/services/elma-api';
import {
  getCachedAcceptTemplate,
  setCachedAcceptTemplate,
  clearAcceptTemplates,
} from '../../src/services/accept-template-cache';
import * as acceptTemplateCache from '../../src/services/accept-template-cache';
import {
  loadSeenKeys,
  persistSeenKeys,
} from '../../src/services/seen-application-alerts';
import * as seenApplicationAlerts from '../../src/services/seen-application-alerts';
import {cacheGet, cacheSet} from '../../src/infrastructure/elma-cache';
import * as elmaCache from '../../src/infrastructure/elma-cache';

jest.mock('../../src/native/KeepAlive', () => {
  const storage = new Map<string, string>();
  const state = {available: true};
  return {
    __storage: storage,
    __setAvailable: (value: boolean) => {
      state.available = value;
    },
    saveSecret: jest.fn(async (key: string, value: string) => {
      if (!state.available) {
        return false;
      }
      storage.set(key, value);
      return true;
    }),
    getSecret: jest.fn(async (key: string) => {
      if (!state.available) {
        return null;
      }
      return storage.get(key) ?? null;
    }),
    deleteSecret: jest.fn(async (key: string) => {
      if (!state.available) {
        return false;
      }
      storage.delete(key);
      return true;
    }),
  };
});

const keepAliveMock = jest.requireMock('../../src/native/KeepAlive');
const secretStorage: Map<string, string> = keepAliveMock.__storage;

function makeAccount(id: string, userKind?: 'default' | 'portal'): ElmaAccount {
  return {
    id,
    name: `Account ${id}`,
    baseUrl: 'https://elma.example.com',
    portal: 'customer_service',
    token: `tok-${id}`,
    userId: `uid-${id}`,
    color: '#000',
    isActive: true,
    userKind,
  };
}

async function readStoredAccounts(): Promise<Record<string, unknown>[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.accounts);
  return raw ? JSON.parse(raw) : [];
}

async function seedStoredAccounts(
  accounts: Record<string, unknown>[],
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.accounts, JSON.stringify(accounts));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  secretStorage.clear();
  keepAliveMock.__setAvailable(true);
  jest.clearAllMocks();
  useAuthStore.setState({accounts: []});
  useTasksStore.setState({tasksByAccount: {}, syncStates: {}});
  useFeedStore.setState({
    messagesByAccount: {},
    channelsByAccount: {},
    unreadCountByAccount: {},
    loadingByAccount: {},
    errorByAccount: {},
    offsetByAccount: {},
    hasMoreByAccount: {},
  });
  useCustomerServiceStore.setState({itemsByAccount: {}, syncStates: {}});
  useUiStore.setState({activeAccountId: null});
  accountRegistry.loadAll([]);
});

describe('auth-store — removeAccount clears all caches', () => {
  it('после удаления данные аккаунта пропали из feed-store и customer-service-store', async () => {
    const acc = makeAccount('acc-1');
    await useAuthStore.getState().addAccount(acc);

    // Заполняем кэши
    useFeedStore.getState().setMessages('acc-1', [{id: 'm1'} as any], false);
    useCustomerServiceStore.setState((s) => ({
      itemsByAccount: {
        ...s.itemsByAccount,
        'acc-1': {services: [{id: 'c1'} as any] as any},
      },
    }));
    useUiStore.setState({activeAccountId: 'acc-1'});

    await useAuthStore.getState().removeAccount('acc-1');

    expect(useFeedStore.getState().messagesByAccount['acc-1']).toBeUndefined();
    expect(useCustomerServiceStore.getState().itemsByAccount['acc-1']).toBeUndefined();
  });

  it('после удаления activeAccountId сброшен, если был удалённый аккаунт', async () => {
    const acc = makeAccount('acc-1');
    await useAuthStore.getState().addAccount(acc);
    useUiStore.setState({activeAccountId: 'acc-1'});

    await useAuthStore.getState().removeAccount('acc-1');

    expect(useUiStore.getState().activeAccountId).toBeNull();
  });

  it('после удаления activeAccountId НЕ сброшен, если был другой аккаунт', async () => {
    const acc1 = makeAccount('acc-1');
    const acc2 = makeAccount('acc-2');
    await useAuthStore.getState().addAccount(acc1);
    await useAuthStore.getState().addAccount(acc2);
    useUiStore.setState({activeAccountId: 'acc-2'});

    await useAuthStore.getState().removeAccount('acc-1');

    expect(useUiStore.getState().activeAccountId).toBe('acc-2');
  });
});

describe('auth-store — выгрузка секретов в SecretStore (E13)', () => {
  it('addAccount: в AsyncStorage копия без token/cookies, секреты — в SecretStore', async () => {
    const acc = {...makeAccount('acc-1'), cookies: 'sid=abc'};

    await useAuthStore.getState().addAccount(acc);

    const stored = await readStoredAccounts();
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toHaveProperty('token');
    expect(stored[0]).not.toHaveProperty('cookies');
    expect(secretStorage.get('account::acc-1::token')).toBe('tok-acc-1');
    expect(secretStorage.get('account::acc-1::cookies')).toBe('sid=abc');
    expect(useAuthStore.getState().accounts[0].token).toBe('tok-acc-1');
    expect(useAuthStore.getState().accounts[0].cookies).toBe('sid=abc');
  });

  it('updateAccount: новый токен уходит в секреты и не появляется в AsyncStorage', async () => {
    await useAuthStore.getState().addAccount(makeAccount('acc-1'));

    await useAuthStore.getState().updateAccount('acc-1', {token: 'tok-new'});

    const stored = await readStoredAccounts();
    expect(stored[0]).not.toHaveProperty('token');
    expect(secretStorage.get('account::acc-1::token')).toBe('tok-new');
    expect(useAuthStore.getState().accounts[0].token).toBe('tok-new');
  });

  it('fallback: хранилище недоступно — поля token/cookies сохранены в AsyncStorage', async () => {
    keepAliveMock.__setAvailable(false);
    const acc = {...makeAccount('acc-1'), cookies: 'sid=abc'};

    await useAuthStore.getState().addAccount(acc);

    const stored = await readStoredAccounts();
    expect(stored[0].token).toBe('tok-acc-1');
    expect(stored[0].cookies).toBe('sid=abc');
    expect(secretStorage.size).toBe(0);
    expect(useAuthStore.getState().accounts[0].token).toBe('tok-acc-1');
  });

  it('fallback: нативная запись бросила исключение — старая схема сохранена', async () => {
    keepAliveMock.saveSecret.mockImplementationOnce(async () => {
      throw new Error('secret_save_failed');
    });

    await useAuthStore.getState().addAccount(makeAccount('acc-1'));

    const stored = await readStoredAccounts();
    expect(stored[0].token).toBe('tok-acc-1');
    expect(useAuthStore.getState().accounts[0].token).toBe('tok-acc-1');
  });

  it('removeAccount: секреты аккаунта удаляются из SecretStore', async () => {
    const acc = {...makeAccount('acc-1'), cookies: 'sid=abc'};
    await useAuthStore.getState().addAccount(acc);
    expect(secretStorage.get('account::acc-1::token')).toBe('tok-acc-1');

    await useAuthStore.getState().removeAccount('acc-1');

    expect(secretStorage.has('account::acc-1::token')).toBe(false);
    expect(secretStorage.has('account::acc-1::cookies')).toBe(false);
    expect(secretStorage.has('account::acc-2::token')).toBe(false);
  });
});

describe('auth-store — миграция секретов при loadAccounts (E13)', () => {
  it('(а) успешная миграция: секреты ушли в SecretStore, в AsyncStorage полей token/cookies нет', async () => {
    await seedStoredAccounts([{...makeAccount('acc-1'), cookies: 'sid=abc'}]);

    await useAuthStore.getState().loadAccounts();

    const account = useAuthStore.getState().getAccount('acc-1');
    expect(account?.token).toBe('tok-acc-1');
    expect(account?.cookies).toBe('sid=abc');

    const stored = await readStoredAccounts();
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toHaveProperty('token');
    expect(stored[0]).not.toHaveProperty('cookies');

    expect(secretStorage.get('account::acc-1::token')).toBe('tok-acc-1');
    expect(secretStorage.get('account::acc-1::cookies')).toBe('sid=abc');
  });

  it('(б) хранилище недоступно — старые поля сохранены, аккаунт читается', async () => {
    await seedStoredAccounts([{...makeAccount('acc-1'), cookies: 'sid=abc'}]);
    keepAliveMock.__setAvailable(false);

    await useAuthStore.getState().loadAccounts();

    const account = useAuthStore.getState().getAccount('acc-1');
    expect(account?.token).toBe('tok-acc-1');
    expect(account?.cookies).toBe('sid=abc');

    const stored = await readStoredAccounts();
    expect(stored[0].token).toBe('tok-acc-1');
    expect(stored[0].cookies).toBe('sid=abc');
    expect(secretStorage.size).toBe(0);
  });

  it('(б) нативная запись бросила исключение — старая схема не тронута', async () => {
    await seedStoredAccounts([{...makeAccount('acc-1'), cookies: 'sid=abc'}]);
    keepAliveMock.saveSecret.mockImplementationOnce(async () => {
      throw new Error('secret_save_failed');
    });

    await useAuthStore.getState().loadAccounts();

    const account = useAuthStore.getState().getAccount('acc-1');
    expect(account?.token).toBe('tok-acc-1');

    const stored = await readStoredAccounts();
    expect(stored[0].token).toBe('tok-acc-1');
    expect(stored[0].cookies).toBe('sid=abc');
  });

  it('(б) проверка чтением не прошла — поля не удаляются, миграция откатывается', async () => {
    await seedStoredAccounts([{...makeAccount('acc-1'), cookies: 'sid=abc'}]);
    // Запись «успеха» без фактического сохранения: чтение вернёт null.
    keepAliveMock.saveSecret
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => true);

    await useAuthStore.getState().loadAccounts();

    expect(keepAliveMock.saveSecret).toHaveBeenCalled();
    const stored = await readStoredAccounts();
    expect(stored[0].token).toBe('tok-acc-1');
    expect(stored[0].cookies).toBe('sid=abc');
    expect(secretStorage.size).toBe(0);

    const account = useAuthStore.getState().getAccount('acc-1');
    expect(account?.token).toBe('tok-acc-1');
    expect(account?.cookies).toBe('sid=abc');
  });

  it('(в) повторный запуск идемпотентен: вторая загрузка ничего не меняет', async () => {
    await seedStoredAccounts([{...makeAccount('acc-1'), cookies: 'sid=abc'}]);

    await useAuthStore.getState().loadAccounts();
    const firstRaw = await AsyncStorage.getItem(STORAGE_KEYS.accounts);
    const firstSecrets = new Map(secretStorage);
    const firstToken = useAuthStore.getState().getAccount('acc-1')?.token;
    const saveCallsAfterFirstRun = keepAliveMock.saveSecret.mock.calls.length;

    accountRegistry.loadAll([]);
    useAuthStore.setState({accounts: []});

    await useAuthStore.getState().loadAccounts();
    const secondRaw = await AsyncStorage.getItem(STORAGE_KEYS.accounts);

    expect(secondRaw).toBe(firstRaw);
    expect(new Map(secretStorage)).toEqual(firstSecrets);
    expect(useAuthStore.getState().getAccount('acc-1')?.token).toBe(firstToken);
    expect(firstToken).toBe('tok-acc-1');
    // Второй запуск не пишет секреты повторно (JSON уже без открытых полей)
    expect(keepAliveMock.saveSecret.mock.calls.length).toBe(saveCallsAfterFirstRun);

    const stored = await readStoredAccounts();
    expect(stored[0]).not.toHaveProperty('token');
    expect(stored[0]).not.toHaveProperty('cookies');
  });

  it('(а) уже мигрированные данные: JSON без полей, секреты в SecretStore', async () => {
    await seedStoredAccounts([
      {id: 'acc-1', name: 'Account', baseUrl: 'https://elma.example.com', portal: 'customer_service', userId: 'uid-1', color: '#000', isActive: true},
    ]);
    secretStorage.set('account::acc-1::token', 'tok-1');
    secretStorage.set('account::acc-1::cookies', 'sid=xyz');
    const rawBefore = await AsyncStorage.getItem(STORAGE_KEYS.accounts);

    await useAuthStore.getState().loadAccounts();

    const account = useAuthStore.getState().getAccount('acc-1');
    expect(account?.token).toBe('tok-1');
    expect(account?.cookies).toBe('sid=xyz');
    expect(await AsyncStorage.getItem(STORAGE_KEYS.accounts)).toBe(rawBefore);
    expect(keepAliveMock.saveSecret).not.toHaveBeenCalled();
  });

  it('фильтрация userKind === default сохраняется при миграции', async () => {
    await seedStoredAccounts([
      {...makeAccount('shop-1', 'default')},
      {...makeAccount('acc-1'), cookies: 'sid=abc'},
    ]);

    await useAuthStore.getState().loadAccounts();

    const stored = await readStoredAccounts();
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('acc-1');
    expect(stored[0]).not.toHaveProperty('token');
    expect(useAuthStore.getState().getAccount('acc-1')?.token).toBe('tok-acc-1');
    expect(useAuthStore.getState().getAccount('shop-1')).toBeUndefined();
    expect(secretStorage.has('account::shop-1::token')).toBe(false);
  });

  it('расхождение значений: секрет из SecretStore подставлен, открытая копия не теряется', async () => {
    await seedStoredAccounts([{...makeAccount('acc-1'), token: 'tok-from-json'}]);
    secretStorage.set('account::acc-1::token', 'tok-from-store');

    await useAuthStore.getState().loadAccounts();

    expect(useAuthStore.getState().getAccount('acc-1')?.token).toBe(
      'tok-from-store',
    );
    const stored = await readStoredAccounts();
    // расхождение → открытая копия остаётся (не удаляем непроверенные данные)
    expect(stored[0].token).toBe('tok-from-json');
  });
});

// ---------------------------------------------------------------------------
// E10: removeAccount чистит кэши строго по accountId
// ---------------------------------------------------------------------------

function makeTemplate(id: string): AcceptTemplate {
  return {
    templateId: id,
    templateVersion: 1,
    formCode: `form_${id}`,
    formVersion: 1,
    contextFields: [{code: 'field1', type: 'STRING'}],
  };
}

describe('auth-store — removeAccount чистит кэши по accountId (E10)', () => {
  it('шаблоны, виденные алерты и TTL-кэш удалённого аккаунта очищены, второй аккаунт не задет', async () => {
    await clearAcceptTemplates();
    const acc1 = makeAccount('acc');
    const acc2 = makeAccount('acc2');
    await useAuthStore.getState().addAccount(acc1);
    await useAuthStore.getState().addAccount(acc2);

    const t1 = makeTemplate('tmpl-acc');
    const t2 = makeTemplate('tmpl-acc2');
    await setCachedAcceptTemplate('acc', t1);
    await setCachedAcceptTemplate('acc2', t2);
    persistSeenKeys(new Set(['acc::1', 'acc2::1']));
    cacheSet('acc', 'k', 'v-acc', 60000);
    cacheSet('acc2', 'k', 'v-acc2', 60000);

    await useAuthStore.getState().removeAccount('acc');

    expect(await getCachedAcceptTemplate('acc')).toBeNull();
    expect(await getCachedAcceptTemplate('acc2')).toEqual(t2);
    expect(await loadSeenKeys()).toEqual(new Set(['acc2::1']));
    expect(cacheGet('acc', 'k')).toBeUndefined();
    expect(cacheGet('acc2', 'k')).toBe('v-acc2');
    expect(useAuthStore.getState().accounts.map((a) => a.id)).toEqual(['acc2']);
  });

  it('вызывает все три очистки с нужным id; ошибка очистки не ломает удаление', async () => {
    const spyTemplates = jest
      .spyOn(acceptTemplateCache, 'clearAcceptTemplatesForAccount')
      .mockImplementationOnce(async () => {
        throw new Error('templates_cleanup_failed');
      });
    const spySeen = jest
      .spyOn(seenApplicationAlerts, 'clearSeenApplicationAlertsForAccount')
      .mockImplementationOnce(async () => {
        throw new Error('seen_cleanup_failed');
      });
    const spyTtl = jest
      .spyOn(elmaCache, 'cacheClearAccount')
      .mockImplementationOnce(() => {
        throw new Error('ttl_cleanup_failed');
      });

    await useAuthStore.getState().addAccount(makeAccount('acc'));
    await useAuthStore.getState().addAccount(makeAccount('acc2'));

    await useAuthStore.getState().removeAccount('acc');

    expect(spyTemplates).toHaveBeenCalledWith('acc');
    expect(spySeen).toHaveBeenCalledWith('acc');
    expect(spyTtl).toHaveBeenCalledWith('acc');
    expect(spyTemplates).not.toHaveBeenCalledWith('acc2');
    expect(useAuthStore.getState().accounts.map((a) => a.id)).toEqual(['acc2']);
    expect(useAuthStore.getState().getAccount('acc')).toBeUndefined();
  });
});
