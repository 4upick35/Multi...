/** Текст ошибки для лога/алерта: message у Error, иначе String(error). */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
