// ---------------------------------------------------------------------------
// Менеджер cookie: парсинг set-cookie заголовков и мерж cookie-строк.
// Инкапсулирует логику из elma-api.ts (строки 228-270).
// НЕ изменяет поведение — точная копия существующей логики.
// ---------------------------------------------------------------------------

/**
 * Парсинг заголовка set-cookie из HTTP-ответа.
 * Поддерживает как строку, так и массив строк (множественные Set-Cookie).
 * Извлекает только пары ключ=значение (без атрибутов типа Path, Secure и т.д.).
 *
 * @param setCookieHeader Значение заголовка Set-Cookie (строка, массив или undefined).
 * @returns Строка cookie в формате "key1=val1; key2=val2".
 */
export function parseSetCookie(
  setCookieHeader: string | string[] | undefined,
): string {
  if (!setCookieHeader) {
    return '';
  }
  const raws = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : [setCookieHeader];
  const pairs: string[] = [];
  for (const raw of raws) {
    const main = raw.split(';')[0].trim();
    if (main) {
      pairs.push(main);
    }
  }
  return pairs.join('; ');
}

/**
 * Мерж двух cookie-строк. Новые значения перезаписывают старые при совпадении ключей.
 *
 * @param existing Текущая cookie-строка аккаунта.
 * @param newCookies Новые cookie из HTTP-ответа.
 * @returns Объединённая cookie-строка.
 */
export function mergeCookies(
  existing: string | undefined,
  newCookies: string,
): string {
  if (!newCookies) {
    return existing || '';
  }
  if (!existing) {
    return newCookies;
  }
  const map = new Map<string, string>();
  for (const pair of existing.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k) {
      map.set(k.trim(), rest.join('='));
    }
  }
  for (const pair of newCookies.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k) {
      map.set(k.trim(), rest.join('='));
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Извлечь cookie из HTTP-ответа (обёртка над parseSetCookie).
 *
 * @param setCookieHeader Заголовок Set-Cookie из ответа.
 * @returns Строка cookie.
 */
export function extractCookiesFromResponse(
  setCookieHeader: string | string[] | undefined,
): string {
  return parseSetCookie(setCookieHeader);
}
