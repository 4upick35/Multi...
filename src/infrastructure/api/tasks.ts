import {logDiag} from '../../diag/accept-log';
import {ElmaAccount} from '../../types/account';
import {ElmaRequestError} from '../../types/errors';
import {EXECUTION_FIELD_IDS, LONG_KEY_PREFIX} from '../../config/elma-constants';
import {getTaskInstance, buildVisitLongFields} from '../../domain/visit';
import {maskValue} from '../../utils/mask';
import {isUuid} from '../../utils/uuid';
import {cacheGet, cacheSet, TTL_10MIN_MS} from '../elma-cache';
import {LARGE_RESPONSE_TIMEOUT_MS} from '../HttpTransport';
import {makeRequest, VISIT_READ_HEADERS} from './client';

// ---------------------------------------------------------------------------
// Кэш шаблона/дескриптора визита (in-memory, per-account, TTL 10 мин)
// ---------------------------------------------------------------------------

const CACHE_KEY_TEMPLATE = 'visitTemplate';
const CACHE_KEY_FORM_DESCRIPTOR = 'visitFormDescriptor';

interface VisitTemplateCacheEntry {
  template: unknown;
  expiresAt: number;
}

interface VisitFormDescriptorCacheEntry {
  descriptor: unknown;
  expiresAt: number;
}

const templateCache = new Map<string, VisitTemplateCacheEntry>();
const formDescriptorCache = new Map<string, VisitFormDescriptorCacheEntry>();

function getTemplateCacheKey(accountId: string, version: number): string {
  return `${accountId}::${CACHE_KEY_TEMPLATE}::${version}`;
}

function getFormDescriptorCacheKey(accountId: string, version: number): string {
  return `${accountId}::${CACHE_KEY_FORM_DESCRIPTOR}::${version}`;
}

// ---------------------------------------------------------------------------
// Public API: fetchTasks — THROWS ElmaRequestError
// ---------------------------------------------------------------------------

// Адаптивный выбор запроса: запоминаем рабочий вариант для каждого аккаунта

interface AdaptiveEntry {
  /** Рабочий вариант: 'byUserId' | 'noQ' | null (ещё не пробовали) */
  workingVariant: string | null;
  /** Индекс рабочего фильтра в USER_ID_FILTER_VARIANTS (0..N) */
  filterIndex: number;
  /** Время последней попытки перебора (для cooldown) */
  lastTryTimestamp: number;
}

const adaptiveQueryState = new Map<string, AdaptiveEntry>();

function getBaseParams() {
  return {
    from: 0,
    size: 50,
    withPermissions: true,
    sortField: '__createdAt',
    ascending: false,
    noCount: false,
  };
}

/** Варианты фильтрации по userId — перебираем по очереди.
 *  Используем оператор `in` (не `equals` — невалиден в EQL).
 *  HAR-записи подтверждают: все фильтры по performers используют `in`. */
export function buildSystemTasksQuery(userId: string): string {
  return JSON.stringify({
    and: [
      {in: [{const: userId}, {field: "performers"}]},
      {not_in: [{field: "templateNsAndCode"}, {list: []}]},
      {in: [{field: "state"}, {list: ["assignment", "in_progress"]}]},
    ]
  });
}

const USER_ID_FILTER_VARIANTS: Array<(userId: string) => string> = [
  (userId) => `in("${userId}",performers)`,
  (userId) => `in("${userId}",__createdBy)`,
];

