import {STORAGE_KEYS} from '../../src/config/constants';

type SeenModule = typeof import('../../src/services/seen-application-alerts');
type StorageModule = typeof import('@react-native-async-storage/async-storage');

let seen: SeenModule;
let storage: StorageModule;

/**
 * Кеш модуля (`cache`/`loading`) — модульный, поэтому тесты изолируются через
 * jest.resetModules() + повторный require: свежий кеш и свежий storage-мок.
 */
function loadModule(): void {
  jest.resetModules();
  const storageRequired = require('@react-native-async-storage/async-storage') as
    | StorageModule
    | {default: StorageModule};
  storage = ('default' in storageRequired
    ? storageRequired.default
    : storageRequired) as StorageModule;
  seen = require('../../src/services/seen-application-alerts') as SeenModule;
}

async function readStoredKeys(): Promise<string[]> {
  const raw = await storage.getItem(STORAGE_KEYS.seenApplicationAlerts);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

beforeEach(() => {
  loadModule();
});

describe('seen-application-alerts', () => {
  it('persistSeenKeys → loadSeenKeys roundtrip', async () => {
    seen.persistSeenKeys(new Set(['acc-1::a', 'acc-1::b']));

    expect(await seen.loadSeenKeys()).toEqual(new Set(['acc-1::a', 'acc-1::b']));
  });

  it('loadSeenKeys из пустого storage → пустое множество', async () => {
    expect(await seen.loadSeenKeys()).toEqual(new Set());
  });

  it('persistSeenKeys ограничивает размер лимитом 500', async () => {
    const big = new Set(
      Array.from({length: seen.MAX_SEEN_KEYS + 50}, (_, i) => `acc-1::${i}`),
    );

    seen.persistSeenKeys(big);

    expect((await readStoredKeys()).length).toBe(seen.MAX_SEEN_KEYS);
  });

  it('clearSeenApplicationAlertsForAccount чистит только ключи своего аккаунта', async () => {
    seen.persistSeenKeys(new Set(['acc::1', 'acc::2', 'acc2::1', 'acc3::x']));

    await seen.clearSeenApplicationAlertsForAccount('acc');

    expect(await seen.loadSeenKeys()).toEqual(new Set(['acc2::1', 'acc3::x']));
    expect(await readStoredKeys()).toEqual(['acc2::1', 'acc3::x']);
  });

  it("id одного аккаунта — префикс другого: 'acc2' не задет при очистке 'acc'", async () => {
    seen.persistSeenKeys(new Set(['acc::1', 'acc2::1', 'acc2::2']));

    await seen.clearSeenApplicationAlertsForAccount('acc');

    const remaining = await seen.loadSeenKeys();
    expect(remaining.has('acc::1')).toBe(false);
    expect(remaining.has('acc2::1')).toBe(true);
    expect(remaining.has('acc2::2')).toBe(true);
  });

  it('очистка аккаунта без ключей не переписывает хранилище', async () => {
    seen.persistSeenKeys(new Set(['acc2::1']));
    const before = await storage.getItem(STORAGE_KEYS.seenApplicationAlerts);

    await seen.clearSeenApplicationAlertsForAccount('acc');

    expect(await storage.getItem(STORAGE_KEYS.seenApplicationAlerts)).toBe(before);
    expect(await seen.loadSeenKeys()).toEqual(new Set(['acc2::1']));
  });

  it('очистка последнего аккаунта оставляет пустое хранилище', async () => {
    seen.persistSeenKeys(new Set(['acc::1']));

    await seen.clearSeenApplicationAlertsForAccount('acc');

    expect(await seen.loadSeenKeys()).toEqual(new Set());
    expect(await readStoredKeys()).toEqual([]);
  });
});

describe('seen-application-alerts — единый источник в памяти', () => {
  it('два вызова loadSeenKeys() возвращают ОДИН И ТОТ ЖЕ экземпляр Set', async () => {
    const first = await seen.loadSeenKeys();
    const second = await seen.loadSeenKeys();

    expect(second).toBe(first);
  });

  it('параллельные первые вызовы делят один промис чтения', async () => {
    const firstPromise = seen.loadSeenKeys();
    const secondPromise = seen.loadSeenKeys();

    expect(secondPromise).toBe(firstPromise);

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(second).toBe(first);
  });

  it('мутация возвращенного множества видна последующим loadSeenKeys()', async () => {
    const loaded = await seen.loadSeenKeys();
    loaded.add('acc-1::mutated');

    expect(await seen.loadSeenKeys()).toContain('acc-1::mutated');
  });

  it('markSeenApplicationKey(a, id) → последующий loadSeenKeys() содержит ключ a::id', async () => {
    await seen.markSeenApplicationKey('acc-1', 'item-1');

    expect(await seen.loadSeenKeys()).toContain('acc-1::item-1');
    expect(await readStoredKeys()).toContain('acc-1::item-1');
  });

  it('markSeenApplicationKey пишет в ТОТ ЖЕ экземпляр, что получает loadSeenKeys (нет дубля)', async () => {
    const before = await seen.loadSeenKeys();

    await seen.markSeenApplicationKey('acc-1', 'item-2');

    expect(await seen.loadSeenKeys()).toBe(before);
    expect(before.has('acc-1::item-2')).toBe(true);
  });

  it('markSeenApplicationKey с пустыми accountId/id — no-op', async () => {
    await seen.markSeenApplicationKey('', 'item-3');
    await seen.markSeenApplicationKey('acc-1', '');

    expect(await seen.loadSeenKeys()).toEqual(new Set());
    expect(await readStoredKeys()).toEqual([]);
  });

  it('persistSeenKeys обновляет кеш: после него loadSeenKeys() содержит записанные ключи', async () => {
    await seen.loadSeenKeys();

    seen.persistSeenKeys(new Set(['acc-9::a', 'acc-9::b']));

    expect(await seen.loadSeenKeys()).toEqual(new Set(['acc-9::a', 'acc-9::b']));
  });

  it('clearSeenApplicationAlertsForAccount работает с общим множеством', async () => {
    await seen.markSeenApplicationKey('acc', '1');
    await seen.markSeenApplicationKey('acc', '2');
    await seen.markSeenApplicationKey('acc2', '1');
    const shared = await seen.loadSeenKeys();

    await seen.clearSeenApplicationAlertsForAccount('acc');

    expect(await seen.loadSeenKeys()).toBe(shared);
    expect(Array.from(shared)).toEqual(['acc2::1']);
    expect(await readStoredKeys()).toEqual(['acc2::1']);
  });
});
