/**
 * Утилиты для работы с цветами.
 */

/**
 * Парсит hex-строку (#RGB, #RRGGBB) в {r, g, b}.
 * Возвращает null при невалидном формате.
 */
export function parseHex(hex: string): {r: number; g: number; b: number} | null {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
    return null;
  }
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

/**
 * Возвращает относительную яркость цвета по WCAG 2.0.
 * Значение от 0 (чёрный) до 1 (белый).
 */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) {
    return 0.5;
  }
  const [rr, gg, bb] = [c.r / 255, c.g / 255, c.b / 255].map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
}

/**
 * Контрастный цвет текста для заданного фона.
 * Возвращает '#000000' или '#FFFFFF' — тот, что даёт лучший контраст.
 */
export function contrastText(bgHex: string): string {
  return luminance(bgHex) > 0.4 ? '#000000' : '#FFFFFF';
}

/**
 * Смешивает цвет с белым (осветление) на заданную долю (0..1).
 * Возвращает hex-строку.
 */
export function mixWithWhite(hex: string, amount: number): string {
  const c = parseHex(hex);
  if (!c) {
    return hex;
  }
  const r = Math.round(c.r + (255 - c.r) * amount);
  const g = Math.round(c.g + (255 - c.g) * amount);
  const b = Math.round(c.b + (255 - c.b) * amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
