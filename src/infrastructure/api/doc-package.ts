import {ElmaAccount} from '../../types/account';
import {uuidv4} from '../../utils/uuid';
import {makeRequest} from './client';
import {parseBpmTemplate} from './bpm';
import type {AcceptTemplate} from './bpm';

// ---------------------------------------------------------------------------
// Сформировать пакет документов
// ---------------------------------------------------------------------------

/**
 * Получить шаблон create_package_of_documents_in_application.
 * GET /api/bpm/templates/public/byCode/customer_service.applications/create_package_of_documents_in_application?lastVersion=true
 */
export async function getDocumentPackageTemplate(
  account: ElmaAccount,
): Promise<{template: AcceptTemplate | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      '/api/bpm/templates/public/byCode/customer_service.applications/create_package_of_documents_in_application',
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
 * Запустить процесс формирования пакета документов.
 * PUT /api/bpm/templates/public/{templateId}/{templateVersion}/run
 */
export async function runDocumentPackage(
  account: ElmaAccount,
  params: {
    templateId: string;
    templateVersion: number;
    applicationId: string;
  },
): Promise<{ok: boolean; error?: string; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const body = {
      __item: {namespace: 'customer_service', code: 'applications', id: params.applicationId},
      applications: [params.applicationId],
      __runHash: uuidv4(),
    };
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
