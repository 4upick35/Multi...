import {ElmaAccount} from '../../types/account';
import {uuidv4} from '../../utils/uuid';
import {makeRequest, VISIT_WRITE_HEADERS} from './client';
import {parseBpmTemplate} from './bpm';
import type {AcceptTemplate} from './bpm';
import {buildCaptchaContext, buildCaptchaFields} from './accept';

// ---------------------------------------------------------------------------
// Назначение визита: шаблон, init-данные, мастер, запуск
// ---------------------------------------------------------------------------

/** Мастер с именем (из _user_profiles) */
export interface MasterProfile {
  id: string;
  name: string;
  phone?: string;
  jobTitle?: string;
}

/** Результат init-вызова для формы назначения визита */
export interface ScheduleVisitInitResult {
  masterIds: string[];
  minDate: string | null;
  preselectedMasterId: string | null;
}

/**
 * Получить шаблон date_and_wizard_approval.
 * GET /api/bpm/templates/public/byCode/customer_service.applications/date_and_wizard_approval?lastVersion=true
 */
export async function getScheduleVisitTemplate(
  account: ElmaAccount,
): Promise<{template: AcceptTemplate | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/bpm/templates/public/byCode/customer_service.applications/date_and_wizard_approval',
      undefined,
      {lastVersion: 'true'},
    );
    const raw = data as Record<string, unknown>;
    const template = parseBpmTemplate(raw);
    return {template, updatedAccount};
  } catch {
    return {template: null};
  }
}

/**
 * Получить init-данные формы (список доступных мастеров, мин. дата).
 * POST /api/widgets/execute
 */
export async function getScheduleVisitInitData(
  account: ElmaAccount,
  formCode: string,
  formVersion: number,
  contextFields: unknown[],
  applicationId: string,
): Promise<{init: ScheduleVisitInitResult | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const body = {
      namespace: 'customer_service.applications',
      code: formCode,
      version: formVersion,
      func: 'init',
      args: [],
      fields: buildCaptchaFields(contextFields),
      context: buildCaptchaContext(contextFields, applicationId, null),
      extraContexts: [{'name': 'ViewContext', 'fields': [], 'value': {}}],
    };
    const {data, updatedAccount} = await makeRequest(account, 'post', '/api/widgets/execute', body, undefined, VISIT_WRITE_HEADERS);
    const resp = data as Record<string, unknown> | undefined;
    const fieldsData = resp?.fieldsData as Record<string, unknown> | undefined;
    if (!fieldsData) {
      return {init: null, updatedAccount};
    }

    // Извлечь id мастеров из master.filter.value (рекурсивно)
    const masterField = fieldsData.master as Record<string, unknown> | undefined;
    const masterFilter = masterField?.filter as Record<string, unknown> | undefined;
    const masterFilterValue = masterFilter?.value;
    const masterIds = parseMasterIdsFromFilter(masterFilterValue);

    // Минимальная дата из visit_date.filter.value.gte
    let minDate: string | null = null;
    const visitDateField = fieldsData.visit_date as Record<string, unknown> | undefined;
    const visitDateFilter = visitDateField?.filter as Record<string, unknown> | undefined;
    const visitDateValue = visitDateFilter?.value as Record<string, unknown> | undefined;
    const gte = visitDateValue?.gte;
    if (Array.isArray(gte) && gte.length > 0) {
      const first = gte[0] as Record<string, unknown>;
      if (first.const) {
        minDate = String(first.const);
      }
    }

    const respContext = resp?.context as Record<string, unknown> | undefined;
    const masterContext = respContext?.master;
    const preselectedMasterId = Array.isArray(masterContext) && masterContext.length > 0 ? String(masterContext[0]) : null;

    return {init: {masterIds, minDate, preselectedMasterId}, updatedAccount};
  } catch {
    return {init: null};
  }
}

