import {AccountRegistry} from '../../src/infrastructure/AccountRegistry';
import type {ElmaAccount} from '../../src/types/account';

function makeAccount(id: string): ElmaAccount {
  return {
    id,
    name: id,
    baseUrl: 'https://elma.example',
    portal: 'example',
    token: `token-${id}`,
    userId: `user-${id}`,
    color: '#123456',
    isActive: true,
  };
}

function makeRegistry(ids: string[]): AccountRegistry {
  const registry = new AccountRegistry();
  ids.forEach(id => registry.add(makeAccount(id)));
  return registry;
}

function idsOf(registry: AccountRegistry): string[] {
  return registry.getAll().map(account => account.id);
}

describe('AccountRegistry.reorder', () => {
  it('переставляет аккаунты в заданном порядке', () => {
    const registry = makeRegistry(['a', 'b', 'c']);

    registry.reorder(['c', 'a', 'b']);

    expect(idsOf(registry)).toEqual(['c', 'a', 'b']);
  });

  it('игнорирует неизвестные id', () => {
    const registry = makeRegistry(['a', 'b']);

    registry.reorder(['ghost', 'b', 'a']);

    expect(idsOf(registry)).toEqual(['b', 'a']);
  });

  it('оставляет неперечисленные аккаунты в конце в прежнем порядке', () => {
    const registry = makeRegistry(['a', 'b', 'c', 'd']);

    registry.reorder(['d']);

    expect(idsOf(registry)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('не теряет аккаунты при дубликатах в списке', () => {
    const registry = makeRegistry(['a', 'b']);

    registry.reorder(['b', 'b', 'a']);

    expect(idsOf(registry)).toEqual(['b', 'a']);
    expect(registry.size).toBe(2);
  });

  it('сохраняет данные аккаунтов после перестановки', () => {
    const registry = makeRegistry(['a', 'b']);

    registry.reorder(['b', 'a']);

    expect(registry.get('b')?.token).toBe('token-b');
    expect(registry.get('a')?.token).toBe('token-a');
  });
});
