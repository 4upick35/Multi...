import {logDiag} from '../../diag/accept-log';
import {
  TEMPLATE_ID, FORM_CODE, FORM_VERSION,
  PROCESS_TEMPLATE_VERSION, EXIT_CONFIRM_VISIT,
} from '../../config/elma-constants';
import {
  getTaskInstance, isVisitConfirmed, isVisitWithoutConfirmation,
} from '../../domain/visit';
import {delay} from '../../native/KeepAlive';
import {ElmaAccount} from '../../types/account';
import {makeRequest, VISIT_WRITE_HEADERS} from './client';
import {
  fetchTaskById,
  fetchProcessTemplate,
  fetchFormDescriptor,
  fetchTaskInstanceData,
} from './tasks';

// ---------------------------------------------------------------------------
// sendVisitConfirmationCode — генерация СМС-кода
// ---------------------------------------------------------------------------

export interface SendCodeResult {
  ok: boolean;
  sendSmsLogs: string;
  context: Record<string, unknown>;
}

/**
 * Системные поля в начале `fields` — как в веб-клиенте (HAR21 entry 583).
 * `additionalType` лежит в `view.data` — именно так шлёт браузер.
 */
const SEND_CODE_SYSTEM_FIELDS: Record<string, unknown>[] = [
  {code: '__createdBy', type: 'SYS_USER', array: false, single: true, view: {system: true, name: 'Инициатор'}},
  {
    code: '__name',
    type: 'STRING',
    array: false,
    single: true,
    view: {system: true, name: 'Название', data: {additionalType: 'string'}},
  },
  {
    code: '__comment',
    type: 'STRING',
    array: false,
    single: true,
    view: {system: true, name: 'Комментарий', data: {additionalType: 'text'}},
  },
];

/** Поля подтверждения, без которых серверный sendCode не может отработать. */
const SEND_CODE_REQUIRED_FIELDS: {code: string; type: string; name: string}[] = [
  {code: 'code_for_comparison', type: 'STRING', name: 'Код для сравнения'},
  {code: 'session_confirmation_code', type: 'STRING', name: 'Код подтверждения визита'},
  {code: 'without_session_confirmation', type: 'BOOLEAN', name: 'Подтверждение без визита'},
  {code: 'reason_for_lack_of_confirmation', type: 'STRING', name: 'Причина отсутствия подтверждения'},
  {code: 'do_need_to_record_session', type: 'BOOLEAN', name: 'Нужна фиксация визита?'},
  {code: 'session_has_been_confirmed', type: 'BOOLEAN', name: 'Визит подтверждён'},
  {code: 'confirmation_error', type: 'STRING', name: 'Ошибка подтверждения'},
];

function asDescriptorList(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Record<string, unknown>[] = [];
  for (const item of raw) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      result.push(item as Record<string, unknown>);
    }
  }
  return result;
}

/**
 * Собрать `fields` для sendCode без потери структуры дескрипторов.
 * Порядок как в веб-клиенте: системные поля → поля контекста шаблона →
 * обязательные поля подтверждения (из формы или минимальные).
 */
function buildSendCodeFields(templateContext: unknown, formDescriptorFields: unknown): Record<string, unknown>[] {
  const fields: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const push = (descriptor: Record<string, unknown>): void => {
    const code = String(descriptor.code ?? '');
    if (!code || seen.has(code)) {
      return;
    }
    seen.add(code);
    fields.push(descriptor);
  };

  for (const descriptor of SEND_CODE_SYSTEM_FIELDS) {
    push(descriptor);
  }
  for (const descriptor of asDescriptorList(templateContext)) {
    push(descriptor);
  }

  const formByCode = new Map<string, Record<string, unknown>>();
  for (const descriptor of asDescriptorList(formDescriptorFields)) {
    const code = String(descriptor.code ?? '');
    if (code && !formByCode.has(code)) {
      formByCode.set(code, descriptor);
    }
  }
  for (const required of SEND_CODE_REQUIRED_FIELDS) {
    if (seen.has(required.code)) {
      continue;
    }
    const fromForm = formByCode.get(required.code);
    if (fromForm) {
      push(fromForm);
      continue;
    }
    push({
      code: required.code,
      type: required.type,
      array: false,
      single: true,
      view: {name: required.name},
    });
  }

  return fields;
}

/**
 * Отправить код подтверждения визита (func=sendCode).
 * Загружает шаблон и дескриптор формы лениво, кэширует per-account TTL 10 мин.
 */
