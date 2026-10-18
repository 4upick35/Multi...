/** Текст ошибки для лога/алерта: message у Error, иначе String(error). */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Ошибка сетевого типа по тексту сообщения: обрыв связи, таймаут,
 * недоступность сервера. Такую ошибку нельзя считать отказом сервера —
 * действие имеет смысл отложить и повторить позже.
 */
const NETWORK_ERROR_RE = /network|сети|timeout|времени ожидания/i;

export function isNetworkErrorText(text: string | null | undefined): boolean {
  return NETWORK_ERROR_RE.test(text || '');
}
