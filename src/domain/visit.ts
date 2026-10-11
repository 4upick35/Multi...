import {EXECUTION_FIELD_IDS, EXIT_CONFIRM_VISIT, LONG_KEY_PREFIX} from '../config/elma-constants';

/**
 * Выход «Подтвердить визит». Определяем и по UUID из HAR21, и по названию:
 * у другого шаблона идентификатор может быть иным, а отправлять такой выход
 * «пустым» нельзя — сервер ждёт код из СМС и отвечает ошибкой (вплоть до бана).
 */
export function isVisitExit(exit: {id: string; title?: string}): boolean {
  if (exit.id === EXIT_CONFIRM_VISIT) {
    return true;
  }
  const title = (exit.title || '').toLowerCase();
  return title.includes('подтверд') && title.includes('визит');
}

// ---------------------------------------------------------------------------
// Helper: extract instance from task
// ---------------------------------------------------------------------------

/** Возвращает instance-объект задачи (или пустой объект, если нет) */
export function getTaskInstance(task: Record<string, unknown> | null): Record<string, unknown> {
  if (!task || typeof task !== 'object') return {};
  const instance = (task as Record<string, unknown>).instance;
  return (instance && typeof instance === 'object') ? (instance as Record<string, unknown>) : {};
}

/** Является ли визит подтверждённым */
export function isVisitConfirmed(instance: Record<string, unknown>): boolean {
  return instance?.session_has_been_confirmed === true;
}

/**
 * Нуждается ли в подтверждении визита.
 *
 * Отметка «Без подтверждения визита» (`without_session_confirmation === true`)
 * снимает требование кода из СМС: мастер уже указал причину, поэтому
 * подтверждать визит повторно не нужно и кнопки формы не должны блокироваться.
 */
export function needsVisitConfirmation(instance: Record<string, unknown>): boolean {
  return (
    instance?.do_need_to_record_session === true &&
    instance?.session_has_been_confirmed !== true &&
    instance?.without_session_confirmation !== true
  );
}

/** На сервере уже отмечено «Без подтверждения визита» — код из СМС не нужен. */
export function isVisitWithoutConfirmation(instance: Record<string, unknown>): boolean {
  return instance?.without_session_confirmation === true;
}

/**
 * Длинные ключи полей визита для PUT /api/bpm/tasks/{uuid} (как HAR23).
 * Пустой объект — если задача не про фиксацию визита.
 */
export function buildVisitLongFields(instance: Record<string, unknown>): Record<string, unknown> {
  if (instance?.do_need_to_record_session !== true && instance?.without_session_confirmation !== true) {
    return {};
  }
  const raw: Record<string, unknown> = {
    session_confirmation_code:
      typeof instance.session_confirmation_code === 'string' ? instance.session_confirmation_code : '',
    send_sms_logs: instance.send_sms_logs ?? null,
    without_session_confirmation: instance.without_session_confirmation === true,
    reason_for_lack_of_confirmation: instance.reason_for_lack_of_confirmation ?? null,
  };
  const out: Record<string, unknown> = {};
  for (const [code, value] of Object.entries(raw)) {
    const fieldUuid = EXECUTION_FIELD_IDS[code];
    if (!fieldUuid) { continue; }
    out[`${LONG_KEY_PREFIX}.${fieldUuid}.${code}`] = value;
  }
  return out;
}