export async function sendVisitConfirmationCode(
  account: ElmaAccount,
  params: {taskUuid: string; code: string; instance?: Record<string, unknown>},
): Promise<SendCodeResult> {
  try {
    const instanceData = params.instance
      ? params.instance
      : (params.taskUuid ? getTaskInstance((await fetchTaskById(account, params.taskUuid)).task) : {});
    const instanceTemplate = instanceData.__template as Record<string, unknown> | undefined;
    const templateVersion = Number(instanceTemplate?.version) || PROCESS_TEMPLATE_VERSION;
    const template = await fetchProcessTemplate(account, TEMPLATE_ID, templateVersion);
    // Версия формы — у формы, совпадающей с FORM_CODE: форм в шаблоне несколько,
    // forms[0] не обязательно наша (напр. form_69e70e96@1).
    const templateForms = Array.isArray(template.forms)
      ? (template.forms as Array<Record<string, unknown>>)
      : [];
    const matchedForm = templateForms.find(f => f && f.code === FORM_CODE);
    const matchedWidget = matchedForm?.widget as Record<string, unknown> | undefined;
    const formVersion = Number(matchedWidget?.version) || FORM_VERSION;
    const descriptor = await fetchFormDescriptor(account, 'customer_service.applications', FORM_CODE, formVersion);

    const descriptorFields = asDescriptorList((descriptor.descriptor as Record<string, unknown> | undefined)?.fields);
    const fields = buildSendCodeFields(template.context, descriptorFields);

    const context: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(instanceData)) {
      if (!String(k).startsWith('__fieldsData') && !String(k).startsWith('__tasks')) {
        context[k] = v;
      }
    }
    if (Array.isArray(context.applications)) {
      const applications = context.applications as unknown[];
      context.applications = applications.length > 0 ? applications[0] : null;
    }
    if (context.session_confirmation_code === undefined) {
      context.session_confirmation_code = null;
    }
    context.code_for_comparison = params.code;
    context.__validateResult = {kind: 'BlobObject'};

    const extraContexts = [{name: 'ViewContext', fields: descriptorFields}];

    const body = {
      namespace: 'customer_service.applications',
      code: FORM_CODE,
      version: formVersion,
      func: 'sendCode',
      args: [],
      fields,
      context,
      extraContexts,
    };

    const {data} = await makeRequest(account, 'post', '/api/widgets/execute', body, undefined, VISIT_WRITE_HEADERS);
    const resp = (data || {}) as {context?: unknown; send_sms_logs?: unknown};
    const respContext = resp.context && typeof resp.context === 'object'
      ? (resp.context as Record<string, unknown>)
      : {};
    const candidates = [resp.send_sms_logs, respContext.send_sms_logs];
    const found = candidates.find((v) => v !== undefined && v !== null && String(v).length > 0);
    const sendSmsLogs = found === undefined ? '' : String(found);

    if (!sendSmsLogs) {
      logDiag(
        'visit',
        `sendCode-empty-response fields=${fields.length} ctxKeys=${Object.keys(context).length}`,
      );
      return {
        ok: false,
        sendSmsLogs: 'Сервер не подтвердил отправку (пустой ответ)',
        context: respContext,
      };
    }

    return {
      ok: sendSmsLogs.startsWith('SUCCESS'),
      sendSmsLogs,
      context: respContext,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {ok: false, sendSmsLogs: msg.startsWith('ERROR:') || msg.startsWith('FUNCTION ERROR:') ? msg : `Ошибка: ${msg}`, context: {}};
  }
}

// ---------------------------------------------------------------------------
// confirmVisit — подтверждение визита
// ---------------------------------------------------------------------------

export interface ConfirmVisitResult {
  confirmed: boolean;
  instance: Record<string, unknown>;
}

/** Максимум перечитываний задачи при ожидании флага подтверждения. */
const CONFIRM_VISIT_POLL_ATTEMPTS = 6;
/** Пауза между перечитываниями задачи, мс (~9 секунд суммарно). */
const CONFIRM_VISIT_POLL_DELAY_MS = 1500;

/**
 * Подтвердить визит (PUT /api/bpm/tasks/{taskUuid}).
 * Тело содержит только короткие ключи + __exit EXIT_CONFIRM_VISIT.
 */
export async function confirmVisit(
  account: ElmaAccount,
  params: {taskUuid: string; instanceId: string; code: string; withoutConfirmation?: boolean; reason?: string; sendSmsLogs?: string},
): Promise<ConfirmVisitResult> {
  const body = {
    instanceId: params.instanceId,
    data: {
      session_confirmation_code: params.code,
      code_for_comparison: params.code,
      without_session_confirmation: params.withoutConfirmation || false,
      reason_for_lack_of_confirmation: params.reason || null,
      send_sms_logs: params.sendSmsLogs || null,
      __comment: null,
      __action: true,
      __skipSave: [],
      __exit: EXIT_CONFIRM_VISIT,
    },
  };

  const {data} = await makeRequest(account, 'put', `/api/bpm/tasks/${params.taskUuid}`, body, undefined, VISIT_WRITE_HEADERS);
  const responseData = (data as Record<string, unknown>) || {};
  let instance = responseData.instance
    ? (responseData.instance as Record<string, unknown>)
    : responseData;

  const withoutConfirmation = params.withoutConfirmation === true;
  const stateConfirmed = (inst: Record<string, unknown>): boolean =>
    isVisitConfirmed(inst) || (withoutConfirmation && isVisitWithoutConfirmation(inst));

  let confirmed = stateConfirmed(instance);

  // Сервер выставляет session_has_been_confirmed с задержкой (событийная
  // согласованность): PUT-ответ и немедленный GET отдают ста́рое состояние.
  // Подтверждение берём ТОЛЬКО с сервера — опрашиваем задачу, пока флаг не появится.
  for (let attempt = 0; !confirmed && attempt < CONFIRM_VISIT_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await delay(CONFIRM_VISIT_POLL_DELAY_MS);
    }
    const fresh = await fetchTaskInstanceData(account, params.taskUuid);
    if (fresh && Object.keys(fresh).length > 0) {
      instance = fresh;
      confirmed = stateConfirmed(fresh);
    }
  }

  return {confirmed, instance};
}
