// ---------------------------------------------------------------------------
// Транспортный слой: инкапсулирует Axios-инстансы, per-host очередь,
// cookie/JWT-заголовки и извлечение set-cookie из ответов.
// Использует CookieStore и RequestQueue из фазы R0.
// Защита от троттлинга только при 429/503; 403/412 — шум, проходят.
// ---------------------------------------------------------------------------

import axios, {AxiosInstance, AxiosResponse} from 'axios';
import {ElmaAccount} from '../types/account';
import {parseSetCookie, mergeCookies} from './CookieStore';
import {RequestQueue} from './RequestQueue';
import {delay} from '../native/KeepAlive';
import {isSecureBaseUrl} from '../utils/url';
import {isPaused as isAccountPaused, recordThrottleError, recordThrottleSuccess} from './AccountThrottle';
import {logDiag} from '../diag/accept-log';
import {maskValue} from '../utils/mask';

/** Ошибка транспорта для троттлинга. */
export class TransportThrottleError extends Error {
  status: number;
  constructor(status: number) {
    super(`Rate limited: ${status}`);
    this.name = 'TransportThrottleError';
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 15000;

/** Таймаут для тяжёлых ответов (шаблон процесса ~455 КБ). */
export const LARGE_RESPONSE_TIMEOUT_MS = 30_000;

/** Порог мягкого счётчика: 5+ разных 403/412 за 30 с → пауза 30 с. */
const SOFT_COUNT_THRESHOLD = 5;
const SOFT_WINDOW_MS = 30_000;
const SOFT_PAUSE_MS = 30_000;

/** Мягкий счётчик 403/412: accountId → Map<url, timestamps[]> */
const soft403412Counts = new Map<string, Map<string, number[]>>();

export interface TransportResponse {
  data: unknown;
  updatedAccount?: Partial<ElmaAccount>;
}

export class HttpTransport {
  private instances = new Map<string, AxiosInstance>();
  private queue = new RequestQueue();

  extractCookiesFromResponse(resp: AxiosResponse): string {
    return parseSetCookie(resp.headers?.['set-cookie']);
  }

  async request(
    account: ElmaAccount,
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
    data?: unknown,
    params?: unknown,
    headers?: Record<string, string>,
    skipThrottle?: boolean,
    timeoutMs?: number,
  ): Promise<TransportResponse> {
    if (!isSecureBaseUrl(account.baseUrl) && !__DEV__) {
      throw new Error('Небезопасный адрес сервера: требуется https');
    }
    const origin = HttpTransport.extractOrigin(account.baseUrl);

    if (!skipThrottle && isAccountPaused(account.id)) {
      throw new TransportThrottleError(429);
    }

    return this.queue.enqueue(origin, async () => {
      const client = this.getClient(account);

      const controller = new AbortController();
      void delay(timeoutMs ?? REQUEST_TIMEOUT_MS).then(() => controller.abort());

      let resp: AxiosResponse;
      try {
        resp = await client.request({
          method,
          url,
          data,
          params,
          headers,
          signal: controller.signal,
        });
      } catch (err: unknown) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          if ((status === 429 || status === 503) && !skipThrottle) {
            recordThrottleError(account.id);
            throw new TransportThrottleError(status);
          }
          if ((status === 403 || status === 412) && !skipThrottle) {
            // 403/412 — шум, запрос проходит как обычно.
            // Ведём мягкий счётчик: если 5+ разных запросов за 30 с — ставим паузу.
            this.recordSoftThrottle(account.id, url, status);
            throw err;
          }
        }
        throw err;
      }

      if (!skipThrottle) {
        recordThrottleSuccess(account.id);
      }

      const cookies = this.extractCookiesFromResponse(resp);
      const updated: Partial<ElmaAccount> = {};
      if (cookies) {
        updated.cookies = mergeCookies(account.cookies, cookies);
      }

      return {
        data: resp.data,
        updatedAccount: Object.keys(updated).length ? updated : undefined,
      };
    });
  }

  async requestDirect(
    account: ElmaAccount,
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
    config?: {
      data?: unknown;
      params?: unknown;
      headers?: Record<string, string>;
      timeout?: number;
      withCredentials?: boolean;
    },
  ): Promise<AxiosResponse> {
    const client = this.getClient(account);
    return client.request({
      method,
      url,
      data: config?.data,
      params: config?.params,
      headers: config?.headers,
      timeout: config?.timeout,
      withCredentials: config?.withCredentials,
    });
  }

  clearClient(accountId: string): void {
    this.instances.delete(accountId);
  }

  private recordSoftThrottle(accountId: string, url: string, _status: number): void {
    const accountMap = soft403412Counts.get(accountId) ?? new Map<string, number[]>();
    const now = Date.now();
    const timestamps = accountMap.get(url) ?? [];
    const filtered = timestamps.filter(t => now - t < SOFT_WINDOW_MS);
    filtered.push(now);
    accountMap.set(url, filtered);
    soft403412Counts.set(accountId, accountMap);

    const uniqueCount = accountMap.size;
    if (uniqueCount >= SOFT_COUNT_THRESHOLD) {
      logDiag('throttle', `account=${maskValue(accountId)} soft-throttle=${uniqueCount}urls pause=${SOFT_PAUSE_MS}ms`);
      recordThrottleError(accountId);
      // Очищаем мягкий счётчик, чтобы не набирать повторно
      soft403412Counts.delete(accountId);
    }
  }

  private getClient(account: ElmaAccount): AxiosInstance {
    let client = this.instances.get(account.id);
    if (client) {
      if (account.token) {
        client.defaults.headers.common.Authorization =
          `Bearer ${account.token}`;
      } else {
        delete client.defaults.headers.common.Authorization;
      }
      if (account.cookies) {
        client.defaults.headers.common.Cookie = account.cookies;
      } else {
        delete client.defaults.headers.common.Cookie;
      }
      return client;
    }
    client = HttpTransport.buildInstance(account);
    this.instances.set(account.id, client);
    return client;
  }

  private static buildInstance(account: ElmaAccount): AxiosInstance {
    const client = axios.create({
      baseURL: account.baseUrl,
      timeout: 15000,
      withCredentials: false,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (account.token) {
      client.defaults.headers.common.Authorization =
        `Bearer ${account.token}`;
    }
    if (account.cookies) {
      client.defaults.headers.common.Cookie = account.cookies;
    }
    return client;
  }

  static extractOrigin(baseUrl: string): string {
    try {
      const u = new URL(baseUrl);
      return u.origin;
    } catch {
      return baseUrl;
    }
  }
}
