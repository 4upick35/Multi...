export interface CaptchaKeysLike {
  siteKey?: string | null;
  secretKey?: string | null;
}

/** Требует ли сервер капчу: да, только если получен непустой site_key. */
export function isCaptchaRequired(keys: CaptchaKeysLike | null | undefined): boolean {
  return keys != null && String(keys.siteKey || '').trim() !== '';
}

/**
 * Есть ли в дескрипторе формы виджет-капча.
 * Если в форме капчи нет, сервер её не запрашивает — виджет показывать не нужно
 * (даже если ключи пришли непустыми).
 * При невозможности разобрать дескриптор возвращает true (безопасный вариант).
 */
export function hasCaptchaWidget(descriptor: unknown): boolean {
  if (descriptor == null) {
    return true;
  }
  try {
    const text = JSON.stringify(descriptor);
    if (!text) {
      return true;
    }
    return /captcha|site_key|siteKey/i.test(text);
  } catch {
    return true;
  }
}
