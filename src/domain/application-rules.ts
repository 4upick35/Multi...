/** Проверить, можно ли показать кнопку «Принять» для заявки */
export function canAccept(raw: Record<string, unknown>): boolean {
  // show_button_get_application === true
  const showBtn = raw.show_button_get_application;
  if (showBtn !== true && showBtn !== 'true') {
    return false;
  }

  // executor пустой (пустой массив или отсутствует)
  const executor = raw.executor;
  if (Array.isArray(executor) && executor.length > 0) {
    return false;
  }

  // __status.status === 1 (Новая)
  const status = raw.__status;
  if (status && typeof status === 'object') {
    const statusObj = status as Record<string, unknown>;
    if (statusObj.status !== 1 && statusObj.status !== '1') {
      return false;
    }
  }

  return true;
}