/** Попробовать выполнить запрос с вариантом и вернуть результат */
async function tryFetchVariant(
  account: ElmaAccount,
  variant: 'jsonQ' | 'byUserId' | 'noQ',
): Promise<{ok: boolean; data?: unknown; filterIndex?: number}> {
  const params: Record<string, unknown> = getBaseParams();
  if (variant === 'jsonQ' && account.userId) {
    params.q = buildSystemTasksQuery(account.userId);
    try {
      const {data} = await makeRequest(
        account,
        'get',
        '/api/processor/tasks/items',
        undefined,
        params,
      );
      return {ok: true, data};
    } catch (err: unknown) {
      if (
        err instanceof ElmaRequestError &&
        err.kind === 'server'
      ) {
        logDiag('tasks', 'fetchTasks jsonQ failed for ' + maskValue(account.id) + ' (5xx) q=' + maskValue(params.q));
      }
      throw err;
    }
  }
  if (variant === 'byUserId' && account.userId) {
    // Пробуем все варианты фильтра внутри одного запроса
    // Возвращаем первый успешный
    for (let i = 0; i < USER_ID_FILTER_VARIANTS.length; i++) {
      const filterFn = USER_ID_FILTER_VARIANTS[i];
      params.q = filterFn(account.userId);
      try {
        const {data} = await makeRequest(
          account,
          'get',
          '/api/processor/tasks/items',
          undefined,
          params,
        );
        return {ok: true, data, filterIndex: i};
      } catch (err: unknown) {
        if (
          err instanceof ElmaRequestError &&
          err.kind === 'server'
        ) {
          // 5xx — пробуем следующий вариант фильтра
          logDiag('tasks', 'fetchTasks filter attempt ' + i + ' failed for ' + maskValue(account.id) + ' (5xx) q=' + maskValue(params.q));
          continue;
        }
        // 401/4xx — пробрасываем сразу
        throw err;
      }
    }
    // Все варианты фильтра провалились — бросаем ошибку чтобы перейти к noQ
    throw new ElmaRequestError('server', 'All byUserId filter variants failed', 500);
  }
  // 'noQ' — просто не добавляем q
  const {data} = await makeRequest(
    account,
    'get',
    '/api/processor/tasks/items',
    undefined,
    params,
  );
  return {ok: true, data};
}

export async function fetchTasks(
  account: ElmaAccount,
): Promise<{tasks: unknown[]; updatedAccount?: Partial<ElmaAccount>}> {
  const accountId = account.id;
  let entry = adaptiveQueryState.get(accountId);

  // Кандидаты по порядку
  const candidates: Array<'jsonQ' | 'byUserId' | 'noQ'> = [];
  if (account.userId) {
    candidates.push('jsonQ');
    candidates.push('byUserId');
  }
  candidates.push('noQ');

  // Если уже есть рабочий вариант byUserId — используем его напрямую
  if (entry?.workingVariant === 'byUserId' || entry?.workingVariant === 'jsonQ') {
    const idx = entry.filterIndex ?? 0;
    const workingVariant = entry.workingVariant;
    logDiag('tasks', 'fetchTasks ' + maskValue(accountId) + ' cached ' + workingVariant + ' filterIndex=' + idx);
    try {
      const {data, updatedAccount} = await makeRequest(
        account,
        'get',
        '/api/processor/tasks/items',
        undefined,
        (() => {
          const p: Record<string, unknown> = getBaseParams();
          if (account.userId) {
            p.q = workingVariant === 'jsonQ'
              ? buildSystemTasksQuery(account.userId)
              : USER_ID_FILTER_VARIANTS[idx](account.userId);
          }
          return p;
        })(),
      );
      const typed = data as {result?: unknown[]} | undefined;
      return {tasks: typed?.result || [], updatedAccount};
    } catch (err: unknown) {
      if (
        err instanceof ElmaRequestError &&
        err.kind === 'server'
      ) {
        logDiag('tasks', 'fetchTasks ' + maskValue(accountId) + ' cached byUserId filterIndex=' + idx + ' got 5xx, resetting to re-try');
        adaptiveQueryState.set(accountId, {
          workingVariant: null,
          filterIndex: 0,
          lastTryTimestamp: Date.now(),
        });
        // Fall through to normal candidate iteration below
      } else {
        throw err;
      }
    }
  }

  // Нет запомненного варианта — перебираем кандидатов
  const now = Date.now();

  // Если в cooldown и нет рабочего варианта — всё равно пробуем byUserId
  // (но с более коротким cooldown: 30 сек вместо 5 мин)
  const SHORT_COOLDOWN_MS = 30_000;
  const inCooldown =
    entry && !entry.workingVariant && now - entry.lastTryTimestamp < SHORT_COOLDOWN_MS;
  if (inCooldown) {
    // Даже в cooldown — пробуем byUserId (быстрый повтор)
    try {
      const result = await tryFetchVariant(account, 'byUserId');
      adaptiveQueryState.set(accountId, {
        workingVariant: 'byUserId',
        filterIndex: result.filterIndex ?? 0,
        lastTryTimestamp: now,
      });
      const typed = result.data as {result?: unknown[]} | undefined;
      return {tasks: typed?.result || [], updatedAccount: undefined};
    } catch {
      // byUserId опять не сработал — отправляем без q
      const {data, updatedAccount} = await makeRequest(
        account,
        'get',
        '/api/processor/tasks/items',
        undefined,
        getBaseParams(),
      );
      const typed = data as {result?: unknown[]} | undefined;
      return {tasks: typed?.result || [], updatedAccount};
    }
  }

  // Перебор кандидатов
  let lastError: unknown = null;
  for (const variant of candidates) {
    try {
      const result = await tryFetchVariant(account, variant);
      // Успех — запоминаем вариант ТОЛЬКО если это byUserId.
      // 'noQ' НИКОГДА не кэшируем как workingVariant, чтобы при следующем
      // опросе всегда пробовать фильтрацию по userId.
      if (variant === 'jsonQ') {
        adaptiveQueryState.set(accountId, {
          workingVariant: 'jsonQ',
          filterIndex: 0,
          lastTryTimestamp: now,
        });
        logDiag('tasks', 'fetchTasks ' + maskValue(accountId) + ' jsonQ OK userId=' + maskValue(account.userId));
      } else if (variant === 'byUserId') {
        adaptiveQueryState.set(accountId, {
          workingVariant: 'byUserId',
          filterIndex: result.filterIndex ?? 0,
          lastTryTimestamp: now,
        });
        logDiag('tasks', 'fetchTasks ' + maskValue(accountId) + ' byUserId OK filterIndex=' + result.filterIndex + ' userId=' + maskValue(account.userId));
      } else {
        adaptiveQueryState.set(accountId, {
          workingVariant: null,
          filterIndex: 0,
          lastTryTimestamp: now,
        });
        logDiag('tasks', 'fetchTasks ' + maskValue(accountId) + ' jsonQ/byUserId FAILED, fallback to noQ (all tasks) userId=' + maskValue(account.userId));
      }
      const typed = result.data as {result?: unknown[]} | undefined;
      const list = typed?.result || [];
      logDiag('tasks', 'account=' + accountId + ' variant=' + variant + ' count=' + list.length + ' userId=' + (account.userId || ''));
      return {tasks: list};
    } catch (err: unknown) {
      lastError = err;
      // Не перебираем при 401/4xx
      if (
        err instanceof ElmaRequestError &&
        (err.kind === 'unauthorized' || (err.status != null && err.status < 500))
      ) {
        throw err;
      }
      // При 5xx — пробуем следующий кандидат
      if (
        err instanceof ElmaRequestError &&
        err.kind === 'server'
      ) {
        adaptiveQueryState.set(accountId, {
          workingVariant: null,
          filterIndex: 0,
          lastTryTimestamp: now,
        });
        continue;
      }
      // Другие ошибки — пробрасываем
      throw err;
    }
  }

  // Все кандидаты вернули ошибку
  throw lastError instanceof ElmaRequestError
    ? lastError
    : new ElmaRequestError('other', String(lastError));
}

