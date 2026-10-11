import {
  saveAccountSecrets,
  loadAccountSecrets,
  deleteAccountSecrets,
  isSecretStoreAvailable,
  accountTokenKey,
  accountCookiesKey,
} from '../../src/infrastructure/SecretStore';

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

beforeEach(() => {
  secretStorage.clear();
  keepAliveMock.__setAvailable(true);
  jest.clearAllMocks();
});

describe('SecretStore — ключи', () => {
  it('ключ токена и cookies имеют ожидаемый формат', () => {
    expect(accountTokenKey('a1')).toBe('account::a1::token');
    expect(accountCookiesKey('a1')).toBe('account::a1::cookies');
  });
});

describe('SecretStore — saveAccountSecrets', () => {
  it('сохраняет token и cookies под ожидаемыми ключами', async () => {
    const ok = await saveAccountSecrets('a1', 'tok-1', 'sid=abc; role=user');

    expect(ok).toBe(true);
    expect(secretStorage.get('account::a1::token')).toBe('tok-1');
    expect(secretStorage.get('account::a1::cookies')).toBe('sid=abc; role=user');
  });

  it('без cookies сохраняет только токен', async () => {
    const ok = await saveAccountSecrets('a1', 'tok-1');

    expect(ok).toBe(true);
    expect(secretStorage.size).toBe(1);
    expect(secretStorage.get('account::a1::token')).toBe('tok-1');
    expect(secretStorage.has('account::a1::cookies')).toBe(false);
  });

  it('возвращает false, если нативное хранилище недоступно', async () => {
    keepAliveMock.__setAvailable(false);

    const ok = await saveAccountSecrets('a1', 'tok-1', 'sid=abc');

    expect(ok).toBe(false);
    expect(secretStorage.size).toBe(0);
  });

  it('не бросает исключение, если нативный слой вернул ошибку', async () => {
    keepAliveMock.saveSecret.mockImplementationOnce(async () => {
      throw new Error('secret_save_failed');
    });

    await expect(saveAccountSecrets('a1', 'tok-1')).resolves.toBe(false);
    expect(secretStorage.size).toBe(0);
  });

  it('возвращает false, если записался только токен, а cookies — нет', async () => {
    keepAliveMock.saveSecret
      .mockImplementationOnce(async (key: string, value: string) => {
        secretStorage.set(key, value);
        return true;
      })
      .mockImplementationOnce(async () => false);

    const ok = await saveAccountSecrets('a1', 'tok-1', 'sid=abc');

    expect(ok).toBe(false);
    expect(secretStorage.get('account::a1::token')).toBe('tok-1');
    expect(secretStorage.has('account::a1::cookies')).toBe(false);
  });
});

describe('SecretStore — loadAccountSecrets', () => {
  it('возвращает null, если секретов нет', async () => {
    await expect(loadAccountSecrets('a1')).resolves.toBeNull();
  });

  it('возвращает null, если хранилище недоступно', async () => {
    secretStorage.set('account::a1::token', 'tok-1');
    keepAliveMock.__setAvailable(false);

    await expect(loadAccountSecrets('a1')).resolves.toBeNull();
  });

  it('читает token и cookies', async () => {
    secretStorage.set('account::a1::token', 'tok-1');
    secretStorage.set('account::a1::cookies', 'sid=abc');

    await expect(loadAccountSecrets('a1')).resolves.toEqual({
      token: 'tok-1',
      cookies: 'sid=abc',
    });
  });

  it('возвращает только token, если cookies не сохранялись', async () => {
    secretStorage.set('account::a1::token', 'tok-1');

    await expect(loadAccountSecrets('a1')).resolves.toEqual({token: 'tok-1'});
  });

  it('возвращает только cookies, если токена нет', async () => {
    secretStorage.set('account::a1::cookies', 'sid=abc');

    await expect(loadAccountSecrets('a1')).resolves.toEqual({
      cookies: 'sid=abc',
    });
  });

  it('не бросает исключение при ошибке нативного чтения', async () => {
    keepAliveMock.getSecret.mockImplementationOnce(async () => {
      throw new Error('secret_read_failed');
    });

    await expect(loadAccountSecrets('a1')).resolves.toBeNull();
  });

  it('не смешивает секреты разных аккаунтов', async () => {
    secretStorage.set('account::a1::token', 'tok-a1');
    secretStorage.set('account::a2::token', 'tok-a2');

    await expect(loadAccountSecrets('a1')).resolves.toEqual({token: 'tok-a1'});
    await expect(loadAccountSecrets('a2')).resolves.toEqual({token: 'tok-a2'});
    await expect(loadAccountSecrets('a3')).resolves.toBeNull();
  });
});

describe('SecretStore — deleteAccountSecrets', () => {
  it('удаляет оба ключа аккаунта', async () => {
    secretStorage.set('account::a1::token', 'tok-1');
    secretStorage.set('account::a1::cookies', 'sid=abc');
    secretStorage.set('account::a2::token', 'tok-2');

    await deleteAccountSecrets('a1');

    expect(secretStorage.has('account::a1::token')).toBe(false);
    expect(secretStorage.has('account::a1::cookies')).toBe(false);
    expect(secretStorage.get('account::a2::token')).toBe('tok-2');
  });

  it('не бросает исключение, если хранилище недоступно', async () => {
    secretStorage.set('account::a1::token', 'tok-1');
    keepAliveMock.__setAvailable(false);

    await expect(deleteAccountSecrets('a1')).resolves.toBeUndefined();
  });

  it('не бросает исключение при ошибке нативного удаления', async () => {
    secretStorage.set('account::a1::token', 'tok-1');
    keepAliveMock.deleteSecret.mockImplementationOnce(async () => {
      throw new Error('secret_delete_failed');
    });

    await expect(deleteAccountSecrets('a1')).resolves.toBeUndefined();
  });
});

describe('SecretStore — isSecretStoreAvailable', () => {
  it('возвращает true и убирает пробный ключ', async () => {
    await expect(isSecretStoreAvailable()).resolves.toBe(true);
    expect(secretStorage.size).toBe(0);
  });

  it('возвращает false, если модуль недоступен', async () => {
    keepAliveMock.__setAvailable(false);

    await expect(isSecretStoreAvailable()).resolves.toBe(false);
  });

  it('возвращает false, если запись прошла, но чтение не вернуло значение', async () => {
    keepAliveMock.getSecret.mockImplementationOnce(async () => null);

    await expect(isSecretStoreAvailable()).resolves.toBe(false);
  });

  it('возвращает false, если нативная запись бросила исключение', async () => {
    keepAliveMock.saveSecret.mockImplementationOnce(async () => {
      throw new Error('secret_save_failed');
    });

    await expect(isSecretStoreAvailable()).resolves.toBe(false);
  });

  it('различает «модуль недоступен» и «ключа нет»: чтение отсутствующего ключа не влияет на результат', async () => {
    await expect(loadAccountSecrets('нет-такого')).resolves.toBeNull();
    await expect(isSecretStoreAvailable()).resolves.toBe(true);
  });
});
