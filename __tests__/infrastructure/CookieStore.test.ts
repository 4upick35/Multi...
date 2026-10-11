import {parseSetCookie, mergeCookies, extractCookiesFromResponse} from '../../src/infrastructure/CookieStore';

describe('parseSetCookie', () => {
  it('парсит одну cookie', () => {
    expect(parseSetCookie('session=abc123')).toBe('session=abc123');
  });

  it('парсит cookie с атрибутами (Path, Secure и т.д.)', () => {
    expect(parseSetCookie('session=abc123; Path=/; Secure; HttpOnly')).toBe('session=abc123');
  });

  it('парсит массив строк (множественные Set-Cookie)', () => {
    const result = parseSetCookie(['a=1; Path=/', 'b=2; Path=/']);
    expect(result).toBe('a=1; b=2');
  });

  it('возвращает пустую строку для undefined', () => {
    expect(parseSetCookie(undefined)).toBe('');
  });

  it('возвращает пустую строку для пустой строки', () => {
    expect(parseSetCookie('')).toBe('');
  });

  it('игнорирует пустые элементы массива', () => {
    expect(parseSetCookie(['a=1', '', 'b=2'])).toBe('a=1; b=2');
  });
});

describe('mergeCookies', () => {
  it('объединяет два набора cookie', () => {
    expect(mergeCookies('a=1; b=2', 'c=3')).toBe('a=1; b=2; c=3');
  });

  it('перезаписывает существующий ключ новым значением', () => {
    expect(mergeCookies('a=1; b=2', 'a=99')).toBe('a=99; b=2');
  });

  it('возвращает newCookies если existing undefined', () => {
    expect(mergeCookies(undefined, 'a=1')).toBe('a=1');
  });

  it('возвращает existing если newCookies пустая', () => {
    expect(mergeCookies('a=1', '')).toBe('a=1');
  });

  it('возвращает пустую строку если оба пустые', () => {
    expect(mergeCookies('', '')).toBe('');
  });
});

describe('extractCookiesFromResponse', () => {
  it('delegate к parseSetCookie', () => {
    expect(extractCookiesFromResponse('token=xyz')).toBe('token=xyz');
  });

  it('возвращает пустую строку для undefined', () => {
    expect(extractCookiesFromResponse(undefined)).toBe('');
  });
});