// ---------------------------------------------------------------------------
// TaskExit fetch — with per-account+taskId TTL cache (TTL 10 min)
// ---------------------------------------------------------------------------

const CACHE_KEY_TASK_EXITS_PREFIX = 'taskExits::';

function taskExitsCacheKey(accountId: string, taskId: string): string {
  return `${CACHE_KEY_TASK_EXITS_PREFIX}${taskId}`;
}

export async function getTaskExits(
  account: ElmaAccount,
  taskId: string,
): Promise<unknown[]> {
  const cacheKey = taskExitsCacheKey(account.id, taskId);
  const cached = cacheGet<unknown[]>(account.id, cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const {data} = await makeRequest(
      account,
      'get',
      `/api/tasks/${taskId}/getexits`,
    );
    const result = (data as unknown[]) || [];
    // Пустой список НЕ кэшируем: кнопка «Действия» должна позволять
    // повторить запрос (иначе 10 минут показывался бы пустой экран).
    if (result.length > 0) {
      cacheSet(account.id, cacheKey, result, TTL_10MIN_MS);
    }
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logDiag('elma-api', 'getTaskExits error: ' + msg);
    return [];
  }
}

// ---------------------------------------------------------------------------
// TaskExit type + normalization + fetchTaskExitsNormalized
// ---------------------------------------------------------------------------

export interface TaskExit {
  id: string;
  title: string;
  key: string;
  type?: string;
}

