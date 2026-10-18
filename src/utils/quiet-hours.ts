/**
 * Тихие часы: проверка попадания текущего момента в интервал [from, to].
 * Поддерживает переход через полночь (например, 22:00–07:00).
 * Если from === to — интервал пуст, весь день не считается тихим, возвращается false.
 * Некорректное время (не HH:MM) → false.
 */

const QUIET_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** HH:MM → минуты от полуночи; некорректное значение → null. */
function parseTime(value: string): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!QUIET_TIME_RE.test(trimmed)) {
    return null;
  }
  const hours = parseInt(trimmed.slice(0, 2), 10);
  const minutes = parseInt(trimmed.slice(3, 5), 10);
  return hours * 60 + minutes;
}

/**
 * true, если `now` попадает в тихий интервал [from, to).
 * Интервал через полночь: from > to — тихо с from до 24:00 и с 00:00 до to.
 * Границы: from включительно, to исключительно.
 */
export function isQuietHours(now: Date, from: string, to: string): boolean {
  const fromMin = parseTime(from);
  const toMin = parseTime(to);
  if (fromMin === null || toMin === null) {
    return false;
  }
  if (fromMin === toMin) {
    return false;
  }
  const current = now.getHours() * 60 + now.getMinutes();
  if (fromMin < toMin) {
    return current >= fromMin && current < toMin;
  }
  // Переход через полночь: [from, 24:00) ∪ [00:00, to)
  return current >= fromMin || current < toMin;
}
