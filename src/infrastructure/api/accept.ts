import {ElmaAccount} from '../../types/account';
import {uuidv4} from '../../utils/uuid';
import {makeRequest} from './client';
import {parseBpmTemplate} from './bpm';
import type {AcceptTemplate} from './bpm';
import {hasCaptchaWidget} from '../../utils/captcha';
import {
  getCachedAcceptTemplate,
  setCachedAcceptTemplate,
} from '../../services/accept-template-cache';

// ===========================================================================
// Accept Application Flow: captcha + BPM run
// ===========================================================================

/** Результат получения ключей капчи */
export interface CaptchaKeys {
  siteKey: string;
  secretKey: string;
}

/** Результат проверки капчи */
export interface CaptchaVerifyResult {
  result: boolean;
  debug: string;
}

/** Параметры принятия заявки */
export interface AcceptApplicationParams {
  templateId: string;
  templateVersion: number;
  applicationId: string;
  formCode: string;
  token: string;
  siteKey: string;
  secretKey: string;
  debug: string;
}

/**
 * Получить шаблон accept_application с formCode, formVersion и contextFields.
 * GET /api/bpm/templates/public/byCode/customer_service.applications/accept_application?lastVersion=true
 */
export async function getAcceptTemplate(
  account: ElmaAccount,
  options?: {forceRefresh?: boolean},
): Promise<{template: AcceptTemplate | null; updatedAccount?: Partial<ElmaAccount>; fromCache?: boolean}> {
  // Попытка взять из кэша (если не принудительное обновление)
  if (!options?.forceRefresh) {
    try {
      const cached = await getCachedAcceptTemplate(account.id);
      if (cached) {
        return {template: cached, updatedAccount: undefined, fromCache: true};
      }
    } catch {
      // Тихо — кэш не должен ломать приём заявки
    }
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/bpm/templates/public/byCode/customer_service.applications/accept_application',
      undefined,
      {lastVersion: 'true'},
    );
    const raw = data as Record<string, unknown>;
    const template = parseBpmTemplate(raw);

    // Сохранить в кэш при успехе
    if (template) {
      setCachedAcceptTemplate(account.id, template).catch(() => {});
    }

    return {template, updatedAccount};
  } catch {
    return {template: null};
  }
}

/**
 * Дескрипторы полей ViewContext для extraContexts (фиксированные, из HAR9).
 */
const VIEW_CONTEXT_FIELDS: unknown[] = [
  {code: 'token', type: 'STRING', array: false, single: true, view: {system: true, name: 'Token'}},
  {code: 'result', type: 'BOOLEAN', array: false, single: true, view: {system: true, name: 'Result'}},
  {code: 'site_key', type: 'STRING', array: false, single: true, view: {system: true, name: 'Site Key'}},
  {code: 'secret_key', type: 'STRING', array: false, single: true, view: {system: true, name: 'Secret Key'}},
];

/**
 * Голова fields (3 системных дескриптора, всегда первыми).
 */
const HEAD_FIELDS: unknown[] = [
  {code: '__createdBy', type: 'SYS_USER', array: false, single: true, view: {system: true, name: 'Инициатор'}},
  {code: '__name', type: 'STRING', array: false, single: true, view: {system: true, name: 'Название', data: {additionalType: 'string'}}},
  {code: '__comment', type: 'STRING', array: false, single: true, view: {system: true, name: 'Комментарий', data: {additionalType: 'text'}}},
];

/**
 * Хвост fields (5 системных дескриптора, всегда последними).
 */
const TAIL_FIELDS: unknown[] = [
  {code: '__target', type: 'STRING', required: false, single: true, array: false, data: {additionalType: 'text'}, view: {tooltip: '', hidden: false, name: ''}},
  {code: '__targetData', type: 'JSON', required: false, single: true, array: false, data: {additionalType: 'text'}, view: {tooltip: '', hidden: false, name: ''}},
  {code: '__item', type: 'REF_ITEM', required: false, single: true, array: false, view: {tooltip: '', hidden: false, name: ''}},
  {code: '__parentId', type: 'STRING', required: false, single: true, array: false, view: {tooltip: '', hidden: false, name: ''}},
  {code: '__subtasks', type: 'JSON', view: {}},
];

/**
 * Собрать context (values) для RPC: ключи из всех полей, значения null,
 * затем переопределить специальные ключи.
 * validateResult: для init — null, для run — {kind:'BlobObject'}.
 * Общий helper — используется также flow'ом назначения визита (init).
 */
export function buildCaptchaContext(
  contextFields: unknown[],
  applicationId: string,
  validateResult?: unknown,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};

  // Все ключи из дескрипторов = null
  for (const desc of [HEAD_FIELDS, contextFields, TAIL_FIELDS].flat()) {
    const d = desc as Record<string, unknown>;
    ctx[String(d.code)] = null;
  }

  // Переопределения
  ctx.applications = [applicationId];
  ctx.type_of_event = [];
  ctx.is_auto = false;
  ctx.__item = {namespace: 'customer_service', code: 'applications', id: applicationId};
  ctx.__validateResult = validateResult !== undefined ? validateResult : {kind: 'BlobObject'};

  return ctx;
}

/**
 * Собрать fields массив: голова + contextFields + хвост.
 * Общий helper — используется также flow'ом назначения визита (init).
 */
