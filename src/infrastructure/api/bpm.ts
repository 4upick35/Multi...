import {ElmaAccount} from '../../types/account';
import {cacheGet, cacheSet, TTL_5MIN_MS} from '../elma-cache';
import {makeRequest} from './client';

// ---------------------------------------------------------------------------
// #10: BPM templates byCode — GET /api/bpm/templates/public/byCode/{ns}/{process}
// ---------------------------------------------------------------------------

export interface BpmTemplate {
  __id: string;
  __name: string;
  namespace?: string;
  code?: string;
  version?: number;
  processName?: string;
  description?: string;
}

const CACHE_KEY_BPM_PREFIX = 'bpmTemplate::';

/**
 * Получить шаблон BPM-процесса по коду (кэш TTL 5 мин).
 * @param namespace — например 'customer_service.applications'
 * @param process — например 'create_application'
 */
export async function fetchBpmTemplateByCode(
  account: ElmaAccount,
  namespace: string,
  process: string,
): Promise<{template: BpmTemplate | null; updatedAccount?: Partial<ElmaAccount>}> {
  const cacheKey = `${CACHE_KEY_BPM_PREFIX}${namespace}::${process}`;
  const cached = cacheGet<BpmTemplate>(account.id, cacheKey);
  if (cached !== undefined) {
    return {template: cached};
  }

  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/bpm/templates/public/byCode/${namespace}/${process}`,
    );
    const template: BpmTemplate = {
      __id: String((data as Record<string, unknown>)?.__id || ''),
      __name: String((data as Record<string, unknown>)?.__name || ''),
      namespace: String((data as Record<string, unknown>)?.namespace || namespace),
      code: String((data as Record<string, unknown>)?.code || process),
      version: Number((data as Record<string, unknown>)?.version || 0),
      processName: String((data as Record<string, unknown>)?.processName || process),
      description: String((data as Record<string, unknown>)?.description || ''),
    };
    if (template.__id) {
      cacheSet(account.id, cacheKey, template, TTL_5MIN_MS);
    }
    return {template, updatedAccount};
  } catch {
    return {template: null};
  }
}

// ---------------------------------------------------------------------------
// Accept Application Flow: разбор BPM-шаблонов
// ---------------------------------------------------------------------------

/** Результат получения шаблона accept_application */
export interface AcceptTemplate {
  templateId: string;
  templateVersion: number;
  formCode: string;
  formVersion: number;
  contextFields: unknown[];
}

/**
 * Разобрать сырой ответ BPM-шаблона по коду в AcceptTemplate.
 * Общий helper для getAcceptTemplate и getScheduleVisitTemplate.
 */
export function parseBpmTemplate(raw: Record<string, unknown>): AcceptTemplate | null {
  const templateId = String(raw.__id || '');
  const templateVersion = Number(raw.version || 0);

  if (!templateId || !templateVersion) {
    return null;
  }

  // formCode: forms[0].code → fallback process.items[type=start].settings.formCode
  let formCode = '';
  const forms = raw.forms;
  if (Array.isArray(forms) && forms.length > 0) {
    const form = forms[0] as Record<string, unknown>;
    formCode = String(form.code || '');
  }

  if (!formCode) {
    const process = raw.process as Record<string, unknown> | undefined;
    const processItems = process?.items as Record<string, unknown> | undefined;
    if (processItems && typeof processItems === 'object' && !Array.isArray(processItems)) {
      for (const node of Object.values(processItems)) {
        const n = node as Record<string, unknown>;
        if (n.type === 'start' && n.settings) {
          const settings = n.settings as Record<string, unknown>;
          formCode = String(settings.formCode || '');
          break;
        }
      }
    }
  }

  // formVersion: forms[0].widget.version
  let formVersion = 0;
  if (Array.isArray(forms) && forms.length > 0) {
    const form = forms[0] as Record<string, unknown>;
    const widget = form.widget as Record<string, unknown> | undefined;
    formVersion = Number(widget?.version || 0);
  }

  // contextFields: data.context (массив дескрипторов полей)
  const contextFields = Array.isArray(raw.context) ? raw.context : [];

  if (!formCode || !formVersion) {
    return null;
  }

  return {templateId, templateVersion, formCode, formVersion, contextFields};
}
