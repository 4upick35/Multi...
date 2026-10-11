import {ElmaAccount} from '../../types/account';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// #22: docflow — PUT /api/docflow/search/target
// Документы на согласование/ознакомление (БЕЗ фонового поллинга!)
// ---------------------------------------------------------------------------

export interface DocflowItem {
  id: string;
  name: string;
  type?: string;
  status?: string;
  author?: string;
  createdAt?: string;
  raw: Record<string, unknown>;
}

export interface DocflowResult {
  approval: {lists: DocflowItem[] | null; total: number; archivedCount: number};
  inform: {lists: DocflowItem[] | null; total: number; archivedCount: number};
}

export async function fetchDocflowSearch(
  account: ElmaAccount,
): Promise<{docflow: DocflowResult | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'put',
      '/api/docflow/search/target',
      {},
    );
    const raw = data as Record<string, unknown>;
    const approval = (raw?.approval || {}) as Record<string, unknown>;
    const inform = (raw?.inform || {}) as Record<string, unknown>;
    const approvalLists = Array.isArray(approval.lists)
      ? (approval.lists as Record<string, unknown>[]).map(r => ({
          id: String(r.__id || r.id || ''),
          name: String(r.__name || r.name || ''),
          type: String(r.type || ''),
          status: String(r.status || r.state || ''),
          author: String(r.author || r.__createdBy || ''),
          createdAt: String(r.__createdAt || ''),
          raw: r,
        }))
      : [];
    const informLists = Array.isArray(inform.lists)
      ? (inform.lists as Record<string, unknown>[]).map(r => ({
          id: String(r.__id || r.id || ''),
          name: String(r.__name || r.name || ''),
          type: String(r.type || ''),
          status: String(r.status || r.state || ''),
          author: String(r.author || r.__createdBy || ''),
          createdAt: String(r.__createdAt || ''),
          raw: r,
        }))
      : [];
    const docflow: DocflowResult = {
      approval: {
        lists: approvalLists,
        total: Number(approval.total || 0),
        archivedCount: Number(approval.archivedCount || 0),
      },
      inform: {
        lists: informLists,
        total: Number(inform.total || 0),
        archivedCount: Number(inform.archivedCount || 0),
      },
    };
    return {docflow, updatedAccount};
  } catch {
    return {docflow: null};
  }
}
