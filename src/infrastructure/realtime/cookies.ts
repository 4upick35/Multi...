/**
 * Имена cookie из строки вида `a=1; b=2` — только для диагностики.
 * Значения cookie в лог не попадают (безопасность).
 */
export function listCookieNames(cookies: string): string[] {
  const names: string[] = [];
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    const name = (separator === -1 ? part : part.slice(0, separator)).trim();
    if (name !== '') {
      names.push(name);
    }
  }
  return names;
}
