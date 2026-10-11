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
