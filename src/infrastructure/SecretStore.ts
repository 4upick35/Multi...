// ---------------------------------------------------------------------------
// Защищённое хранение сессионных секретов аккаунтов ELMA (token, cookies).
//
// Ключи: `account::<accountId>::token` и `account::<accountId>::cookies`.
// Нативный слой — EncryptedSharedPreferences (см. KeepAliveModule.kt).
//
// Хранилище может быть недоступно (не-Android, отсутствие модуля, ошибки
// Keystore): все ошибки перехватываются здесь, наружу возвращаются только
// безопасные значения (false / null), исключения наружу не пробрасываются.
// ---------------------------------------------------------------------------

import {saveSecret, getSecret, deleteSecret} from '../native/KeepAlive';

/** Служебный ключ пробной записи для проверки доступности хранилища. */
const PROBE_KEY = 'multielma::secret_store::probe';

/** Ключ секрета с токеном аккаунта. */
export function accountTokenKey(accountId: string): string {
  return `account::${accountId}::token`;
}

/** Ключ секрета с cookies аккаунта. */
export function accountCookiesKey(accountId: string): string {
  return `account::${accountId}::cookies`;
}

/** Секреты одного аккаунта (отсутствующие поля просто не заполнены). */
export interface AccountSecrets {
  token?: string;
  cookies?: string;
}

async function safeSave(key: string, value: string): Promise<boolean> {
  try {
    return (await saveSecret(key, value)) === true;
  } catch {
    return false;
  }
}

async function safeGet(key: string): Promise<string | null> {
  try {
    const value = await getSecret(key);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

async function safeDelete(key: string): Promise<boolean> {
  try {
    return (await deleteSecret(key)) === true;
  } catch {
    return false;
  }
}

/**
 * Сохраняет секреты аккаунта (токен и, если передан, cookies).
 * @returns true только если все нужные записи прошли успешно.
 */
export async function saveAccountSecrets(
  accountId: string,
  token: string,
  cookies?: string,
): Promise<boolean> {
  let ok = await safeSave(accountTokenKey(accountId), token);
  if (cookies !== undefined) {
    const cookiesOk = await safeSave(accountCookiesKey(accountId), cookies);
    ok = ok && cookiesOk;
  }
  return ok;
}

/**
 * Читает секреты аккаунта.
 * @returns null, если ни одного секрета нет (или хранилище недоступно).
 */
export async function loadAccountSecrets(
  accountId: string,
): Promise<AccountSecrets | null> {
  const token = await safeGet(accountTokenKey(accountId));
  const cookies = await safeGet(accountCookiesKey(accountId));
  if (token === null && cookies === null) {
    return null;
  }
  const secrets: AccountSecrets = {};
  if (token !== null) {
    secrets.token = token;
  }
  if (cookies !== null) {
    secrets.cookies = cookies;
  }
  return secrets;
}

/** Удаляет оба секрета аккаунта. Ошибки перехватываются. */
export async function deleteAccountSecrets(accountId: string): Promise<void> {
  await safeDelete(accountTokenKey(accountId));
  await safeDelete(accountCookiesKey(accountId));
}

/**
 * Проверяет доступность хранилища пробной записью/чтением служебного ключа.
 * Отличает «модуль недоступен» от «ключа нет»: здесь значение обязано
 * записаться и прочитаться обратно без изменений.
 */
export async function isSecretStoreAvailable(): Promise<boolean> {
  const probeValue = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    if (!(await saveSecret(PROBE_KEY, probeValue))) {
      return false;
    }
    const readBack = await safeGet(PROBE_KEY);
    await safeDelete(PROBE_KEY);
    return readBack === probeValue;
  } catch {
    await safeDelete(PROBE_KEY);
    return false;
  }
}
