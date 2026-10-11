import {normalizeBaseUrl, isSecureBaseUrl, isSafeExternalUrl} from '../../src/utils/url';

describe('normalizeBaseUrl', () => {
  it('оставляет голый домен без изменений', () => {
    expect(normalizeBaseUrl('https://elma.example.ru')).toBe(
      'https://elma.example.ru',
    );
  });

  it('обрезает путь портала — иначе login уходит на страницу портала и даёт 405', () => {
    expect(
      normalizeBaseUrl('https://elma.example.ru/_portal/customer_service/applications'),
    ).toBe('https://elma.example.ru');
  });

  it('обрезает query и хэш', () => {
    expect(normalizeBaseUrl('https://elma.example.ru/?x=1#frag')).toBe(
      'https://elma.example.ru',
    );
  });

  it('убирает завершающие слэши', () => {
    expect(normalizeBaseUrl('https://elma.example.ru///')).toBe('https://elma.example.ru');
  });

  it('подставляет https, если схема не указана', () => {
    expect(normalizeBaseUrl('elma.example.ru/_portal/customer_service')).toBe(
      'https://elma.example.ru',
    );
  });

  it('сохраняет порт', () => {
    expect(normalizeBaseUrl('http://192.168.1.10:8080/_portal/x')).toBe(
      'http://192.168.1.10:8080',
    );
  });

  it('возвращает пустую строку для пустого ввода', () => {
    expect(normalizeBaseUrl('   ')).toBe('');
  });
});

describe('isSecureBaseUrl', () => {
  it('https://elma.example.ru -> true', () => {
    expect(isSecureBaseUrl('https://elma.example.ru')).toBe(true);
  });

  it('https://elma.example.ru:8443 -> true', () => {
    expect(isSecureBaseUrl('https://elma.example.ru:8443')).toBe(true);
  });

  it('http://192.168.1.10:8080 -> false', () => {
    expect(isSecureBaseUrl('http://192.168.1.10:8080')).toBe(false);
  });

  it("'elma.example.ru' -> false", () => {
    expect(isSecureBaseUrl('elma.example.ru')).toBe(false);
  });

  it("'' -> false", () => {
    expect(isSecureBaseUrl('')).toBe(false);
  });
});

describe('isSafeExternalUrl', () => {
  it('https://yandex.ru/maps/?text=x -> true', () => {
    expect(isSafeExternalUrl('https://yandex.ru/maps/?text=x')).toBe(true);
  });

  it('tel:+10000000002 -> true', () => {
    expect(isSafeExternalUrl('tel:+10000000002')).toBe(true);
  });

  it('mailto:a@b.ru -> true', () => {
    expect(isSafeExternalUrl('mailto:a@b.ru')).toBe(true);
  });

  it('http://example.com -> false', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(false);
  });

  it('javascript:alert(1) -> false', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
  });

  it('file:///etc/passwd -> false', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
  });
});
