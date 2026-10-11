/**
 * Приведение адреса сервера к виду `https://host[:port]`.
 *
 * Пользователь часто вставляет адрес, скопированный из браузера, вместе с путём
 * портала (например `https://elma.example.ru/_portal/customer_service/applications`).
 * Тогда запросы уходят не на корень сервера, а на страницу портала:
 * `POST /_portal/customer_service/guard/login` — страница не принимает POST,
 * и сервер отвечает 405 Method Not Allowed.
 *
 * Функция отбрасывает путь, query и хэш, оставляя только схему и хост.
 */
export function normalizeBaseUrl(input: string): string {
  let value = (input || '').trim();
  if (!value) {
    return '';
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  const match = value.match(/^(https?:\/\/[^/?#\s]+)/i);
  return match ? match[1] : '';
}

/** Проверка, что адрес сервера использует защищённый протокол https. */
export function isSecureBaseUrl(baseUrl: string): boolean {
  const value = (baseUrl || '').trim();
  if (!value) {
    return false;
  }
  const match = value.match(/^https:\/\/[^\/?#\s]+/i);
  return !!match;
}

/** Проверка, что внешнюю ссылку безопасно открывать системным способом. */
export function isSafeExternalUrl(url: string): boolean {
  const value = (url || '').trim();
  if (!value) {
    return false;
  }
  return /^(https:|tel:|mailto:|geo:)/i.test(value);
}
