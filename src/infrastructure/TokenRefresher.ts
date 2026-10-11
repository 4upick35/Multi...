// ---------------------------------------------------------------------------
// Рефреш JWT-токена через /guard/cookie с передачей cookies.
// Инкапсулирует логику из elma-api.ts (refreshTokenWithCookies).
// НЕ изменяет поведение — точная копия существующей логики.
//
// ВАЖНО: рефреш вызывается изнутри makeRequest, когда очередь по хосту уже
// занята текущим запросом. Поэтому он выполняется БЕЗ enqueue — иначе будет
// deadlock (промис рефреша никогда не запустится).
// ---------------------------------------------------------------------------

import axios from 'axios';
import {ElmaAccount} from '../types/account';
import {parseSetCookie} from './CookieStore';

/**
 * Результат рефреша токена.
 */
export interface RefreshResult {
  /** Успешность операции */
  ok: boolean;
  /** Новый JWT-токен (если получен) */
  token?: string;
  /** Новые cookies из ответа (если есть) */
  cookies?: string;
}

/**
 * Рефреш JWT-токена: GET /guard/cookie с текущими cookies аккаунта.
 *
 * @param account Текущий аккаунт (baseUrl + cookies).
 * @returns Новый токен и/или cookies, или {ok: false} при ошибке.
 */
export async function refreshTokenWithCookies(
  account: ElmaAccount,
): Promise<RefreshResult> {
  try {
    const headers: Record<string, string> = {};
    if (account.cookies) {
      headers.Cookie = account.cookies;
    }
    const resp = await axios.get(`${account.baseUrl}/guard/cookie`, {
      headers,
      withCredentials: false,
      timeout: 10000,
    });
    const token = resp.headers.token || resp.data?.token;
    const cookies = parseSetCookie(resp.headers?.['set-cookie']);
    if (token) {
      return {ok: true, token, cookies: cookies || undefined};
    }
    return {ok: false};
  } catch {
    return {ok: false};
  }
}

/**
 * Standalone рефреш без cookies (обёртка для обратной совместимости).
 *
 * @param baseUrl Базовый URL сервера.
 * @returns Новый токен или {ok: false}.
 */
export async function refreshTokenStandalone(
  baseUrl: string,
): Promise<{ok: boolean; token?: string}> {
  try {
    const resp = await axios.get(`${baseUrl}/guard/cookie`, {
      withCredentials: false,
      timeout: 10000,
    });
    const token = resp.headers.token || resp.data?.token;
    if (token) {
      return {ok: true, token};
    }
    return {ok: false};
  } catch {
    return {ok: false};
  }
}