/**
 * Рекурсивно извлечь массив id из фильтра вида {and:[...{in:[{field:'__id'},{list:[...]}]}...]}.
 * Устойчив к вложенности — обходит дерево операций.
 */
export function parseMasterIdsFromFilter(filterValue: unknown): string[] {
  if (!filterValue || typeof filterValue !== 'object') {
    return [];
  }
  const obj = filterValue as Record<string, unknown>;

  // Если это операция "in" по полю __id
  if (Array.isArray(obj.in)) {
    const [fieldDesc, listDesc] = obj.in as [Record<string, unknown>, Record<string, unknown>];
    if (fieldDesc?.field === '__id' && Array.isArray(listDesc?.list)) {
      return listDesc.list.map(String);
    }
  }

  // Рекурсивный обход: and, or, not и прочие операторы
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = parseMasterIdsFromFilter(item);
        if (found.length > 0) {
          return found;
        }
      }
    }
  }

  return [];
}

/**
 * Получить профили мастеров по id.
 * POST /api/apps/_system_catalogs/_user_profiles/items/list
 */
export async function getMasterProfiles(
  account: ElmaAccount,
  masterIds: string[],
): Promise<{masters: MasterProfile[]; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const q = JSON.stringify({
      and: [{
        and: [
          {eq: [{field: '__deletedAt'}, null]},
          {eq: [{field: '__user_status'}, {const: {code: 'active', name: 'Активен', checked: false}}]},
          {in: [{field: '__id'}, {list: masterIds}]},
        ],
      }],
    });
    const body = {
      from: 0,
      size: 50,
      q,
      sortField: '__createdAt',
      ascending: false,
    };
    const {data, updatedAccount} = await makeRequest(
      account,
      'post',
      '/api/apps/_system_catalogs/_user_profiles/items/list',
      body,
    );
    const resp = data as Record<string, unknown> | undefined;
    const result = Array.isArray(resp?.result) ? resp!.result : [];
    const masters: MasterProfile[] = result.map((item: Record<string, unknown>) => ({
      id: String(item.__id || ''),
      name: String(item.__name || ''),
      phone: item.phone ? String(item.phone) : undefined,
      jobTitle: item.job_title ? String(item.job_title) : undefined,
    }));
    return {masters, updatedAccount};
  } catch {
    return {masters: []};
  }
}

/**
 * Собрать тело PUT .../run для назначения визита.
 * Экспортируется для тестирования.
 */
export function buildScheduleVisitBody(params: {
  applicationId: string;
  visitDateIso: string;
  masterId: string;
  templateId: string;
  templateVersion: number;
  formCode: string;
}): Record<string, unknown> {
  const ns = 'customer_service.applications';
  const formCode = params.formCode;

  const body: Record<string, unknown> = {
    __item: {namespace: 'customer_service', code: 'applications', id: params.applicationId},
    applications: [params.applicationId],
    type_of_event: [],
    visit_date: params.visitDateIso,
    master: [params.masterId],
    __validateResult: {kind: 'BlobObject'},
    [`${ns}.${formCode}/popover.__readOnly`]: false,
    [`${ns}.${formCode}/popover.__renderContentAsync`]: false,
    __runHash: uuidv4(),
  };

  return body;
}

/**
 * Запустить процесс назначения визита.
 * PUT /api/bpm/templates/public/{templateId}/{templateVersion}/run
 */
export async function runScheduleVisit(
  account: ElmaAccount,
  params: {
    templateId: string;
    templateVersion: number;
    applicationId: string;
    formCode: string;
    visitDateIso: string;
    masterId: string;
  },
): Promise<{ok: boolean; error?: string; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const body = buildScheduleVisitBody(params);
    const {updatedAccount} = await makeRequest(
      account,
      'put',
      `/api/bpm/templates/public/${params.templateId}/${params.templateVersion}/run`,
      body,
      undefined,
      VISIT_WRITE_HEADERS,
    );
    return {ok: true, updatedAccount};
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {ok: false, error: msg.slice(0, 300)};
  }
}
