import {DeviceEventEmitter} from 'react-native';
import {ElmaAccount} from '../types/account';
import {useAuthStore} from '../store/auth-store';
import {useSettingsStore} from '../store/settings-store';
import {useCustomerServiceStore} from '../store/customer-service-store';
import {loadCollection} from './customer-service';
import {isRealtimeSubscribed} from './realtime';
import {
  FAST_POLL_INTERVAL_SEC,
  FAST_POLL_JITTER_MS,
  FAST_MIN_GAP_MS,
  FAST_GAP_JITTER_MS,
  PUSH_FALLBACK_DELAY_MS,
  QUEUE_MIN_GAP_MS,
} from '../config/constants';
import {nextAccountIntervalMs} from '../utils/poll-interval';
import {SYNC_TICK_EVENT, startSyncTicker, stopSyncTicker, delay} from '../native/KeepAlive';
import {logDiag} from '../diag/accept-log';
import {getRemainingPauseMs} from '../infrastructure/AccountThrottle';

const REFRESH_ALL_TIMEOUT_MS = 20_000;
const ACCOUNT_TIMEOUT_MS = 15_000;
const INFLIGHT_STALE_MS = 60_000;
const NETWORK_RETRY_MS = 5_000;
const NETWORK_RETRY_MAX_MS = 60_000;
const THROTTLE_MAX_SHIFT_MS = 30_000;
/** Пауза перед повтором, если сервер вернул подозрительно пустой ответ (возможен бан). */
const EMPTY_RESPONSE_RETRY_MS = 60_000;
const SELF_RECOVERY_MULTIPLIER = 3;
const FRESHNESS_MULTIPLIER = 2;

let dueAt = new Map<string, number>();
let accountsRef: ElmaAccount[] = [];
let cancelledRef = false;
let running = false;
let refreshAllNowRunning = false;
let refreshAllStartedAt = 0;
// Время «пульса» живого обхода refreshApplicationsNow (обновляется на каждой
// итерации). Принудительный сброс флага в onSyncTick ждёт REFRESH_ALL_TIMEOUT_MS
// без пульса — чтобы не сбрасывать флаг, пока цикл реально ещё выполняется.
let refreshAllAliveAt = 0;
// Учётка, которую нужно обновить ПЕРВОЙ при следующем/текущем обходе
// refreshApplicationsNow (тап по уведомлению). Подхватывается идущим циклом.
let pendingPriorityAccountId: string | null = null;
// Время старта последнего НЕприоритетного запроса: разнос применяется только
// к очереди, приоритетные учётки им не пользуются и друг друга не блокируют.
let lastQueueStartRef = Number.MIN_SAFE_INTEGER;
let gapRef = 0;
let inflight = new Map<string, number>();
let tickSubscription: {remove: () => void} | null = null;
let lastTickAt = 0;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

let retryDelayById = new Map<string, number>();

// Монотонно растущий «поколенческий» номер запроса по учётке. Позволяет
// проверить, что завершившийся запрос всё ещё актуален (не «призрак» от
// старого запуска после таймаута), и не перезаписывать dueAt свежим стартом.
let requestGen = new Map<string, number>();

/** Следующий поколенческий номер запроса для учётки. */
function nextRequestGen(accId: string): number {
  const next = (requestGen.get(accId) ?? 0) + 1;
  requestGen.set(accId, next);
  return next;
}

/** Актуален ли запрос учётки с указанным поколением (не был ли он вытеснен). */
function isRequestCurrent(accId: string, gen: number): boolean {
  return requestGen.get(accId) === gen;
}

// Учётки, чьи заявки видит пользователь на экране списка заявок (пусто — boost выключен).
const foregroundAccounts = new Set<string>();
// Результат последней попытки обновления учётки: true — успех, false/нет — сбой.
let lastAttemptOk = new Map<string, boolean>();

// Пуш-режим: момент, когда realtime учётки «отвалился» (не subscribed).
// Пока разрыв короче PUSH_FALLBACK_DELAY_MS — периодический опрос не идёт;
// после порога он временно включается, пока подписка не восстановится.
let pushDetachedSince = new Map<string, number>();

/** Включён ли пуш-режим (список обновляется из realtime, без периодического опроса). */
function isPushMode(): boolean {
  return useSettingsStore.getState().pushMode === true;
}

