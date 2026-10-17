/**
 * Момент времени в UTC с обнулёнными секундами: `2026-10-01T17:20:00.000Z`.
 * Именно в таком виде сайт ELMA отправляет дату и время визита: уходит реальный
 * момент времени, а пользователю он показывается в локальном часовом поясе.
 */
export function formatUtcInstant(date: Date): string {
  const d = new Date(date.getTime());
  d.setSeconds(0, 0);
  return d.toISOString();
}

/** Компактное время HH:MM:SS (24ч, ведущие нули) */
export function formatTimeHMS(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

/**
 * DATETIME-поле «только время» (additionalType 'time'): локальные компоненты
 * (часы/минуты) упаковываются в литерал `1970-01-01THH:MM:00.000Z` —
 * «настенное» время без пересчёта в реальный момент UTC.
 */
export function toElmaTimeOnlyIso(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `1970-01-01T${p(date.getHours())}:${p(date.getMinutes())}:00.000Z`;
}

/**
 * DATE: локальные компоненты (год/месяц/день) → UTC-полночь того же
 * календарного дня: `2026-10-16T00:00:00.000Z` — дата не сдвигается
 * в другом часовом поясе.
 */
export function toElmaDateOnlyIso(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}