export interface TaskExitField {
  code: string;
  required: boolean;
  /** Подпись поля (template.context[].view.name) или code. */
  label: string;
  /** Тип поля ELMA: STRING | NUMBER | DATETIME | BOOLEAN | SYS_COLLECTION | ... */
  type: string;
  /** Для SYS_COLLECTION — откуда выбирать значение. */
  collection?: {namespace: string; code: string; filter?: unknown};
  /** Значения ENUM-поля (template.context[].data.enumItems). */
  enumItems?: {code: string; name: string}[];
  /** Уточнение типа из view.data.additionalType (для DATETIME бывает 'time'). */
  additionalType?: string;
}
export interface TaskExitInfo {id: string; name: string; confirm?: string; buttonClass?: string; confirmText?: string; formFields: TaskExitField[];}

/** Последний сегмент code после точки: `applications.datetime` → `datetime`. */
function lastCodeSegment(code: string): string {
  const idx = code.lastIndexOf('.');
  return idx >= 0 ? code.slice(idx + 1) : code;
}

/**
 * Полное описание поля формы выхода лежит в `template.context[]` и ищется по
 * `code`. В context code бывает и с точкой (`applications.datetime_of_session`),
 * а в `settings.exit.formFields` — короткое имя, поэтому сравниваем и по полному
 * code, и по последнему сегменту после точки (точное совпадение важнее).
 */
function findContextField(contextFields: Record<string, unknown>[], code: string): Record<string, unknown> | undefined {
  if (!code) return undefined;
  const exact = contextFields.find(f => String(f?.code || '') === code);
  if (exact) return exact;
  return contextFields.find(f => lastCodeSegment(String(f?.code || '')) === lastCodeSegment(code));
}

/** Собрать enriched-описание поля выхода из краткого formField + template.context. */
function buildExitField(formField: Record<string, unknown>, contextFields: Record<string, unknown>[]): TaskExitField {
  const code = String(formField.code || '');
  const contextField = findContextField(contextFields, code);
  const type = String(contextField?.type || '');
  const view = (contextField?.view || {}) as Record<string, unknown>;
  const data = (contextField?.data || {}) as Record<string, unknown>;
  const field: TaskExitField = {
    code,
    required: !!formField.required,
    label: String(view.name || formField.display || code),
    type,
  };
  const viewData = (view.data || {}) as Record<string, unknown>;
  if (typeof viewData.additionalType === 'string' && viewData.additionalType) {
    field.additionalType = viewData.additionalType;
  }
  const rawEnumItems = data.enumItems;
  if (Array.isArray(rawEnumItems)) {
    const enumItems: {code: string; name: string}[] = [];
    rawEnumItems.forEach(raw => {
      const item = (raw || {}) as Record<string, unknown>;
      const itemCode = String(item.code || '');
      if (!itemCode) {
        return;
      }
      const itemName = typeof item.name === 'string' ? item.name : '';
      enumItems.push({code: itemCode, name: itemName || itemCode});
    });
    if (enumItems.length > 0) {
      field.enumItems = enumItems;
    }
  }
  if (type === 'SYS_COLLECTION' && data.code) {
    const rawData = data.filter as {enabled?: unknown; value?: unknown} | undefined;
    field.collection = {
      namespace: String(data.namespace || 'customer_service'),
      code: String(data.code),
    };
    if (rawData && rawData.enabled === true) {
      field.collection.filter = rawData.value;
    }
  }
  return field;
}