/**
 * Нужно ли опрашивать учётку в пуш-режиме. В обычном режиме — всегда да.
 * В пуш-режиме: пока realtime учётки `subscribed` — опрос выключен; если
 * подписка отвалилась дольше PUSH_FALLBACK_DELAY_MS — опрос включается
 * (страховка от потери заявок при обрыве пуша), восстановление — снова гаснет.
 */
function shouldPollInPushMode(accId: string, now: number): boolean {
  if (!isPushMode()) {
    return true;
  }
  let subscribed = false;
  try {
    // Статический импорт: направление realtime -> applications-sync остаётся
    // ленивым (require в realtime.ts), чтобы не возникла циклическая зависимость.
    subscribed = typeof isRealtimeSubscribed === 'function'
      && isRealtimeSubscribed(accId);
  } catch {
    subscribed = false;
  }
  if (subscribed) {
    pushDetachedSince.delete(accId);
    return false;
  }
  const since = pushDetachedSince.get(accId);
  if (since === undefined) {
    pushDetachedSince.set(accId, now);
    return false;
  }
  return now - since > PUSH_FALLBACK_DELAY_MS;
}

function currentIntervalMs(): number {
  const baseMs = useSettingsStore.getState().pollIntervalSec * 1000;
  return nextAccountIntervalMs(baseMs, Math.round(baseMs * 0.5));
}

/**
 * Разнос между стартами учёток очереди: интервал опроса делится на число
 * учёток в очереди, чтобы каждая успевала в свой интервал. Нижняя граница —
 * QUEUE_MIN_GAP_MS. Чистая функция — для тестов.
 */
export function computeQueueGapMs(intervalMs: number, queueCount: number): number {
  const n = Math.max(1, Math.floor(queueCount));
  return Math.max(QUEUE_MIN_GAP_MS, Math.round(intervalMs / n));
}

/** Текущий разнос очереди: интервал из настроек / число неприоритетных учёток + джиттер. */
function nextQueueGapMs(): number {
  const intervalMs = useSettingsStore.getState().pollIntervalSec * 1000;
  const queueCount = Math.max(1, accountsRef.filter(a => !isPriorityAccount(a.id)).length);
  const base = computeQueueGapMs(intervalMs, queueCount);
  return base + Math.floor(Math.random() * Math.max(1, Math.round(base * 0.2)));
}

/** Приоритетные учётки из настроек (стор может быть замокан без поля). */
function priorityIdList(): string[] {
  const ids = useSettingsStore.getState().priorityAccountIds ?? [];
  return Array.isArray(ids) ? ids : [];
}

/**
 * Приоритетная учётка (из настроек) идёт отдельным путём: старт каждые
 * FAST_POLL_INTERVAL_SEC ± FAST_POLL_JITTER_MS без разноса и без
 * случайной паузы между запросами. Как и boost — только после успеха.
 */
function isPriorityAccount(accId: string): boolean {
  return priorityIdList().includes(accId) && lastAttemptOk.get(accId) === true;
}

/** Boost видимых (foreground) учёток: только после успешной попытки. */
function isForegroundBoost(accId: string): boolean {
  return foregroundAccounts.has(accId) && lastAttemptOk.get(accId) === true;
}

/**
 * Интервал до следующего обновления учётки:
 * приоритетная → 5 с ± 1 с, foreground → ускоренный, иначе обычный.
 */
function intervalForAccount(accId: string): number {
  if (isPriorityAccount(accId)) {
    return nextAccountIntervalMs(
      FAST_POLL_INTERVAL_SEC * 1000 - FAST_POLL_JITTER_MS,
      FAST_POLL_JITTER_MS * 2,
    );
  }
  if (isForegroundBoost(accId)) {
    return nextAccountIntervalMs(FAST_POLL_INTERVAL_SEC * 1000, FAST_GAP_JITTER_MS);
  }
  return currentIntervalMs();
}

/**
 * Сбросить dueAt перечисленных учёток в 0, если он в будущем или отсутствует,
 * — ближайший тик обновит их сразу. Общий хелпер для setForegroundAccounts
 * и applyPriorityAccounts (логика идентична в обоих случаях).
 */
