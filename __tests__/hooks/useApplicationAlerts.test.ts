import {
  detectNewApplications,
  addSeenKeys,
  getAccountIdsWithNewItems,
} from '../../src/hooks/useApplicationAlerts';
import {loadSeenKeys, markSeenApplicationKey} from '../../src/services/seen-application-alerts';
import {CollectionItem} from '../../src/types/customer-service';

const makeItem = (id: string, name = `Item ${id}`): CollectionItem => ({
  id,
  name,
  status: 'active',
  createdAt: '2025-01-01T00:00:00Z',
  raw: {},
});

describe('detectNewApplications', () => {
  it('все items новы当 seen пуст — возвращает все', () => {
    const items = [makeItem('1'), makeItem('2'), makeItem('3')];
    const seen = new Set<string>();
    const result = detectNewApplications(items, seen, 'acc1');
    expect(result).toHaveLength(3);
  });

  it('первый снимок: хук помечает все id виденными без уведомлений', () => {
    // На уровне хука: если prevSnapshots не содержит accountId —
    // items помечаются как виденные, но уведомление не отправляется.
    // Чистая функция detectNewApplications не управляет этим —
    // она просто сравнивает со seen.
    // Этот сценарий покрывается интеграционно через getAccountIdsWithNewItems.
    const items = [makeItem('1'), makeItem('2')];
    const seen = new Set<string>();
    // Симулируем: помечаем все id как виденные (как делает хук при первом снимке)
    const newKeys = items.map((i) => `acc1::${i.id}`);
    const updatedSeen = addSeenKeys(seen, newKeys);
    // Повторный вызов — ничего нового
    const result = detectNewApplications(items, updatedSeen, 'acc1');
    expect(result).toHaveLength(0);
  });

  it('реально новый item даёт уведомление', () => {
    const items = [makeItem('1'), makeItem('2'), makeItem('3')];
    const seen = new Set(['acc1::1', 'acc1::2']);
    const result = detectNewApplications(items, seen, 'acc1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  it('повторный тот же id не даёт повторного уведомления', () => {
    const items = [makeItem('1'), makeItem('2')];
    const seen = new Set(['acc1::1', 'acc1::2']);
    const result = detectNewApplications(items, seen, 'acc1');
    expect(result).toHaveLength(0);
  });

  it('разные аккаунты независимы', () => {
    const items = [makeItem('1')];
    const seen = new Set(['acc2::1']);
    const result = detectNewApplications(items, seen, 'acc1');
    expect(result).toHaveLength(1);
  });
});

describe('addSeenKeys', () => {
  it('добавляет новые ключи', () => {
    const seen = new Set(['a']);
    const result = addSeenKeys(seen, ['b', 'c']);
    expect(result).toEqual(new Set(['a', 'b', 'c']));
  });

  it('не дублирует существующие ключи', () => {
    const seen = new Set(['a', 'b']);
    const result = addSeenKeys(seen, ['b', 'c']);
    expect(result).toEqual(new Set(['a', 'b', 'c']));
  });

  it('ограничивает размер до 500', () => {
    const seen = new Set(Array.from({length: 490}, (_, i) => `k${i}`));
    const newKeys = Array.from({length: 20}, (_, i) => `n${i}`);
    const result = addSeenKeys(seen, newKeys);
    expect(result.size).toBeLessThanOrEqual(500);
  });
});

describe('дедуп с realtime: пометка из markSeenApplicationKey видна опросу', () => {
  it('после markSeenApplicationKey(accountId, id) detectNewApplications не возвращает заявку', async () => {
    const accountId = 'acc-dup-realtime';
    const appItem = makeItem('22926', 'Новая заявка 22926');

    await markSeenApplicationKey(accountId, appItem.id);

    const seen = await loadSeenKeys();
    expect(detectNewApplications([appItem], seen, accountId)).toEqual([]);
    expect(detectNewApplications([appItem], await loadSeenKeys(), 'acc-other')).toHaveLength(1);
  });
});

describe('getAccountIdsWithNewItems', () => {
  it('пустые снимки — пустой результат', () => {
    const prev = new Map();
    const curr = new Map();
    expect(getAccountIdsWithNewItems(prev, curr)).toEqual([]);
  });

  it('первый снимок (нет prev) — пропускается', () => {
    const prev = new Map();
    const curr = new Map([['acc1', [makeItem('1')]]]);
    expect(getAccountIdsWithNewItems(prev, curr)).toEqual([]);
  });

  it('больше items — аккаунт в результате', () => {
    const prev = new Map([['acc1', [makeItem('1')]]]);
    const curr = new Map([['acc1', [makeItem('1'), makeItem('2')]]]);
    expect(getAccountIdsWithNewItems(prev, curr)).toEqual(['acc1']);
  });

  it('столько же items — аккаунт не в результате', () => {
    const prev = new Map([['acc1', [makeItem('1')]]]);
    const curr = new Map([['acc1', [makeItem('1')]]]);
    expect(getAccountIdsWithNewItems(prev, curr)).toEqual([]);
  });
});
