// ---------------------------------------------------------------------------
// Менеджер сессий: инкапсулирует login/logout/refresh для ELMA API.
// Использует HttpTransport и TokenRefresher из фазы R1.
// НЕ зависит от zustand-сторов — результаты возвращает вызывающему коду.
// ---------------------------------------------------------------------------

import axios from 'axios';
import {ElmaAccount} from '../types/account';
import {parseSetCookie, mergeCookies} from './CookieStore';
import {refreshTokenWithCookies, RefreshResult} from './TokenRefresher';
import {maskValue} from '../utils/mask';
import {logDiag} from '../diag/accept-log';

// ---------------------------------------------------------------------------
// Типы результатов
// ---------------------------------------------------------------------------

/** Результат логина по паролю (loginToElma) */
export interface LoginResult {
  ok: boolean;
  token?: string;
  userId?: string;
  userName?: string;
  error?: string;
  cookies?: string;
  userKind?: 'default' | 'portal';
  privileges?: string[];
  isPortal?: boolean;
}

/** Результат логина по токену (loginWithSession) */
export interface SessionLoginResult {
  ok: boolean;
  userId?: string;
  userName?: string;
}

// ---------------------------------------------------------------------------
// Вспомогательные функции (декодирование JWT, извлечение claims)
// ---------------------------------------------------------------------------

/** Безопасно декодирует base64url строку в UTF-8 */
function base64UrlDecode(str: string): string {
  try {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    if (typeof atob === 'function') {
      return decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      );
    }
    return global.atob
      ? decodeURIComponent(
          global
            .atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join(''),
        )
      : '';
  } catch {
    return '';
  }
}

/** Декодировать payload JWT-токена (без верификации) */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const json = base64UrlDecode(parts[1]);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Извлечь userId и userName из ответа /api/auth.
 * Поддерживает объект с полями и массив claims [{type, value}].
 */