function bumpDueAt(ids: readonly string[]): void {
  const now = Date.now();
  for (const id of ids) {
    const due = dueAt.get(id);
    if (due === undefined || due > now) {
      dueAt.set(id, 0);
    }
  }
}

/**
 * Включает/выключает ускоренный опрос видимых учёток.
 * Общий темп к серверу не растёт: старты по-прежнему разнесены minGap,
 * ускоренные учётки лишь чередуются в этом же разносе.
 * При включении dueAt каждой учётки сбрасывается в 0 (если он в будущем или отсутствует),
 * чтобы ближайший тик сразу обновил её.
 */
export function setForegroundAccounts(accountIds: string[]): void {
  if (accountIds.length === 0) {
    foregroundAccounts.clear();
    logDiag('applications-sync', 'foreground-accounts cleared');
    return;
  }
  foregroundAccounts.clear();
  for (const id of accountIds) {
    foregroundAccounts.add(id);
  }
  bumpDueAt(accountIds);
  logDiag('applications-sync', 'foreground-accounts count=' + foregroundAccounts.size);
}

/**
 * Приоритетные учётки из настроек: опрашиваются каждые 5 с ± 1 с отдельным
 * проходом onSyncTick — без разноса и без случайной паузы, не блокируя друг
 * друга и очередь. Остальные учётки продолжают обновляться по обычному
 * интервалу во втором проходе (по ближайшему dueAt).
 * При включении dueAt каждой учётки сбрасывается в 0 (если он в будущем или
 * отсутствует), чтобы ближайший тик обновил её сразу.
 */
export function applyPriorityAccounts(accountIds: string[]): void {
  bumpDueAt(accountIds);
  logDiag('applications-sync', 'priority-accounts count=' + accountIds.length);
}

function freshAccount(acc: ElmaAccount): ElmaAccount {
  return useAuthStore.getState().accounts.find(a => a.id === acc.id) ?? acc;
}

async function refreshOneAccount(acc: ElmaAccount, gen = nextRequestGen(acc.id)): Promise<boolean> {
  // Учётка на паузе (бан/429 из AccountThrottle): запросы не отправляем — иначе
  // каждый тик сыпал бы «Rate limited: 429» и зря дёргал сервер. Список не трогаем.
  const pauseLeft = getRemainingPauseMs(acc.id);
  if (pauseLeft > 0) {
    dueAt.set(acc.id, Date.now() + pauseLeft + Math.round(Math.random() * 5_000));
    logDiag('applications-sync', `tick-skip reason=paused account=${acc.id} left=${pauseLeft}ms`);
    return false;
  }
  const account = freshAccount(acc);
  try {
    const result = await loadCollection(account, 'applications');
    // Запрос мог быть «призраком» от таймаута в refreshApplicationsNow: если его
    // поколение уже вытеснено новым стартом, расписание не трогаем.
    if (!isRequestCurrent(acc.id, gen)) {
      return false;
    }
    if (!result.ok) {
      // После любого сбоя ускорение выключается до следующего успеха.
      lastAttemptOk.set(acc.id, false);
      const isNetwork = result.kind === 'network' || result.kind === 'timeout';
      if (isNetwork) {
        const delay = retryDelayById.get(acc.id) ?? NETWORK_RETRY_MS;
        dueAt.set(acc.id, Date.now() + delay);
        retryDelayById.set(acc.id, Math.min(delay * 2, NETWORK_RETRY_MAX_MS));
        return false;
      }
      if (result.error === 'empty-response') {
        // Сервер отдал пустой список при непустом кэше — вероятен временный бан.
        // Повторяем позже и НЕ трогаем уже показанные данные.
        const wait = EMPTY_RESPONSE_RETRY_MS + Math.round(Math.random() * 30_000);
        dueAt.set(acc.id, Date.now() + wait);
        logDiag('applications-sync', `empty-response-retry account=${acc.id} wait=${wait}ms`);
        return false;
      }
      if (result.kind === 'rate' || result.kind === 'other') {
        const nextDue = Date.now() + Math.min(THROTTLE_MAX_SHIFT_MS, currentIntervalMs());
        dueAt.set(acc.id, nextDue);
        return false;
      }
      dueAt.set(acc.id, Date.now() + currentIntervalMs());
      return true;
    }
    useCustomerServiceStore.getState().setLastRefreshAt(acc.id, Date.now());
    const n = useCustomerServiceStore.getState().getItems(acc.id, 'applications').length;
    const now = Date.now();
    logDiag('applications-sync', `refresh-ok account=${acc.id} items=${n} ts=${now}`);
    retryDelayById.delete(acc.id);
    lastAttemptOk.set(acc.id, true);
    dueAt.set(acc.id, Date.now() + intervalForAccount(acc.id));
    return true;
  } catch {
    if (!isRequestCurrent(acc.id, gen)) {
      return false;
    }
    lastAttemptOk.set(acc.id, false);
    const delay = retryDelayById.get(acc.id) ?? NETWORK_RETRY_MS;
    dueAt.set(acc.id, Date.now() + delay);
    retryDelayById.set(acc.id, Math.min(delay * 2, NETWORK_RETRY_MAX_MS));
    return false;
  }
}

