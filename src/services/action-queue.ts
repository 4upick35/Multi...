// ---------------------------------------------------------------------------
// action-queue.ts — персистентная очередь отложенных действий (ЭТАП 4A).
//
// Действие, которое не удалось выполнить из-за недоступности сети, не теряется:
// оно сохраняется в AsyncStorage и повторяется автоматически при следующем
// вызове processPendingActions(). Записи живут 24 часа (TTL), число попыток
// ограничено: после 5 неудач состояние становится 'unknown'.
//
// Принятые ограничения:
//  - accept-application НЕ выполняется автоматически: нужна капча пользователя;
//  - обработка строго последовательная, по одной записи, с паузой между ними;
//  - при активной паузе аккаунта (429/503/бан ELMA) записи не трогаются;
//  - неизвестный аккаунт — запись остаётся в очереди до истечения TTL.
// ---------------------------------------------------------------------------

import AsyncStorage from '@react-native-async-storage/async-storage';
import {delay} from '../native/KeepAlive';
import {getRemainingPauseMs} from '../infrastructure/AccountThrottle';
import {useAuthStore} from '../store/auth-store';
import {fetchCollectionItemsByIds, runScheduleVisit, submitTask} from './elma-api';
import {logDiag} from '../diag/accept-log';
import type {ElmaAccount} from '../types/account';

/** Вид отложенного действия. */
export type PendingKind =
  | 'accept-application'
  | 'schedule-visit'
  | 'submit-exit';

/** Запись очереди: одно отложенное действие одного аккаунта. */
export interface PendingAction {
  id: string;
  kind: PendingKind;
  accountId: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  state: 'pending' | 'error' | 'unknown';
  lastError?: string;
}

/** Ключ AsyncStorage с очередью. */
export const PENDING_ACTIONS_STORAGE_KEY = '@multi_elma_pending_actions';

/** Время жизни записи: сутки, дальше — только мусор. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** После стольких неудач запись помечается как 'unknown' (ручной разбор). */
const MAX_ATTEMPTS = 5;

/** Пауза между записями при обработке (не даём устроить серию запросов). */
const PROCESS_GAP_MS = 400;

/** Ошибка уже закрытой задачи: русский текст из submitTask или исходный серверный. */
const ALREADY_CLOSED_RE = /уже закрыта|already closed/i;

/** Очередь в памяти (загружается из AsyncStorage при первом обращении). */
let actions: PendingAction[] = [];

/** true — массив уже прочитан из хранилища. */
let loaded = false;

/** Общий промис первой загрузки: параллельные вызовы делят чтение. */
let loadingPromise: Promise<void> | null = null;

/** Монотонная защита от параллельной обработки одной очереди. */
let processing = false;

/** Слушатели изменений очереди. */
const listeners = new Set<() => void>();

/** Идентификатор записи: время + «случайность» (без внешних зависимостей). */
function generateId(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

/** Уведомить слушателей об изменении очереди (сломавшийся слушатель не мешает). */
function notifyListeners(): void {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // слушатель не должен ронять обработку очереди
    }
  });
}

/** Сохранить очередь в AsyncStorage (ошибки хранилища не должны ломать поток). */
async function persistActions(): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_ACTIONS_STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // best-effort: без хранилища очередь просто не переживёт перезапуск
  }
}

/** Сохранить изменения и сообщить слушателям. */
async function commit(): Promise<void> {
  await persistActions();
  notifyListeners();
}

/** Проверка, что прочитанная из хранилища запись имеет нужную форму. */
function isPendingAction(value: unknown): value is PendingAction {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.accountId === 'string' &&
    typeof item.entityId === 'string' &&
    typeof item.createdAt === 'number' &&
    typeof item.attempts === 'number'
  );
}

/** Прочитать очередь из AsyncStorage при первом обращении. */
function loadActions(): Promise<void> {
  if (loaded) {
    return Promise.resolve();
  }
  if (loadingPromise === null) {
    loadingPromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(PENDING_ACTIONS_STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            actions = parsed.filter(isPendingAction);
          }
        }
      } catch {
        actions = [];
      } finally {
        loaded = true;
        loadingPromise = null;
      }
    })();
  }
  return loadingPromise;
}

/**
 * Поставить действие в очередь. Дедупликация по kind+accountId+entityId:
 * уже существующая запись получает новый payload и state='pending'
 * (счётчик attempts при этом НЕ сбрасывается).
 */
