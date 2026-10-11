import {TtlCache} from '../../src/infrastructure/TtlCache';
import {cacheClearAccount} from '../../src/infrastructure/elma-cache';

describe('TtlCache', () => {
  let cache: TtlCache;

  beforeEach(() => {
    // Очищаем глобальный store перед каждым тестом
    cacheClearAccount('test-acc-1');
    cacheClearAccount('test-acc-2');
    cache = new TtlCache();
  });

  it('get возвращает undefined для несуществующего ключа', () => {
    expect(cache.get('test-acc-1', 'key1')).toBeUndefined();
  });

  it('set/get хранит и извлекает значение', () => {
    cache.set('test-acc-1', 'key1', 'hello', 60000);
    expect(cache.get('test-acc-1', 'key1')).toBe('hello');
  });

  it('has возвращает true для существующего ключа', () => {
    cache.set('test-acc-1', 'key1', 'val', 60000);
    expect(cache.has('test-acc-1', 'key1')).toBe(true);
  });

  it('has возвращает false для несуществующего ключа', () => {
    expect(cache.has('test-acc-1', 'nonexistent')).toBe(false);
  });

  it('get возвращает undefined после истечения TTL', () => {
    jest.useFakeTimers();
    cache.set('test-acc-1', 'key1', 'val', 1000);
    jest.advanceTimersByTime(1001);
    expect(cache.get('test-acc-1', 'key1')).toBeUndefined();
    jest.useRealTimers();
  });

  it('get возвращает значение до истечения TTL', () => {
    jest.useFakeTimers();
    cache.set('test-acc-1', 'key1', 'val', 1000);
    jest.advanceTimersByTime(999);
    expect(cache.get('test-acc-1', 'key1')).toBe('val');
    jest.useRealTimers();
  });

  it('delete удаляет ключ', () => {
    cache.set('test-acc-1', 'key1', 'val', 60000);
    cache.delete('test-acc-1', 'key1');
    expect(cache.get('test-acc-1', 'key1')).toBeUndefined();
  });

  it('clearAccount удаляет все ключи аккаунта', () => {
    cache.set('test-acc-1', 'k1', 'v1', 60000);
    cache.set('test-acc-1', 'k2', 'v2', 60000);
    cache.set('test-acc-2', 'k3', 'v3', 60000);
    cache.clearAccount('test-acc-1');
    expect(cache.has('test-acc-1', 'k1')).toBe(false);
    expect(cache.has('test-acc-1', 'k2')).toBe(false);
    expect(cache.has('test-acc-2', 'k3')).toBe(true);
  });

  it('ключи разных аккаунтов не конфликтуют', () => {
    cache.set('test-acc-1', 'key', 'val1', 60000);
    cache.set('test-acc-2', 'key', 'val2', 60000);
    expect(cache.get('test-acc-1', 'key')).toBe('val1');
    expect(cache.get('test-acc-2', 'key')).toBe('val2');
  });

  it('set перезаписывает значение по тому же ключу', () => {
    cache.set('test-acc-1', 'key', 'old', 60000);
    cache.set('test-acc-1', 'key', 'new', 60000);
    expect(cache.get('test-acc-1', 'key')).toBe('new');
  });
});
