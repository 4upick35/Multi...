/** Маскирование персональных данных и идентификаторов для логов и диагностики. */
export function maskValue(input: unknown): string {
  let s = input === undefined || input === null ? '' : String(input);
  // Email: user@domain -> us***@domain
  s = s.replace(/([A-Za-z0-9._%+-]{1,3})[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+)/g, '$1***$2');
  // UUID: оставляем первые 8 символов
  s = s.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, (m) => m.slice(0, 8) + '…');
  // Длинные токены/секреты (>=24 символов без пробелов) — оставляем первые 6 символов
  s = s.replace(/[A-Za-z0-9_\-\.]{24,}/g, (m) => m.slice(0, 6) + '…');
  return s;
}
