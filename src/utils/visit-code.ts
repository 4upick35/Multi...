/**
 * Утилиты для генерации и валидации 4-значного СМС-кода визита.
 * Спецификация HAR21: String(Math.round(1000 + Math.random()*9000)).
 */

/** Сгенерировать 4-значный код (1000..9999) */
export function generateVisitCode(): string {
  // Math.round(1000 + 9000) = 10000 — обрезаем, иначе код из 5 цифр
  // не пройдёт validateVisitCode.
  return String(Math.min(9999, Math.round(1000 + Math.random() * 9000)));
}

/** Проверить, что код — ровно 4 цифры */
export function validateVisitCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}
