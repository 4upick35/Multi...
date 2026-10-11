/**
 * Генератор UUID v4 без внешних зависимостей.
 * Соответствует RFC 4122: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */

/** Криптографически стойкий генератор случайных байтов */
function getRandomBytes(length: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint8Array(length);
    globalThis.crypto.getRandomValues(buf);
    return buf;
  }
  // Fallback для тестов / NodeJS < 19
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/** Соответствует ли строка формату UUID (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Проверяет, что значение — UUID (любая версия, RFC 4122).
 * Используется как защита от отправки на сервер выдуманных
 * не-UUID идентификаторов выходов задач.
 */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Генерирует UUID v4 (36 символов, xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx) */
export function uuidv4(): string {
  const bytes = getRandomBytes(16);

  // Нормализуем версию (4) и вариант (10xx)
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
