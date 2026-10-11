import {ElmaAccount} from '../../types/account';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// Public API: feedChannels — GET /api/feed/channels/active
// ---------------------------------------------------------------------------

export async function feedChannels(
  account: ElmaAccount,
): Promise<{channels: unknown[]; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/feed/channels/active',
      undefined,
      {offset: 0, limit: 40},
    );
    const resp = data as {result?: unknown[]} | undefined;
    return {channels: resp?.result || (Array.isArray(data) ? data : []), updatedAccount};
  } catch {
    return {channels: []};
  }
}

// ---------------------------------------------------------------------------
// Public API: feedMessages — GET /api/feed/messages/feed
// ---------------------------------------------------------------------------

export async function feedMessages(
  account: ElmaAccount,
  offset: number = 0,
): Promise<{messages: unknown[]; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/feed/messages/feed',
      undefined,
      {limit: 20, offset, condition: ''},
    );
    const resp = data as {result?: unknown[]} | undefined;
    return {messages: resp?.result || (Array.isArray(data) ? data : []), updatedAccount};
  } catch {
    return {messages: []};
  }
}

// ---------------------------------------------------------------------------
// Public API: feedTargetsUnread — GET /api/feed/targets/unread
// ---------------------------------------------------------------------------

export async function feedTargetsUnread(
  account: ElmaAccount,
): Promise<{targets: unknown[]; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/feed/targets/unread',
    );
    const resp = data as {result?: unknown[]} | undefined;
    return {targets: resp?.result || (Array.isArray(data) ? data : []), updatedAccount};
  } catch {
    return {targets: []};
  }
}