function isAccountOverdue(accId: string, now: number): boolean {
  const intervalMs = currentIntervalMs();
  const lastRefresh = useCustomerServiceStore.getState().lastRefreshAt[accId] ?? 0;
  return now - lastRefresh > FRESHNESS_MULTIPLIER * intervalMs;
}

function cleanupStaleInflight(now: number): void {
  for (const [id, startedAt] of inflight) {
    if (now - startedAt > INFLIGHT_STALE_MS) {
      inflight.delete(id);
      logDiag('applications-sync', `inflight-stale removed=${id}`);
    }
  }
}

function startWatchdog(): void {
  stopWatchdog();
  const intervalMs = Math.min(currentIntervalMs() * SELF_RECOVERY_MULTIPLIER, 30_000);
  watchdogTimer = setInterval(() => {
    const now = Date.now();
    if (lastTickAt > 0 && now - lastTickAt > SELF_RECOVERY_MULTIPLIER * currentIntervalMs()) {
      logDiag('applications-sync', 'self-recovery: ticker stuck, restarting');
      stopSyncTicker();
      startSyncTicker();
      // Удаляем прежний листенер, иначе на каждый перезапуск создаётся новый
      // и onSyncTick вызывался бы несколько раз на один и тот же тик.
      if (tickSubscription) {
        tickSubscription.remove();
        tickSubscription = null;
      }
      tickSubscription = DeviceEventEmitter.addListener(SYNC_TICK_EVENT, onSyncTick);
      lastTickAt = now;
      onSyncTick();
    }
  }, intervalMs);
}

