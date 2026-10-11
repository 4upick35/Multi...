import axios from 'axios';
import {logDiag} from '../../diag/accept-log';
import {ElmaAccount} from '../../types/account';
import {ElmaRequestError} from '../../types/errors';
import {HttpTransport} from '../HttpTransport';
import {mergeCookies} from '../CookieStore';
import {refreshTokenWithCookies as refreshTokenWithCookiesBase} from '../TokenRefresher';

// ---------------------------------------------------------------------------
// HttpTransport headers для новых вызовов
// ---------------------------------------------------------------------------

export const VISIT_READ_HEADERS: Record<string, string> = {
  'X-Language': 'ru-RU',
  'X-Timezone': 'Europe/Minsk',
  'X-Eql-Timezone': 'Europe/Minsk',
  'X-Requested-With': 'XMLHttpRequest',
  'X-Active-User': 'false',
};

export const VISIT_WRITE_HEADERS: Record<string, string> = {
  'X-Language': 'ru-RU',
  'X-Timezone': 'Europe/Minsk',
  'X-Eql-Timezone': 'Europe/Minsk',
  'X-Requested-With': 'XMLHttpRequest',
  'X-Active-User': 'true',
};

// Singleton-экземпляр транспорта (ippers-host очередь + Axios-инстансы)
const transport = new HttpTransport();

/**
 * Достать текст причины из тела ответа сервера ELMA.
 * Сервер отдаёт причину по-разному: строкой, объектом {message|error|errorMessage|...},
 * либо строкой с JSON внутри. Возвращает '' если осмысленного текста нет.
 */
function extractServerErrorText(data: unknown): string {
  if (data === null || data === undefined) {
    return '';
  }
  if (typeof data === 'string') {
    const text = data.trim();
    if (!text) {
      return '';
    }
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return extractServerErrorText(JSON.parse(text));
      } catch {
        return text;
      }
    }
    return text;
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const keys = ['message', 'errorMessage', 'ErrorMessage', 'error', 'detail', 'title', 'description', 'Description'];
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (value && typeof value === 'object') {
        const nested = extractServerErrorText(value);
        if (nested) {
          return nested;
        }
      }
    }
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const nested = extractServerErrorText(obj.errors[0]);
      if (nested) {
        return nested;
      }
    }
  }
  return '';
}

const AUTH_URL_PREFIXES = ['/guard/login', '/guard/cookie', '/api/auth'];

function isAuthUrl(url: string): boolean {
  return AUTH_URL_PREFIXES.some(p => url.startsWith(p));
}

// Generic makeRequest — делегирует HTTP HttpTransport,
// обрабатывает 401 + cookie refresh
// ---------------------------------------------------------------------------

export async function makeRequest(
  account: ElmaAccount,
  method: 'get' | 'post' | 'put' | 'delete',
  url: string,
  data?: unknown,
  params?: unknown,
  headers?: Record<string, string>,
  timeoutMs?: number,
): Promise<{data: unknown; updatedAccount?: Partial<ElmaAccount>}> {
  let currentAccount = {...account};
  const skipThrottle = isAuthUrl(url);

  try {
    const result = await transport.request(currentAccount, method, url, data, params, headers, skipThrottle, timeoutMs);
    return {data: result.data, updatedAccount: result.updatedAccount};
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && err.constructor && err.constructor.name === 'TransportThrottleError') {
      const status = (err as {status: number}).status;
      if (status === 429) {
        throw new ElmaRequestError('rate', `Rate limited: ${status}`, status);
      }
      throw new ElmaRequestError('other', String(err), status);
    }
    if (!axios.isAxiosError(err)) {
      throw new ElmaRequestError('other', String(err));
    }
    const status = err.response?.status;
    if (status === 401) {
      const refreshResult = await refreshTokenWithCookiesBase(currentAccount);
      if (refreshResult.ok && refreshResult.token) {
        transport.clearClient(currentAccount.id);
        currentAccount = {...currentAccount, token: refreshResult.token};
        if (refreshResult.cookies) {
          currentAccount.cookies = mergeCookies(
            currentAccount.cookies,
            refreshResult.cookies,
          );
        }
        try {
          const retryResult = await transport.request(
            currentAccount,
            method,
            url,
            data,
            params,
            headers,
            skipThrottle,
            timeoutMs,
          );
          const updated: Partial<ElmaAccount> = {};
          if (currentAccount.token) {
            updated.token = currentAccount.token;
          }
          if (retryResult.updatedAccount?.cookies) {
            updated.cookies = retryResult.updatedAccount.cookies;
          } else if (retryResult.updatedAccount?.token) {
            updated.token = retryResult.updatedAccount.token;
          }
          return {
            data: retryResult.data,
            updatedAccount: Object.keys(updated).length ? updated : undefined,
          };
        } catch {
          throw new ElmaRequestError(
            'unauthorized',
            'Повторный запрос после обновления токена не прошёл',
            401,
          );
        }
      }
      throw new ElmaRequestError(
        'unauthorized',
        'Не авторизован, обновление токена не помогло',
        401,
      );
    }
    if (status === 429) {
      throw new ElmaRequestError(
        'rate',
        `Rate limit: ${status}`,
        status,
      );
    }
    if (status && status >= 500) {
      logDiag('elma-api', 'makeRequest server error ' + status + ' url=' + url);
      throw new ElmaRequestError(
        'server',
        `Server error: ${status}`,
        status,
      );
    }
    if (status && status >= 400 && status < 500) {
      const serverText = extractServerErrorText(err.response?.data);
      if (serverText) {
        logDiag(
          'elma-api',
          `makeRequest client error ${status} url=${url} server="${serverText.slice(0, 200)}"`,
        );
      }
      const base = err.message || `Request error: ${status}`;
      const message = serverText ? `${base}: ${serverText}`.slice(0, 400) : base;
      throw new ElmaRequestError('other', message, status);
    }
    if (err.code === 'ERR_CANCELED') {
      // Собственный таймаут запроса (AbortController): сообщение «canceled»
      // показывать пользователю нельзя — это просто превышение ожидания.
      throw new ElmaRequestError('timeout', 'Превышено время ожидания ответа');
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new ElmaRequestError('timeout', err.message || 'Timeout');
    }
    if (err.code === 'ERR_NETWORK' || !err.response) {
      throw new ElmaRequestError(
        'network',
        err.message || 'Network error',
      );
    }
    throw new ElmaRequestError(
      'other',
      err.message || 'Request error',
      status,
    );
  }
}