export function parseTemplateExits(template: unknown, nodeId: string): TaskExitInfo[] {
  if (!template || typeof template !== 'object') return [];
  const t = template as Record<string, unknown>;
  const process = (t.process || {}) as Record<string, unknown>;
  const items = process.items as Record<string, unknown> | undefined;
  const transitions = process.transitions as Record<string, unknown> | undefined;
  if (!items || !transitions) return [];
  const node = items[nodeId] as Record<string, unknown>;
  if (!node) return [];
  const exits = node.exits as string[];
  if (!exits || !Array.isArray(exits)) return [];
  const contextFields = Array.isArray(t.context)
    ? (t.context as Record<string, unknown>[]).filter(c => c && typeof c === 'object')
    : [];
  return exits.map(uuid => {
    const transition = transitions[uuid] as Record<string, unknown>;
    if (!transition) return null;
    const settings = transition.settings as Record<string, unknown>;
    const exitSettings = settings?.exit as Record<string, unknown>;
    let formFields = (exitSettings?.formFields as Record<string, unknown>[]) || [];
    if (formFields.length === 0) {
      // Часть шаблонов задаёт обязательные поля формы НА УЗЛЕ
      // (node.settings.formFields), а у выхода formFields пустой — например
      // customer_service.appeal_tasks:processing_appeal_task, где мастер вносит
      // текст результата (`result`, required) и жмёт «Готово». Берём
      // редактируемые обязательные поля узла (readonly !== true && required === true).
      const nodeSettings = (node.settings || {}) as Record<string, unknown>;
      const nodeFields = Array.isArray(nodeSettings.formFields)
        ? (nodeSettings.formFields as Record<string, unknown>[])
        : [];
      formFields = nodeFields.filter(f => f && f.readonly !== true && f.required === true);
    }
    return {
      id: uuid,
      name: String(transition.name || ''),
      confirm: exitSettings?.confirm as string,
      buttonClass: exitSettings?.buttonClass as string,
      confirmText: exitSettings?.confirmText as string,
      formFields: formFields.map(f => buildExitField(f, contextFields)).filter(f => f.code)
    };
  }).filter(Boolean) as TaskExitInfo[];
}

/**
 * Загрузить шаблон процесса целиком с TTL-кэшем 10 минут. Один шаблон —
 * один запрос: и выходы узла, и код его формы берутся из одного ответа.
 */
async function fetchTemplateRaw(account: ElmaAccount, templateNsAndCode: string): Promise<unknown | null> {
  if (!templateNsAndCode) return null;
  const sepIndex = templateNsAndCode.indexOf(':');
  if (sepIndex <= 0) return null;
  const namespace = templateNsAndCode.slice(0, sepIndex);
  const code = templateNsAndCode.slice(sepIndex + 1);
  if (!namespace || !code) return null;
  const cacheKey = `template-raw::${templateNsAndCode}`;
  const cached = cacheGet<unknown>(account.id, cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const {data} = await makeRequest(
      account,
      'get',
      `/api/bpm/templates/public/byCode/${namespace}/${code}`,
      undefined,
      {lastVersion: 'false'},
      undefined,
      // шаблон ~455 КБ, обычных 15 с не хватает
      LARGE_RESPONSE_TIMEOUT_MS,
    );
    cacheSet(account.id, cacheKey, data, TTL_10MIN_MS);
    return data;
  } catch {
    return null;
  }
}

export async function fetchTaskTemplateExits(account: ElmaAccount, templateNsAndCode: string, nodeId: string): Promise<TaskExitInfo[] | null> {
  if (!nodeId) return [];
  const data = await fetchTemplateRaw(account, templateNsAndCode);
  // null = проверить обязательные поля НЕ удалось; вызывающий обязан не
  // показывать кнопки (fail closed)
  if (!data) return null;
  return parseTemplateExits(data, nodeId);
}

export const EXIT_FIELD_TARGETS: Record<string, string> = {time_of_visit: 'applications.datetime_of_session'};

export function buildExitFieldValues(fields: TaskExitField[], values: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  fields.forEach(field => {
    const value = values[field.code];
    if (value !== undefined && value !== null && value !== '') {
      const targetKey = EXIT_FIELD_TARGETS[field.code] || field.code;
      result[targetKey] = value;
    }
  });
  return result;
}

export async function completeTaskByExit(account: ElmaAccount, params: {taskUuid: string; instanceId: string; exitId: string; fieldValues?: Record<string, unknown>;}): Promise<{ok: boolean; error?: string}> {
  logDiag('elma-api', 'completeTaskByExit exitId=' + maskValue(params.exitId));
  try {
    const body = {
      instanceId: params.instanceId,
      data: {
        ...(params.fieldValues || {}),
        __comment: null,
        __action: true,
        __skipSave: [],
        __exit: params.exitId
      }
    };
    await makeRequest(
      account,
      'put',
      `/api/bpm/tasks/${params.taskUuid}`,
      body,
    );
    return {ok: true};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {ok: false, error: errorMessage.slice(0, 300)};
  }
}

// ---------------------------------------------------------------------------
// Ленивые кэшируемые загрузчики шаблона и дескриптора формы визита
// ---------------------------------------------------------------------------

