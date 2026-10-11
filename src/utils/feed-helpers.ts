// ---------------------------------------------------------------------------
// feed-helpers.ts — Утилиты для обработки сообщений ленты.
// ---------------------------------------------------------------------------

/** Паттерн для поиска «Появилась новая заявка» (регистронезависимо) */
const NEW_APPLICATION_PATTERN = /появилась\s+новая\s+заявка/i;

/** Паттерн для извлечения номера заявки — ищем цифры после ключевой фразы */
const APPLICATION_NUMBER_PATTERN = /появилась\s+новая\s+заявка\s+(\d{3,5})/i;

/**
 * Проверить, является ли сообщение уведомлением о новой заявке.
 */
export function isNewApplicationMessage(text: string): boolean {
  return NEW_APPLICATION_PATTERN.test(text);
}

/**
 * Извлечь номер заявки из текста сообщения.
 * Ищет последовательность из 3-5 цифр после «Появилась новая заявка».
 * Если номер не найден — возвращает null.
 */
export function extractApplicationNumber(text: string): string | null {
  const match = text.match(APPLICATION_NUMBER_PATTERN);
  if (match && match[1]) {
    return match[1];
  }
  return null;
}
