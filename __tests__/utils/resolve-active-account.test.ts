import {resolveActiveAccountId} from '../../src/utils/resolve-active-account';
import type {ElmaAccount} from '../../src/types/account';

function makeAccount(id: string): ElmaAccount {
  return {
    id,
    name: `Account ${id}`,
    baseUrl: 'https://example.com',
    portal: 'customer_service',
    token: '',
    userId: '',
    color: '#000',
    isActive: true,
  };
}

describe('resolveActiveAccountId', () => {
  const acc1 = makeAccount('a1');
  const acc2 = makeAccount('a2');

  it('возвращает activeAccountId, если он есть в списке', () => {
    expect(resolveActiveAccountId([acc1, acc2], 'a2')).toBe('a2');
  });

  it('возвращает первый аккаунт, если activeAccountId не задан', () => {
    expect(resolveActiveAccountId([acc1, acc2], null)).toBe('a1');
  });

  it('возвращает первый аккаунт, если activeAccountId не найден в списке', () => {
    expect(resolveActiveAccountId([acc1, acc2], 'deleted-id')).toBe('a1');
  });

  it('возвращает null, если.accounts пуст', () => {
    expect(resolveActiveAccountId([], null)).toBeNull();
  });

  it('возвращает null, если.accounts пуст даже с activeAccountId', () => {
    expect(resolveActiveAccountId([], 'a1')).toBeNull();
  });

  it('возвращает первый аккаунт, если activeAccountId относится к другому режиму', () => {
    const masterAccounts = [makeAccount('m1')];
    expect(resolveActiveAccountId(masterAccounts, 'shop-id')).toBe('m1');
  });
});