/** Загрузить шаблон процесса (кэш per-account TTL 10 мин) */
export async function fetchProcessTemplate(
  account: ElmaAccount,
  templateId: string,
  version: number,
): Promise<Record<string, unknown>> {
  const key = getTemplateCacheKey(account.id, version);
  const cached = templateCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.template as Record<string, unknown>;
  }
  const {data} = await makeRequest(
    account,
    'get',
    `/api/bpm/templates/public/${templateId}/${version}`,
    undefined,
    undefined,
    VISIT_READ_HEADERS,
  );
  const template = (data as Record<string, unknown>) || {};
  templateCache.set(key, {template, expiresAt: Date.now() + TTL_10MIN_MS});
  return template;
}

/** Загрузить дескриптор формы виджета (кэш per-account TTL 10 мин) */
export async function fetchFormDescriptor(
  account: ElmaAccount,
  namespace: string,
  formCode: string,
  version: number,
): Promise<Record<string, unknown>> {
  const key = getFormDescriptorCacheKey(account.id, version);
  const cached = formDescriptorCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.descriptor as Record<string, unknown>;
  }
  const {data} = await makeRequest(
    account,
    'get',
    `/api/widgets/public/${namespace}/${formCode}/${version}`,
    undefined,
    undefined,
    VISIT_READ_HEADERS,
  );
  const descriptor = (data as Record<string, unknown>) || {};
  formDescriptorCache.set(key, {descriptor, expiresAt: Date.now() + TTL_10MIN_MS});
  return descriptor;
}

/** Очистить кэш шаблона и дескриптора формы (для тестов) */
export function clearVisitTemplateCache(): void {
  templateCache.clear();
  formDescriptorCache.clear();
}

// ---------------------------------------------------------------------------
// EXIT_LABELS and normalizeExits
// ---------------------------------------------------------------------------

const EXIT_LABELS: Record<string, string> = {
  submit: 'Принять',
  complete: 'Завершить',
  return: 'Вернуть',
  reject: 'Отклонить',
  approve: 'Согласовать',
  decline: 'Отказать',
};

function normalizeExits(raw: unknown): TaskExit[] {
  const list = Array.isArray(raw) ? raw : [];
  const result: TaskExit[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const key = item.trim();
      if (!key) {
        continue;
      }
      result.push({id: key, key, title: EXIT_LABELS[key] || key});
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const id =
        (obj.id as string) ||
        (obj.Id as string) ||
        '';
      const key =
        (obj.name as string) ||
        (obj.key as string) ||
        (obj.Name as string) ||
        (obj.Key as string) ||
        '';
      if (!id && !key) {
        continue;
      }
      const rawTitle =
        (obj.title as string) ||
        (obj.label as string) ||
        (obj.Title as string) ||
        (obj.Label as string);
      const title = rawTitle || EXIT_LABELS[key] || key;
      const type =
        (obj.type as string) ||
        (obj.Type as string) ||
        undefined;
      result.push({id: id || key, key: key || id, title, type});
    }
  }
  return result;
}