export function buildCaptchaFields(contextFields: unknown[]): unknown[] {
  return [...HEAD_FIELDS, ...contextFields, ...TAIL_FIELDS];
}

/**
 * Получить дескрипторы полей формы (ViewContext) через виджет API.
 * GET /api/widgets/public/customer_service.applications/{formCode}/{formVersion}
 */
export async function getCaptchaFormFields(
  account: ElmaAccount,
  formCode: string,
  formVersion: number,
): Promise<{fields: unknown[]; hasCaptcha: boolean; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/widgets/public/customer_service.applications/${formCode}/${formVersion}`,
    );
    const raw = data as Record<string, unknown>;
    const descriptor = raw.descriptor as Record<string, unknown> | undefined;
    const fields = Array.isArray(descriptor?.fields) ? descriptor!.fields : [];
    // Признак наличия виджета-капчи ищем во всём ответе дескриптора.
    return {fields, hasCaptcha: hasCaptchaWidget(raw), updatedAccount};
  } catch {
    return {fields: [], hasCaptcha: true};
  }
}

/**
 * Получить ключи reCAPTCHA (site_key, secret_key) через getKey RPC.
 * POST /api/widgets/execute
 * Пустой siteKey означает, что сервер капчу не требует.
 */
export async function getCaptchaKeys(
  account: ElmaAccount,
  formCode: string,
  formVersion: number,
  contextFields: unknown[],
  viewContextFields: unknown[],
  applicationId: string,
): Promise<{keys: CaptchaKeys | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const body = {
      namespace: 'customer_service.applications',
      code: formCode,
      version: formVersion,
      func: 'getKey',
      args: [],
      fields: buildCaptchaFields(contextFields),
      context: buildCaptchaContext(contextFields, applicationId),
      extraContexts: [{
        name: 'ViewContext',
        fields: viewContextFields.length > 0 ? viewContextFields : VIEW_CONTEXT_FIELDS,
        value: {token: null, result: null, site_key: null, secret_key: null},
      }],
    };
    const {data, updatedAccount} = await makeRequest(account, 'post', '/api/widgets/execute', body);
    const resp = data as {extraContexts?: Record<string, Record<string, unknown>>} | undefined;
    const viewCtx = resp?.extraContexts?.ViewContext;
    const siteKey = String(viewCtx?.site_key || '');
    const secretKey = String(viewCtx?.secret_key || '');
    return {keys: {siteKey, secretKey}, updatedAccount};
  } catch {
    return {keys: null};
  }
}

/**
 * Проверить reCAPTCHA токен на сервере ELMA через checkResponseFromCaptchaServer RPC.
 * POST /api/widgets/execute
 */
export async function verifyCaptchaToken(
  account: ElmaAccount,
  formCode: string,
  formVersion: number,
  token: string,
  siteKey: string,
  secretKey: string,
  contextFields: unknown[],
  viewContextFields: unknown[],
  applicationId: string,
): Promise<{verify: CaptchaVerifyResult | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const body = {
      namespace: 'customer_service.applications',
      code: formCode,
      version: formVersion,
      func: 'checkResponseFromCaptchaServer',
      args: [],
      fields: buildCaptchaFields(contextFields),
      context: buildCaptchaContext(contextFields, applicationId),
      extraContexts: [{
        name: 'ViewContext',
        fields: viewContextFields.length > 0 ? viewContextFields : VIEW_CONTEXT_FIELDS,
        value: {token, result: null, site_key: siteKey, secret_key: secretKey},
      }],
    };
    const {data, updatedAccount} = await makeRequest(account, 'post', '/api/widgets/execute', body);
    const resp = data as {
      extraContexts?: Record<string, Record<string, unknown>>;
      context?: Record<string, unknown>;
    } | undefined;
    const viewCtx = resp?.extraContexts?.ViewContext;
    const result = viewCtx?.result === true;
    const debug = String(resp?.context?.debug || '');
    return {verify: {result, debug}, updatedAccount};
  } catch {
    return {verify: null};
  }
}

/**
 * Запустить BPM-процесс accept_application (PUT .../run).
 * Генерирует __runHash на клиенте.
 */
export async function acceptApplication(
  account: ElmaAccount,
  params: AcceptApplicationParams,
): Promise<{ok: boolean; error?: string; updatedAccount?: Partial<ElmaAccount>}> {
  const ns = 'customer_service.applications';
  const prefix = `${ns}.${params.formCode}/popover`;
  const runHash = uuidv4();

  const body: Record<string, unknown> = {
    is_auto: false,
    __item: {namespace: 'customer_service', code: 'applications', id: params.applicationId},
    applications: [params.applicationId],
    debug: params.debug,
    type_of_event: [],
    __validateResult: {kind: 'BlobObject'},
    [`${prefix}.token`]: params.token,
    [`${prefix}.result`]: true,
    [`${prefix}.site_key`]: params.siteKey,
    [`${prefix}.secret_key`]: params.secretKey,
    [`${prefix}.__readOnly`]: false,
    [`${prefix}.__renderContentAsync`]: false,
    __runHash: runHash,
  };

  try {
    const {updatedAccount} = await makeRequest(
      account,
      'put',
      `/api/bpm/templates/public/${params.templateId}/${params.templateVersion}/run`,
      body,
    );
    return {ok: true, updatedAccount};
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {ok: false, error: msg.slice(0, 300)};
  }
}