export async function enqueuePendingAction(input: {
  kind: PendingKind;
  accountId: string;
  entityId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await loadActions();
  const existing = actions.find(
    (item) =>
      item.kind === input.kind &&
      item.accountId === input.accountId &&
      item.entityId === input.entityId,
  );
  if (existing) {
    existing.payload = input.payload;
    existing.state = 'pending';
  } else {
    actions.push({
      id: generateId(),
      kind: input.kind,
      accountId: input.accountId,
      entityId: input.entityId,
      payload: input.payload,
      createdAt: Date.now(),
      attempts: 0,
      state: 'pending',
    });
  }
  logDiag('action-queue', 'enqueue ' + input.kind + ' entity=' + input.entityId);
  await commit();
}

/** Текущее состояние очереди (копии записей, внешняя правка состояние не меняет). */
export async function getPendingActions(): Promise<PendingAction[]> {
  await loadActions();
  return actions.map((item) => ({...item}));
}

/** Убрать запись из очереди (выполнена, невыполнима или устарела). */
export async function removePendingAction(id: string): Promise<void> {
  await loadActions();
  const next = actions.filter((item) => item.id !== id);
  if (next.length === actions.length) {
    return;
  }
  actions = next;
  await commit();
}

/** Подписка на изменения очереди. Возвращает функцию отписки. */
export function subscribePendingActions(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Отметить неудачную попытку: attempts++, state='error' | 'unknown'. */
async function markFailure(action: PendingAction, message: string): Promise<void> {
  action.attempts += 1;
  action.lastError = message.slice(0, 300);
  action.state = action.attempts >= MAX_ATTEMPTS ? 'unknown' : 'error';
  logDiag(
    'action-queue',
    'fail ' + action.kind + ' attempts=' + action.attempts + ' state=' + action.state,
  );
  await commit();
}

/** Прочитать строковое поле payload (отсутствующее → пустая строка). */
function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/** Числовое поле payload (отсутствующее/некорректное → 0). */
function readNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value === 'number') {
    return value;
  }
  const parsed = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Значения полей формы выхода (опциональны, только объект). */
function readValues(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const values = payload.values;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    return values as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Назначение визита: проверяем, не назначен ли он уже (datetime_of_session
 * в заявке), и только потом запускаем процесс.
 */
async function processScheduleVisit(
  action: PendingAction,
  account: ElmaAccount,
): Promise<void> {
  const applicationId = readString(action.payload, 'applicationId');
  if (!applicationId) {
    await markFailure(action, 'В отложенном действии нет applicationId');
    return;
  }

  try {
    const {items} = await fetchCollectionItemsByIds(
      account,
      'customer_service',
      'applications',
      [applicationId],
    );
    const item = items[0] as {raw?: Record<string, unknown>} | undefined;
    const raw = item?.raw;
    const sessionDate = raw ? String(raw.datetime_of_session ?? '').trim() : '';
    if (sessionDate !== '') {
      // Визит уже назначен — повторный запуск не нужен, запись убираем.
      logDiag('action-queue', 'schedule-visit already done entity=' + applicationId);
      await removePendingAction(action.id);
      return;
    }

    const result = await runScheduleVisit(account, {
      templateId: readString(action.payload, 'templateId'),
      templateVersion: readNumber(action.payload, 'templateVersion'),
      applicationId,
      formCode: readString(action.payload, 'formCode'),
      visitDateIso: readString(action.payload, 'visitDateIso'),
      masterId: readString(action.payload, 'masterId'),
    });
    if (result.ok) {
      await removePendingAction(action.id);
      return;
    }
    await markFailure(action, result.error || 'Не удалось назначить визит');
  } catch (e: unknown) {
    await markFailure(action, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Завершение задачи выходом: 412 / «задача уже закрыта» означают, что
 * действие на сервере уже выполнено — запись убираем без повторов.
 */
async function processSubmitExit(
  action: PendingAction,
  account: ElmaAccount,
): Promise<void> {
  const taskUuid = readString(action.payload, 'taskUuid');
  const instanceId = readString(action.payload, 'instanceId');
  const exitId = readString(action.payload, 'exitId');
  if (!taskUuid || !instanceId || !exitId) {
    await markFailure(
      action,
      'В отложенном действии нет taskUuid/instanceId/exitId',
    );
    return;
  }

  try {
    const result = await submitTask(
      account,
      instanceId,
      taskUuid,
      exitId,
      readValues(action.payload),
    );
    if (result.ok) {
      await removePendingAction(action.id);
      return;
    }
    const errorText = result.error || '';
    if (result.status === 412 || ALREADY_CLOSED_RE.test(errorText)) {
      // Задача уже закрыта на сервере — считаем действие выполненным.
      logDiag('action-queue', 'submit-exit already closed entity=' + taskUuid);
      await removePendingAction(action.id);
      return;
    }
    await markFailure(action, errorText || 'Не удалось выполнить действие');
  } catch (e: unknown) {
    await markFailure(action, e instanceof Error ? e.message : String(e));
  }
}

/** Обработать одну запись очереди. */
async function processOne(action: PendingAction): Promise<void> {
  if (getRemainingPauseMs(action.accountId) > 0) {
    // Аккаунт на паузе — серия запросов только продлит ограничение ELMA.
    return;
  }
  const account = useAuthStore
    .getState()
    .accounts.find((item) => item.id === action.accountId);
  if (!account) {
    // Аккаунт не найден (удалён или ещё не загружен) — не удаляем, ждём TTL.
    return;
  }
  if (action.kind === 'accept-application') {
    // Нужна капча: автоматически никогда не выполняем.
    return;
  }
  if (action.kind === 'schedule-visit') {
    await processScheduleVisit(action, account);
    return;
  }
  await processSubmitExit(action, account);
}

/**
 * Обработать очередь: устаревшие записи (TTL 24 часа) удаляются, затем
 * каждая запись обрабатывается ПО ОДНОЙ, последовательно, с паузой между ними.
 */
export async function processPendingActions(): Promise<void> {
  if (processing) {
    return;
  }
  processing = true;
  try {
    await loadActions();

    const now = Date.now();
    const alive = actions.filter((item) => now - item.createdAt < TTL_MS);
    if (alive.length !== actions.length) {
      logDiag('action-queue', 'ttl dropped=' + (actions.length - alive.length));
      actions = alive;
      await commit();
    }

    const ids = actions.map((item) => item.id);
    for (let index = 0; index < ids.length; index += 1) {
      if (index > 0) {
        await delay(PROCESS_GAP_MS);
      }
      const action = actions.find((item) => item.id === ids[index]);
      if (!action) {
        continue;
      }
      await processOne(action);
    }
  } finally {
    processing = false;
  }
}