function extractClaims(
  data: unknown,
): {userId: string; userName: string} {
  if (!data) {
    return {userId: '', userName: ''};
  }

  // Массив claims (ELMA возвращает иногда [{type, value}])
  if (Array.isArray(data)) {
    const claims = data as Array<Record<string, unknown>>;
    let userId = '';
    let userName = '';
    for (const c of claims) {
      const t = String(c.type || c.Type || '').toLowerCase();
      const v = String(c.value || c.Value || '');
      if (
        t.includes('nameidentifier') ||
        t.includes('userid') ||
        t === 'sub' ||
        t === 'uid'
      ) {
        userId = v || userId;
      }
      if (t.includes('name') && !t.includes('nameidentifier')) {
        userName = v || userName;
      }
    }
    return {userId, userName};
  }

  // Объект — перебираем ключи
  const obj = data as Record<string, unknown>;
  const idCandidates = [
    'userId', 'UserId', 'userID', 'id', 'Id',
    'uid', 'Uid', 'sub', 'Sub',
    'nameidentifier', 'NameIdentifier', 'nameIdentifier',
  ];
  const nameCandidates = [
    'userName', 'UserName', 'name', 'Name',
    'displayName', 'DisplayName',
  ];
  let userId = '';
  let userName = '';
  for (const key of idCandidates) {
    if (typeof obj[key] === 'string' && obj[key]) {
      userId = obj[key] as string;
      break;
    }
  }
  for (const key of nameCandidates) {
    if (typeof obj[key] === 'string' && obj[key]) {
      userName = obj[key] as string;
      break;
    }
  }
  // Также проверяем claims как вложенный массив
  if (!userId && Array.isArray(obj.claims)) {
    const nested = extractClaims(obj.claims);
    userId = nested.userId;
    userName = nested.userName || userName;
  }
  return {userId, userName};
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

/**
 * SessionManager — инкапсулирует аутентификацию и управление сессиями ELMA.
 *
 * Используется:
 *  - AccountAddScreen для login по паролю
 *  - auth-store для refreshSession
 *  - Сервисами для обновления токена после 401
 *
 * НЕ зависит от zustand-сторов — все результаты возвращаются вызывающему коду.
 */
export class SessionManager {
  /**
   * Логин по паролю (loginToElma).
   * POST /guard/login → GET /api/auth → извлечение claims.
   *
   * @param baseUrl Базовый URL сервера ELMA
   * @param portal Имя портала (например 'customer_service')
   * @param email Почта пользователя
   * @param password Пароль
   */
  async login(
    baseUrl: string,
    portal: string,
    email: string,
    password: string,
  ): Promise<LoginResult> {
    try {
      const loginResp = await axios.post(
        `${baseUrl}/guard/login`,
        {
          auth_login: email,
          password: password,
          remember: true,
          portal: portal,
        },
        {
          withCredentials: false,
          timeout: 15000,
          validateStatus: (s) => s >= 200 && s < 300,
        },
      );

      const token = loginResp.data?.token || '';
      const loginCookies = parseSetCookie(loginResp.headers?.['set-cookie']);

      if (!token) {
        return {ok: false, error: 'Токен не получен', cookies: loginCookies || undefined};
      }

      const claimsHeaders: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (loginCookies) {
        claimsHeaders.Cookie = loginCookies;
      }

      const claimsResp = await axios.get(`${baseUrl}/api/auth`, {
        headers: claimsHeaders,
        withCredentials: false,
        timeout: 10000,
      });

      const claims = claimsResp.data;
      const allCookies = mergeCookies(
        loginCookies,
        parseSetCookie(claimsResp.headers?.['set-cookie']),
      );

      // Извлекаем userId/userName из ответа /api/auth (объект или массив claims)
      let {userId, userName} = extractClaims(claims);

      // Если из /api/auth не удалось извлечь — пробуем декодировать JWT payload
      if (!userId && token && token.split('.').length === 3) {
        const payload = decodeJwtPayload(token);
        if (payload) {
          const jwt = extractClaims(payload);
          userId = jwt.userId;
          userName = jwt.userName || userName;
        }
      }

      // Извлекаем role-информацию из ответа /api/auth
      const claimsObj = claims as Record<string, unknown> | null;
      const userKind = (claimsObj?.userKind as 'default' | 'portal') || 'default';
      const privileges = Array.isArray(claimsObj?.privileges)
        ? (claimsObj.privileges as string[])
        : [];
      const isPortal = Boolean(claimsObj?.isPortal);

      logDiag(
        'session',
        'login ok baseUrl=' + baseUrl +
          ' email=' + maskValue(email) +
          ' userName=' + maskValue(userName || email) +
          ' userId=' + maskValue(userId) +
          ' userKind=' + userKind +
          ' isPortal=' + isPortal +
          ' hasCookies=' + !!allCookies,
      );

      return {
        ok: true,
        token,
        userId,
        userName: userName || email,
        cookies: allCookies || undefined,
        userKind,
        privileges,
        isPortal,
      };
    } catch (e: unknown) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        return {ok: false, error: 'Неверная почта или пароль'};
      }
      // 405 приходит, когда адрес сервера содержит путь портала —
      // POST /_portal/<portal>/guard/login не поддерживается страницей портала.
      if (axios.isAxiosError(e) && e.response?.status === 405) {
        return {
          ok: false,
          error: 'Сервер отклонил вход (405). Укажите адрес только до домена, без пути портала',
        };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {ok: false, error: msg || 'Ошибка сети'};
    }
  }

  /**
   * Логин по существующему токену (loginWithSession).
   * GET /api/auth с Bearer-токеном → извлечение claims.
   *
   * @param baseUrl Базовый URL сервера ELMA
   * @param token JWT-токен
   */
  async loginWithToken(
    baseUrl: string,
    token: string,
  ): Promise<SessionLoginResult> {
    try {
      const resp = await axios.get(`${baseUrl}/api/auth`, {
        headers: {Authorization: `Bearer ${token}`},
        withCredentials: false,
        timeout: 10000,
      });
      const claims = resp.data;
      let {userId, userName} = extractClaims(claims);

      // JWT fallback
      if (!userId && token && token.split('.').length === 3) {
        const payload = decodeJwtPayload(token);
        if (payload) {
          const jwt = extractClaims(payload);
          userId = jwt.userId;
          userName = jwt.userName || userName;
        }
      }

      return {ok: true, userId, userName};
    } catch {
      return {ok: false};
    }
  }

  /**
   * Обновить сессию аккаунта (refreshToken).
   * GET /guard/cookie с текущими cookies → новый токен.
   *
   * @param account Аккаунт для обновления сессии
   * @returns Результат рефреша (новый токен/cookies или ошибка)
   */
  async refreshSession(account: ElmaAccount): Promise<RefreshResult> {
    return refreshTokenWithCookies(account);
  }
}

/** Общий экземпляр менеджера сессий для всего приложения. */
export const sessionManager = new SessionManager();