function stopWatchdog(): void {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function onSyncTick(): void {
  lastTickAt = Date.now();
  const now = Date.now();

  // Очистка устаревших inflight ВЫШЕ всех ранних return.
  cleanupStaleInflight(now);

  // Если refreshAllNowRunning НЕ подаёт признаков жизни дольше таймаута —
  // принудительно сбрасываем. refreshAllAliveAt обновляется на каждой итерации
  // живого обхода, поэтому флаг НЕ сбрасывается, пока цикл ещё выполняется
  // (иначе следующий тик запустил бы второй конкурентный обход).
  if (refreshAllNowRunning && now - refreshAllAliveAt > REFRESH_ALL_TIMEOUT_MS) {
    refreshAllNowRunning = false;
    refreshAllStartedAt = 0;
    refreshAllAliveAt = 0;
    logDiag('applications-sync', 'refreshAllNow timeout forced-reset');
  }

  if (cancelledRef || accountsRef.length === 0) {
    logDiag('applications-sync', `tick-skip reason=${cancelledRef ? 'cancelled' : 'no-accounts'}`);
    return;
  }
  if (refreshAllNowRunning) {
    logDiag('applications-sync', 'tick-skip reason=refreshAllNow');
    return;
  }
  if (useSettingsStore.getState().syncPaused) {
    logDiag('applications-sync', 'tick-skip reason=paused');
    return;
  }

  // --- Проход 1: приоритетные учётки — свой темп (5 с ± 1 с). Разнос очереди
  // (lastQueueStartRef/gapRef) здесь НЕ проверяется и НЕ обновляется: приоритетные
  // обновляются независимо и на очередь не влияют.
  let priorityCandidate: ElmaAccount | null = null;
  let priorityDue = 0;
  for (const acc of accountsRef) {
    // В пуш-режиме подписанные на realtime учётки не опрашиваются периодически.
    if (
      !isPriorityAccount(acc.id) ||
      inflight.has(acc.id) ||
      !shouldPollInPushMode(acc.id, now)
    ) {
      continue;
    }
    const due = dueAt.get(acc.id) ?? 0;
    if (now < due) {
      continue;
    }
    if (priorityCandidate === null || due < priorityDue) {
      priorityCandidate = acc;
      priorityDue = due;
    }
  }
  if (priorityCandidate !== null) {
    logDiag(
      'applications-sync',
      `priority-start account=${priorityCandidate.id} overdue=${now - priorityDue}ms`,
    );
    const priorityAcc = priorityCandidate;
    inflight.set(priorityAcc.id, now);
    refreshOneAccount(priorityAcc)
      .finally(() => {
        inflight.delete(priorityAcc.id);
      });
    // За один тик стартует не более одной учётки: очередь ждёт следующий тик (~1с).
    return;
  }

  // --- Проход 2: очередь остальных учёток. Если в этом тике уже стартовала
  // приоритетная учётка (return выше), очередь пропускает тик и стартует в
  // следующий «свободный». Разнос очереди считается от последнего
  // неприоритетного старта — приоритетные его не сдвигают.
  let candidate: ElmaAccount | null = null;
  let candidateDue = 0;
  for (const acc of accountsRef) {
    if (isPriorityAccount(acc.id)) {
      // Приоритетные ведёт проход 1: ветки isAccountOverdue там нет,
      // их свежесть проверяется только обычным dueAt.
      continue;
    }
    if (inflight.has(acc.id)) {
      continue;
    }
    // В пуш-режиме подписанные на realtime учётки не опрашиваются периодически.
    if (!shouldPollInPushMode(acc.id, now)) {
      continue;
    }
    const due = dueAt.get(acc.id) ?? 0;
    if (now < due) {
      continue;
    }
    // Если учётка просрочена более чем на 2× pollIntervalSec — она в приоритете
    // очереди. НЕ сбрасываем inflight: если по учётке уже висит живой запрос,
    // он завершится и снимет маркер, а следующий тик обновит учётку — иначе
    // запустился бы второй параллельный запрос к серверу (риск бана).
    if (isAccountOverdue(acc.id, now)) {
      candidate = acc;
      candidateDue = due;
      break;
    }
    if (candidate === null || due < candidateDue) {
      candidate = acc;
      candidateDue = due;
    }
  }
  if (candidate === null) {
    logDiag('applications-sync', 'tick-skip reason=no-due');
    return;
  }

  // Разнос очереди: для foreground-учётки — меньше обычного, для обычной — gapRef.
  const minGap = isForegroundBoost(candidate.id)
    ? FAST_MIN_GAP_MS + Math.floor(Math.random() * FAST_GAP_JITTER_MS)
    : gapRef;
  if (now - lastQueueStartRef < minGap) {
    logDiag('applications-sync', 'tick-skip reason=gap queue');
    return;
  }

  lastQueueStartRef = now;
  gapRef = nextQueueGapMs();

  const acc = candidate;
  inflight.set(acc.id, now);
  refreshOneAccount(acc)
    .finally(() => {
      inflight.delete(acc.id);
    });
}

export function startApplicationsSync(accounts: ElmaAccount[]): void {
  stopApplicationsSync();
  if (accounts.length === 0 || useSettingsStore.getState().syncPaused) {
    return;
  }
  cancelledRef = false;
  running = true;
  retryDelayById = new Map();
  accountsRef = accounts;

  const now = Date.now();
  const initialGap = nextQueueGapMs();
  lastQueueStartRef = now - initialGap;
  gapRef = initialGap;
  // Приоритетные учётки ставим в начало очереди первого опроса (стабильная
  // сортировка сохраняет порядок внутри групп); accountsRef не меняем —
  // выбор кандидата по dueAt работает как раньше.
  const priority = new Set(priorityIdList());
  const orderedAccounts = [...accounts].sort(
    (a, b) => Number(priority.has(b.id)) - Number(priority.has(a.id)),
  );
  orderedAccounts.forEach((acc, index) => {
    dueAt.set(acc.id, index === 0 ? now : now + index * initialGap);
  });

  // В пуш-режиме периодический опрос выключен, но при старте список грузим
  // один раз каждой учётке (дальше — только из realtime-пуша). Подписанные
  // учётки повторно в этом режиме не опрашиваются.
  if (isPushMode()) {
    for (const acc of orderedAccounts) {
      const account = freshAccount(acc);
      void refreshOneAccount(account).catch(() => {});
    }
  }

  lastTickAt = now;
  startSyncTicker();
  tickSubscription = DeviceEventEmitter.addListener(SYNC_TICK_EVENT, onSyncTick);
  startWatchdog();
  onSyncTick();
}

export function stopApplicationsSync(): void {
  cancelledRef = true;
  running = false;
  retryDelayById = new Map();
  foregroundAccounts.clear();
  lastAttemptOk.clear();
  if (tickSubscription) {
    tickSubscription.remove();
    tickSubscription = null;
  }
  stopSyncTicker();
  stopWatchdog();
  dueAt = new Map();
  inflight = new Map();
  accountsRef = [];
  refreshAllNowRunning = false;
  refreshAllStartedAt = 0;
  refreshAllAliveAt = 0;
  pendingPriorityAccountId = null;
  requestGen = new Map();
  pushDetachedSince = new Map();
  lastTickAt = 0;
}

export async function refreshApplicationsNow(priorityAccountId?: string): Promise<void> {
  if (priorityAccountId) {
    pendingPriorityAccountId = priorityAccountId;
  }
  if (refreshAllNowRunning) {
    return;
  }
  refreshAllNowRunning = true;
  refreshAllStartedAt = Date.now();
  refreshAllAliveAt = refreshAllStartedAt;
  try {
    const remaining = accountsRef.map(freshAccount);
    let usedPriority: string | null = null;
    // Учётки обходим ПОСЛЕДОВАТЕЛЬНО с паузой: одновременный залп по всем аккаунтам
    // сервер ELMA воспринимает как флуд и отвечает пустыми списками.
    const total = remaining.length;
    while (remaining.length > 0) {
      const priorityIdx = pendingPriorityAccountId
        ? remaining.findIndex(a => a.id === pendingPriorityAccountId)
        : -1;
      let acc: ElmaAccount;
      if (priorityIdx >= 0) {
        acc = remaining.splice(priorityIdx, 1)[0];
        usedPriority = acc.id;
        pendingPriorityAccountId = null;
      } else {
        acc = remaining.shift() as ElmaAccount;
      }
      inflight.set(acc.id, Date.now());
      // Поколение этого запроса; после таймаута оно инвалидируется, чтобы
      // поздний «призрак» (зависший refreshOneAccount) не перезаписал сдвиг.
      const startedGen = nextRequestGen(acc.id);
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<boolean>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('timeout')), ACCOUNT_TIMEOUT_MS);
      });
      try {
        await Promise.race([refreshOneAccount(acc, startedGen), timeout]);
      } catch {
        nextRequestGen(acc.id);
        dueAt.set(acc.id, Date.now() + THROTTLE_MAX_SHIFT_MS);
        logDiag(
          'applications-sync',
          `account-timeout account=${acc.id} shift=${THROTTLE_MAX_SHIFT_MS}ms`,
        );
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        inflight.delete(acc.id);
      }
      refreshAllAliveAt = Date.now();
      if (remaining.length > 0) {
        await delay(1500 + Math.round(Math.random() * 1500));
      }
    }
    lastQueueStartRef = Date.now();
    gapRef = nextQueueGapMs();
    logDiag(
      'applications-sync',
      `refresh-all-done accounts=${total} priority=${usedPriority ?? '-'} ts=${Date.now()}`,
    );
  } catch {
    // Обход идёт последовательно (while + Promise.race) — сюда попадает только
    // непредвиденная ошибка; флаг сбросится в finally.
  } finally {
    refreshAllNowRunning = false;
    refreshAllStartedAt = 0;
    refreshAllAliveAt = 0;
  }
}

export function isApplicationsSyncRunning(): boolean {
  return running;
}

export function getLastTickAt(): number {
  return lastTickAt;
}

export function getRefreshAllStartedAt(): number {
  return refreshAllStartedAt;
}
