/**
 * Tests for CustomerServiceScreen logic:
 * - accessDenied=true with non-empty cache → card remains visible
 * - accessDenied=true with empty cache → card hidden
 */

import {useCustomerServiceStore} from '../../../src/store/customer-service-store';
import {CollectionKey} from '../../../src/types/customer-service';

beforeEach(() => {
  useCustomerServiceStore.setState({itemsByAccount: {}, syncStates: {}});
});

function accessibleCollections(visibleCollections: CollectionKey[], resolvedAccountId: string | null, accounts: {id: string}[], syncStates: Record<string, Record<string, {status: string; accessDenied?: boolean; total?: number}>>) {
  return visibleCollections.filter((col) => {
    if (resolvedAccountId) {
      const ss = syncStates[resolvedAccountId]?.[col];
      const items = useCustomerServiceStore.getState().getItems(resolvedAccountId, col);
      if (!ss || ss.status === 'idle' || ss.status === 'loading') return true;
      if (ss.accessDenied === true && items.length === 0) return false;
      return true;
    }
    const allDenied = accounts.length > 0 && accounts.every((acc) => {
      const ss = syncStates[acc.id]?.[col];
      const items = useCustomerServiceStore.getState().getItems(acc.id, col);
      if (!ss || ss.status === 'idle' || ss.status === 'loading') return false;
      if (ss.accessDenied === true && items.length === 0) return true;
      return ss.accessDenied === true;
    });
    return !allDenied;
  });
}

describe('accessibleCollections logic — accessDenied with cache', () => {
  it('accessDenied=true с непустым кэшем → коллекция видима', () => {
    useCustomerServiceStore.setState({
      itemsByAccount: {'acc-1': {'services': [{id: '1'} as any]}},
    });
    const syncStates = {'acc-1': {'services': {status: 'ok', accessDenied: true, total: 1, hasMore: false}}};
    const result = accessibleCollections(['services'] as any, 'acc-1', [{id: 'acc-1'}], syncStates);
    expect(result).toContain('services');
  });

  it('accessDenied=true с пустым кэшем → коллекция скрыта', () => {
    useCustomerServiceStore.setState({
      itemsByAccount: {'acc-1': {'services': []}},
    });
    const syncStates = {'acc-1': {'services': {status: 'ok', accessDenied: true, total: 0, hasMore: false}}};
    const result = accessibleCollections(['services'] as any, 'acc-1', [{id: 'acc-1'}], syncStates);
    expect(result).not.toContain('services');
  });

  it('accessDenied=false с элементами → коллекция видима', () => {
    useCustomerServiceStore.setState({
      itemsByAccount: {'acc-1': {'services': [{id: '1'} as any]}},
    });
    const syncStates = {'acc-1': {'services': {status: 'ok', accessDenied: false, total: 1, hasMore: false}}};
    const result = accessibleCollections(['services'] as any, 'acc-1', [{id: 'acc-1'}], syncStates);
    expect(result).toContain('services');
  });
});