export async function fetchTaskExitsNormalized(
  account: ElmaAccount,
  taskId: string,
): Promise<TaskExit[]> {
  // ВАЖНО: возвращаются ТОЛЬКО выходы, пришедшие с сервера.
  // Фиктивные fallback-выходы ('submit'/'complete') запрещены: их нет в
  // шаблоне процесса, ELMA отвечает на них 403 и банит сессию аккаунта.
  try {
    const raw = await getTaskExits(account, taskId);
    return normalizeExits(raw);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API: submitTask — keeps try/catch → boolean
// ---------------------------------------------------------------------------

/** Человекочитаемый текст для отказов ELMA 403/412 (без ретраев). */
function exitRejectedMessage(status: number): string {
  if (status === 403) {
    return 'Сервер отклонил действие (403): действие недоступно или не разрешено для этой задачи. Нажмите «Действия», чтобы обновить список выходов.';
  }
  return 'Сервер отклонил действие (412): состояние задачи изменилось. Нажмите «Действия», чтобы обновить список выходов.';
}

/**
 * Выход (exit) задачи выполняется официальным запросом ОДНИМ PUT:
 * `PUT /api/bpm/tasks/{uuid задачи}` с телом
 * `{instanceId, data: {…значения полей…, __comment, __action, __skipSave, __exit}}` —
 * так же, как это делает веб-клиент ELMA (подтверждено HAR21).
 * Ретраев нет, в том числе для 403/412: повтор «странного» запроса
 * провоцирует бан сессии на стороне ELMA. Единственное исключение —
 * 401 внутри makeRequest (однократный refresh токена и повтор).
 */
export async function submitTask(
  account: ElmaAccount,
  instanceId: string,
  taskUuid: string,
  exitId: string,
  fieldValues?: Record<string, unknown>,
): Promise<{ok: boolean; error?: string; status?: number}> {
  // Защита от «странных запросов»: на сервер уходят только UUID-идентификаторы
  // выходов, реально пришедшие от ELMA. Литералы вида 'submit'/'complete'
  // и прочие не-UUID значения отсекаются БЕЗ сетевого запроса.
  if (!isUuid(exitId)) {
    const msg = 'Недопустимый идентификатор действия: нажмите «Действия», чтобы обновить список выходов';
    logDiag('elma-api', 'submitTask blocked: exitId=' + maskValue(exitId));
    return {ok: false, error: msg};
  }
  try {
    const body = {
      instanceId,
      data: {
        ...(fieldValues || {}),
        __comment: null,
        __action: true,
        __skipSave: [],
        __exit: exitId,
      },
    };
    logDiag('elma-api', 'submitTask: PUT /api/bpm/tasks/' + maskValue(taskUuid) + ' exitId=' + maskValue(exitId));
    await makeRequest(account, 'put', `/api/bpm/tasks/${taskUuid}`, body);
    return {ok: true};
  } catch (e: unknown) {
    const status = e instanceof ElmaRequestError ? e.status : undefined;
    let errMsg: string;
    if (status === 403 || status === 412) {
      errMsg = exitRejectedMessage(status);
    } else if (e instanceof ElmaRequestError) {
      errMsg = e.message;
    } else if (e instanceof Error) {
      errMsg = e.message;
    } else {
      errMsg = String(e);
    }
    if (/task is already closed/i.test(errMsg)) {
      errMsg = 'Задача уже закрыта (действие выполнено ранее)';
    }
    logDiag('elma-api', 'submitTask error: ' + errMsg);
    return {ok: false, error: errMsg.slice(0, 300), status};
  }
}

/**
 * Выход задачи с данными формы ОДНИМ запросом — как кнопка-выход в веб-клиенте ELMA
 * (HAR23: «Готово» + данные экрана «Выполнение работ», статус 200).
 * Тело: {instanceId, data: {...поля (короткие + длинные), поля визита ДЛИННЫМИ
 *        ключами (если передан params.instance), __comment: null,
 *        __action: true, __skipSave: [], __exit: exitId}}.
 * Ретраев нет (кроме однократного 401 внутри makeRequest).
 */
export async function submitTaskWithData(
  account: ElmaAccount,
  params: {
    taskUuid: string;
    instanceId: string;
    exitId: string;
    body: Record<string, unknown>;
    instance?: Record<string, unknown>;
  },
): Promise<{ok: boolean; error?: string; status?: number}> {
  // Защита от «странных запросов»: как в submitTask — на сервер уходят только
  // UUID-идентификаторы выходов, пришедшие от ELMA. Без сетевого запроса.
  if (!isUuid(params.exitId)) {
    const msg = 'Недопустимый идентификатор действия: нажмите «Действия», чтобы обновить список выходов';
    logDiag('elma-api', 'submitTaskWithData blocked: exitId=' + maskValue(params.exitId));
    return {ok: false, error: msg};
  }
  try {
    const data: Record<string, unknown> = {
      ...buildTaskDataPayload(params.body),
      ...(params.instance ? buildVisitLongFields(params.instance) : {}),
      __comment: null,
      __action: true,
      __skipSave: [],
      __exit: params.exitId,
    };
    logDiag(
      'elma-api',
      'submitTaskWithData: PUT /api/bpm/tasks/' + maskValue(params.taskUuid) + ' exitId=' + maskValue(params.exitId),
    );
    await makeRequest(account, 'put', '/api/bpm/tasks/' + params.taskUuid, {
      instanceId: params.instanceId,
      data,
    });
    return {ok: true};
  } catch (e: unknown) {
    const status = e instanceof ElmaRequestError ? e.status : undefined;
    let errMsg: string;
    if (status === 403 || status === 412) {
      errMsg = exitRejectedMessage(status);
    } else if (e instanceof ElmaRequestError) {
      errMsg = e.message;
    } else if (e instanceof Error) {
      errMsg = e.message;
    } else {
      errMsg = String(e);
    }
    if (/task is already closed/i.test(errMsg)) {
      errMsg = 'Задача уже закрыта (действие выполнено ранее)';
    }
    logDiag('elma-api', 'submitTaskWithData error: ' + errMsg);
    return {ok: false, error: errMsg.slice(0, 300), status};
  }
}

// ---------------------------------------------------------------------------
// Public API: buildTaskDataPayload — сборка `data` для PUT /api/bpm/tasks/{uuid}
// ---------------------------------------------------------------------------

/**
 * Собрать `data` для тела `PUT /api/bpm/tasks/{uuid}` из «плоского» тела формы.
 *
 * Правила (подтверждено HAR21/HAR23):
 *  - `instanceId`, `__action`, `__exit` в `data` не попадают (они уровнем выше);
 *  - каждый ключ дублируется: короткая форма `data[key]` + длинная
 *    `data['<LONG_KEY_PREFIX>.<UUID поля>.<key>']`, если UUID есть в таблице
 *    `EXECUTION_FIELD_IDS` (UUID внутри длинного ключа генерирует сам клиент,
 *    сервер разбирает ключ по коду поля);
 *  - в конце ВСЕГДА добавляется `data.__comment = null` — этот ключ есть
 *    в каждом PUT веб-клиента ELMA.
 */
export function buildTaskDataPayload(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (key === 'instanceId') continue;
    if (key === '__action' || key === '__exit') continue;

    // Короткая форма — как есть
    data[key] = value;

    // Длинная форма — только если field_code есть в таблице
    const fieldUuid = EXECUTION_FIELD_IDS[key];
    if (fieldUuid) {
      data[`${LONG_KEY_PREFIX}.${fieldUuid}.${key}`] = value;
    } else if (__DEV__) {
      console.log(
        `[elma-api] buildTaskDataPayload: field "${key}" не найден в EXECUTION_FIELD_IDS — длинная форма не добавлена`,
      );
    }
  }

  data.__comment = null;
  return data;
}

// ---------------------------------------------------------------------------
// Public API: updateTaskInstance — PUT /api/bpm/tasks/{uuid} без закрытия задачи
// ---------------------------------------------------------------------------

export async function updateTaskInstance(
  account: ElmaAccount,
  taskUuid: string,
  body: Record<string, unknown>,
): Promise<{ok: boolean; data?: unknown; error?: string}> {
  try {
    // Порядок ключей как в веб-клиенте: сначала instanceId, затем data.
    const requestBody: Record<string, unknown> = body.instanceId
      ? {instanceId: body.instanceId, data: buildTaskDataPayload(body)}
      : {data: buildTaskDataPayload(body)};

    const {data: responseData} = await makeRequest(
      account,
      'put',
      `/api/bpm/tasks/${taskUuid}`,
      requestBody,
    );
    return {ok: true, data: responseData};
  } catch (e: unknown) {
    let errMsg: string;
    if (e instanceof ElmaRequestError) {
      errMsg = e.message;
    } else if (e instanceof Error) {
      errMsg = e.message;
    } else {
      errMsg = String(e);
    }
    logDiag('elma-api', 'updateTaskInstance error: ' + errMsg);
    return {ok: false, error: errMsg.slice(0, 300)};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchTaskById — GET /api/bpm/tasks/{uuid}
// ---------------------------------------------------------------------------

export async function fetchTaskById(
  account: ElmaAccount,
  taskUuid: string,
): Promise<{task: Record<string, unknown> | null; updatedAccount?: Partial<ElmaAccount>}> {
  try {
    const {data, updatedAccount} = await makeRequest(
      account,
      'get',
      `/api/bpm/tasks/${taskUuid}`,
    );
    return {task: (data as Record<string, unknown>) || null, updatedAccount};
  } catch {
    return {task: null};
  }
}

// ---------------------------------------------------------------------------
// Public API: fetchTaskInstanceData — возвращает instance из GET задачи
// ---------------------------------------------------------------------------

/** Загрузить instance-объект задачи одним GET /api/bpm/tasks/{uuid} */
export async function fetchTaskInstanceData(
  account: ElmaAccount,
  taskUuid: string,
): Promise<Record<string, unknown>> {
  const result = await fetchTaskById(account, taskUuid);
  return getTaskInstance(result.task);
}
