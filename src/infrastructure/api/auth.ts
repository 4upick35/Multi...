import axios from 'axios';
import {ElmaAccount} from '../../types/account';
import {sessionManager} from '../SessionManager';

// ---------------------------------------------------------------------------
// Token refresh — делегируется SessionManager
// ---------------------------------------------------------------------------

// Keep refreshToken wrapper for backward compat with external callers
async function refreshToken(
  baseUrl: string,
  account?: ElmaAccount,
): Promise<{ok: boolean; token?: string}> {
  if (account) {
    return sessionManager.refreshSession(account);
  }
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

// ---------------------------------------------------------------------------
// Public API: loginToElma
// ---------------------------------------------------------------------------

export async function loginToElma(
  baseUrl: string,
  portal: string,
  email: string,
  password: string,
): Promise<{
  ok: boolean;
  token?: string;
  userId?: string;
  userName?: string;
  error?: string;
  cookies?: string;
  userKind?: 'default' | 'portal';
  privileges?: string[];
  isPortal?: boolean;
}> {
  return sessionManager.login(baseUrl, portal, email, password);
}

// ---------------------------------------------------------------------------
// Public API: loginWithSession
// ---------------------------------------------------------------------------

export async function loginWithSession(
  baseUrl: string,
  token: string,
): Promise<{ok: boolean; userId?: string; userName?: string}> {
  return sessionManager.loginWithToken(baseUrl, token);
}

// ---------------------------------------------------------------------------
// Public API: refreshToken (standalone, kept for external callers)
// ---------------------------------------------------------------------------

export {refreshToken as refreshTokenStandalone};
