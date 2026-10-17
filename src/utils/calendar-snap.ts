export type CalendarSnap = {
  /** На сколько дней сдвинуться от текущего anchor. */
  daysMoved: number;
  /** Базовое X полосы для сброса после анимации. */
  targetX: number;
};

/**
 * Snap при отпускании/терминации драга полосы дней календаря:
 * текущий X переводится в «целые» дни (округление к ближайшему), clamp
 * удерживает позицию в пределах полосы с буфером `dayBuffer` слева и справа.
 * Чистая функция — без побочных эффектов, покрывается unit-тестами.
 */
export function computeSnap(
  currentX: number,
  dayW: number,
  period: number,
  dayBuffer: number,
): CalendarSnap {
  const stripLen = period + 2 * dayBuffer;
  const kFloat = -currentX / dayW;
  const kRounded = Math.max(0, Math.min(stripLen - period, Math.round(kFloat)));
  return {
    daysMoved: kRounded - dayBuffer,
    // 0 - … вместо -…: при kRounded=0 это даёт +0, а не -0 (toEqual различает их)
    targetX: 0 - kRounded * dayW,
  };
}
