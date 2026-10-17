// ---------------------------------------------------------------------------
// Realtime (WebSocket / Centrifugo): подключение к realtime-каналу портала.
//
// Строго read-only: здесь только подключение, подписка и приём публикаций.
// Никаких POST/PUT и никаких изменяющих запросов к порталу не отправляется.
// Опрос заявок (applications-sync) realtime НЕ заменяет и НЕ изменяет:
// realtime лишь дополнительно дёргает обновление списка (debounce 2 с).
// Приём публикаций показывает локальные уведомления (feed/target/message).
// ---------------------------------------------------------------------------

import {Centrifuge} from 'centrifuge';
import {DeviceEventEmitter} from 'react-native';
import type {ElmaAccount} from '../types/account';
import {logDiag} from '../diag/accept-log';
import {maskValue} from '../utils/mask';
import {errorText} from '../utils/error-text';
import {SYNC_TICK_EVENT} from '../native/KeepAlive';
import type {AlertOptions} from '../native/KeepAlive';
import * as SettingsStore from '../store/settings-store';
import * as SeenApplicationAlerts from './seen-application-alerts';
import {
  DEFAULT_NEW_APPLICATION_SOUND,
  DEFAULT_OTHER_SOUND,
  DEFAULT_ALERT_VOLUME,
} from '../config/constants';

/** Тег диагностического журнала. */
const TAG = 'realtime';

/** Путь websocket-эндпоинта портала (relative to baseUrl). */
const WS_PATH = '/ws/v2/websocket';

/** Максимальная длина JSON-payload в диагностическом логе. */
const PAYLOAD_LOG_LIMIT = 300;

/** Сервисы portal-frontend: для каждого — свой пользовательский канал. */
export const REALTIME_SERVICES: readonly string[] = ['', 'feed', 'crm', 'events', 'chat'];

/** Событие личного уведомления портала (новая заявка/задача) вида feed/target/message. */
const FEED_MESSAGE_EVENT = 'feed/target/message';

/** Событие объектного обновления портала (task-created и др.) — только diag, без пуша. */
const OBJECT_EVENT = 'object';

/** Тип локального уведомления по содержанию title/body portal-сообщения. */
export type NotificationKind = 'task-new' | 'application-new' | 'status' | 'other';

/**
 * Классифицировать feed-уведомление по нормализованному тексту (title + body,
 * нижний регистр): новые задачи / новые заявки / смена статуса / прочее.
 */
export function classifyNotification(title: string, body: string): NotificationKind {
  const text = `${title} ${body}`.toLowerCase();
  if (text.includes('задач')) {
    if (
      text.includes('поставлена') ||
      text.includes('назначена') ||
      text.includes('создана') ||
      text.includes('новая задача') ||
      text.includes('вам назначена')
    ) {
      return 'task-new';
    }
    return 'status';
  }
  if (text.includes('заявк')) {
    if (
      text.includes('новая заявка') ||
      text.includes('появилась') ||
      text.includes('создана заявка') ||
      text.includes('поступила')
    ) {
      return 'application-new';
    }
    return 'status';
  }
  return 'other';
}

/** Префикс BPM-событий broadcast-канала — триггер обновления списка заявок. */
const BPM_INSTANCE_EVENT_PREFIX = 'app/bpm/instance/';

/** Префикс объектных событий портала (instance/end и др.) — тоже триггер обновления. */
const INSTANCE_EVENT_PREFIX = 'instance/';

/** Debounce обновления заявок из realtime: не чаще 1 раза в 2000 мс на учётку. */
const APPLICATIONS_REFRESH_DEBOUNCE_MS = 2000;

/** Сколько последних message.__id помнит дедупликация уведомлений. */
const SEEN_MESSAGE_IDS_LIMIT = 200;

/** Состояние соединения realtime для периодического статуса в diag-логе. */
type RealtimeState = 'connecting' | 'connected' | 'subscribed' | 'closed';

/** Одно активное соединение realtime на учётку. */
interface RealtimeEntry {
  account: ElmaAccount;
  client: Centrifuge;
  /** Уже созданные подписки — чтобы не дублировать их на реконнекте. */
  channels: Set<string>;
  /** Текущее состояние соединения (для периодического status-лога). */
  state: RealtimeState;
  /** Каналы, по которым на текущем соединении уже пришёл subscribed. */
  subscribedChannels: Set<string>;
  /** Момент (Date.now()) последнего успешного старта/перезапуска соединения. */
  startedAt: number;
  /** Момент последнего перезапуска сторожем (0 — ещё не перезапускалось). */
  lastRestartAt: number;
  /** Момент последнего входящего события realtime на этом соединении (pub/publication). */
  lastActivityAt: number;
}

const entries = new Map<string, RealtimeEntry>();

/** Интервал сторожа realtime: строка статуса + проверка необходимости перезапуска. */
export const REALTIME_WATCHDOG_INTERVAL_MS = 60000;

/** Минимальная пауза между перезапусками одной учётки сторожем. */
export const REALTIME_RESTART_MIN_GAP_MS = 30000;

/** Максимальный возраст соединения: старше — перезапуск сторожем (reason=age). */
export const REALTIME_MAX_CONNECTION_AGE_MS = 15 * 60 * 1000;

/**
 * Порог «залипшего» соединения: если состояние не `subscribed` дольше этого
 * времени (connecting/connected после обрыва в фоне) — перезапуск (reason=stale).
 */
export const REALTIME_STALE_MS = 45000;

/**
 * Минимальная пауза между проверками здоровья по нативному тику:
 * RN замораживает JS-таймеры в фоне, а нативный тикер продолжает идти.
 */
export const REALTIME_TICK_HEALTH_MIN_GAP_MS = 10000;

/**
 * Минимальная пауза между heartbeat-записями строки status по нативному тику:
 * в фоне JS-setInterval заморожен, поэтому пульс пишем от нативного тикера.
 */
export const REALTIME_HEARTBEAT_MIN_GAP_MS = 60000;

/**
 * Порог тишины входящих событий realtime: если subscribed-соединение дольше
 * этого времени не получало ни одного входящего события (pub/publication/message),
 * оно считается молчащим и подлежит перезапуску сторожем (reason=silent).
 * Страховка от «тихо умерших» в фоне сокeтов, у которых нативный тикер
 * не видит событий, но состояние остаётся 'subscribed'.
 */
export const REALTIME_SILENCE_MS = 10 * 60 * 1000;

/** Таймер сторожа: создаётся лениво при первом соединении, чистится при последнем. */
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

/** Подписка на нативный тикер сторожа (живёт, пока есть соединения). */
let tickSubscription: {remove: () => void} | null = null;

/** Момент последней проверки здоровья по нативному тику (троттлинг тика). */
let lastTickHealthAt = 0;

/** Момент последней heartbeat-записи status по нативному тику (троттлинг). */
let lastHeartbeatAt = 0;

/** Время последнего входящего события realtime (message/publication), 0 — ещё не было. */
let lastRealtimeEventAt = 0;

/**
 * Построение websocket-URL из baseUrl учётки:
 * http -> ws, https -> wss, путь `/ws/v2/websocket`.
 */
export function buildRealtimeUrl(baseUrl: string): string {
  const raw = baseUrl === undefined || baseUrl === null ? '' : String(baseUrl);
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withWsScheme = trimmed.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
  return withWsScheme + WS_PATH;
}

/**
 * Имя пользовательского канала: `<service>:private.<company>#<userID>`.
 * Для базового сервиса service='' имя начинается с ':'.
 */
export function buildPrivateChannel(service: string, company: string, userID: string): string {
  return service + ':private.' + company + '#' + userID;
}

/** Все пользовательские каналы для company/userID (по одному на сервис). */
export function buildRealtimeChannels(company: string, userID: string): string[] {
  return REALTIME_SERVICES.map(service => buildPrivateChannel(service, company, userID));
}

/** Есть ли активное соединение realtime у учётки. */
export function isRealtimeRunning(accountId: string): boolean {
  return entries.has(accountId);
}

/**
 * Дошло ли realtime-соединение учётки до состояния `subscribed` (все каналы
 * подписаны). Используется в пуш-режиме: пока подписка есть — опрос списка
 * не нужен; как только она «отвалилась» — включается страховочный опрос.
 */
export function isRealtimeSubscribed(accountId: string): boolean {
  const entry = entries.get(accountId);
  if (entry === undefined) {
    return false;
  }
  if (entry.state !== 'subscribed') {
    return false;
  }
  // Молчащее subscribed-соединение не считается активным: пока тишина держится,
  // включается страховочный опрос; сокет пересоздаётся сторожем (нативный тик
  // в фоне, возврат из фона).
  if (Date.now() - entry.lastActivityAt > REALTIME_SILENCE_MS) {
    return false;
  }
  return true;
}

/** Число активных соединений (диагностика/тесты). */
export function realtimeConnectionsCount(): number {
  return entries.size;
}

/**
 * Имена cookie из строки вида `a=1; b=2` — только для диагностики.
 * Значения cookie в лог не попадают (безопасность).
 */
function listCookieNames(cookies: string): string[] {
  const names: string[] = [];
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    const name = (separator === -1 ? part : part.slice(0, separator)).trim();
    if (name !== '') {
      names.push(name);
    }
  }
  return names;
}

/**
 * Фабрика кастомного WebSocket-конструктора, пробрасывающего cookie-сессию
 * аккаунта заголовком `Cookie` в HTTP-рукопожатие WebSocket.
 *
 * Так же авторизуется браузерный веб-клиент портала: same-origin WebSocket
 * несёт cookie автоматически, а ELMA API-токен Centrifugo НЕ принимает.
 * Паттерн — раздел «Custom WebSocket constructor» в README centrifuge:
 * 1 аргумент (url) → добавляем субпротокол и options, 2 аргумента
 * (url, protocols) → options третьим аргументом. `Authorization` не добавляем.
 *
 * @param cookieHeader Строка cookie аккаунта (account.cookies).
 */
export function createRealtimeWebSocket(cookieHeader: string): typeof WebSocket {
  const options = {headers: {Cookie: cookieHeader}};
  const BaseWebSocket = globalThis.WebSocket as unknown as new (...args: any[]) => WebSocket;

  const RealtimeWebSocket = class extends BaseWebSocket {
    constructor(...args: any[]) {
      if (args.length === 1) {
        super(...[...args, 'centrifuge-json', options]);
      } else {
        super(...[...args, options]);
      }
    }
  };

  return RealtimeWebSocket as unknown as typeof WebSocket;
}

/**
 * Открыть одно realtime-соединение для учётки.
 * Повторный вызов закрывает предыдущее соединение учётки.
 * Авторизация — по cookie-сессии (заголовок `Cookie` в рукопожатии WS),
 * API-токен в Centrifugo не передаётся.
 */
export function startRealtime(account: ElmaAccount): void {
  if (!account || !account.id) {
    return;
  }
  stopRealtime(account.id);

  const cookies = typeof account.cookies === 'string' ? account.cookies.trim() : '';
  const cookieNames = cookies === '' ? [] : listCookieNames(cookies);
  if (cookieNames.length === 0) {
    logDiag(TAG, `start-skip reason=no-cookies account=${maskValue(account.id)}`);
    return;
  }

  const url = buildRealtimeUrl(account.baseUrl);
  if (!/^wss?:\/\//i.test(url)) {
    logDiag(TAG, `start-skip reason=bad-url account=${maskValue(account.id)} url=${url}`);
    return;
  }

  let client: Centrifuge;
  try {
    client = new Centrifuge(url, {websocket: createRealtimeWebSocket(cookies)});
  } catch (error) {
    logDiag(TAG, `start-failed account=${maskValue(account.id)} error=${errorText(error)}`);
    return;
  }

  const entry: RealtimeEntry = {
    account,
    client,
    channels: new Set<string>(),
    state: 'connecting',
    subscribedChannels: new Set<string>(),
    startedAt: Date.now(),
    lastRestartAt: 0,
    lastActivityAt: Date.now(),
  };
  entries.set(account.id, entry);
  wireClient(entry);

  try {
    client.connect();
  } catch (error) {
    entries.delete(account.id);
    logDiag(TAG, `start-failed account=${maskValue(account.id)} error=${errorText(error)}`);
    return;
  }
  logDiag(
    TAG,
    `start account=${maskValue(account.id)} url=${url} cookies=${cookieNames.length} names=${cookieNames.join(
      ',',
    )}`,
  );
  ensureWatchdogTimer();
}

/** Закрыть realtime-соединение учётки (no-op, если соединения нет). */
export function stopRealtime(accountId: string): void {
  const entry = entries.get(accountId);
  if (!entry) {
    return;
  }
  entries.delete(accountId);
  // Debounce-маркер обновления заявок — справочник, живёт вместе с соединением:
  // при остановке учётки ключ чистится, карта не растёт бесконечно.
  refreshRequestedAt.delete(accountId);
  clearWatchdogTimerIfIdle();
  try {
    for (const channel of Array.from(entry.channels)) {
      try {
        const sub = entry.client.getSubscription(channel);
        if (sub) {
          sub.removeAllListeners();
          entry.client.removeSubscription(sub);
        }
      } catch {
        // подписка могла быть уже удалена сервером — не критично
      }
    }
    entry.client.removeAllListeners();
    entry.client.disconnect();
  } catch (error) {
    logDiag(TAG, `stop-failed account=${maskValue(accountId)} error=${errorText(error)}`);
  }
  logDiag(TAG, `stop account=${maskValue(accountId)}`);
}

/** Закрыть все realtime-соединения (логаут/остановка приложения). */
export function stopAllRealtime(): void {
  for (const accountId of Array.from(entries.keys())) {
    stopRealtime(accountId);
  }
  clearWatchdogTimerIfIdle();
}

/**
 * Привести набор соединений к списку активных учёток:
 * недостающие — открыть, лишние — закрыть, изменённые baseUrl/token —
 * переподключить. Уже работающие соединения не пересоздаются.
 */
export function syncRealtimeAccounts(accounts: readonly ElmaAccount[]): void {
  const alive = new Set<string>();
  for (const account of accounts) {
    if (!account || !account.id) {
      continue;
    }
    alive.add(account.id);
    const entry = entries.get(account.id);
    if (!entry) {
      startRealtime(account);
      continue;
    }
    if (entry.account.baseUrl !== account.baseUrl || entry.account.token !== account.token) {
      startRealtime(account);
      continue;
    }
    entry.account = account;
  }
  for (const accountId of Array.from(entries.keys())) {
    if (!alive.has(accountId)) {
      stopRealtime(accountId);
    }
  }
}

// ---------------------------------------------------------------------------
// Этап 2: уведомления о новых заявках/задачах и триггеры обновления списков.
// Только приём входящих публикаций — никаких POST/PUT не отправляется.
// ---------------------------------------------------------------------------

/** Последние message.__id: защищает от повторных уведомлений при реконнекте. */
const seenMessageIds = new Set<string>();

/** Время последнего запроса обновления заявок по учётке (debounce). */
const refreshRequestedAt = new Map<string, number>();

/** Разрывы строк/абзацев в HTML-тексте portal-уведомления → обычный пробел. */
const HTML_BREAK_TAGS = /<\s*br\s*\/?\s*>|<\/\s*(p|div|li|tr|h[1-6])\s*>/gi;

/** Остальные HTML-теги удаляются без подстановки (текст словарей склеен). */
const HTML_TAGS = /<\/?[a-z][^>]*>/gi;

/** HTML-сущности: именованные и числовые (&nbsp;, &amp;, &#39;, &#x27; …). */
const HTML_ENTITIES = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  copy: '©',
  gt: '>',
  hellip: '…',
  laquo: '«',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  raquo: '»',
  reg: '®',
};

/** Нативный модуль уведомлений (см. src/native/KeepAlive.ts). */
interface KeepAliveModule {
  alertNewItem?: (
    title: string,
    body: string,
    options?: AlertOptions,
    accountId?: string | null,
  ) => void;
  notifyTask?: (title: string, body: string, options?: AlertOptions) => void;
  pulseOverlayWidget?: () => void;
}

/** Механизм обновления списка заявок (src/services/applications-sync.ts). */
interface ApplicationsSyncModule {
  refreshApplicationsNow?: (priorityAccountId?: string) => Promise<void>;
}

/** Стор настроек приложения (src/store/settings-store). */
interface SettingsStoreModule {
  useSettingsStore?: {
    getState?: () => Partial<NotificationSettings>;
  };
}

/** Хранилище ключей «уже уведомлённых» заявок (src/services/seen-application-alerts). */
interface SeenApplicationAlertsModule {
  loadSeenKeys?: () => Promise<Set<string>>;
  persistSeenKeys?: (seen: Set<string>) => void;
  markSeenApplicationKey?: (accountId: string, id: string) => Promise<void>;
}

/** Настройки локальных уведомлений — те же поля, что читает useApplicationAlerts. */
interface NotificationSettings {
  notificationsEnabled: boolean;
  notifyNewTasks: boolean;
  notifyNewApplications: boolean;
  notifyStatusChangesApplications: boolean;
  notifyStatusChangesTasks: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  alertRepeatCount: number;
  newApplicationSoundId: string;
  newApplicationVolume: number;
  otherSoundId: string;
  otherVolume: number;
  floatingWidgetEnabled: boolean;
}

/**
 * Значения настроек, когда стор недоступен: уведомления считаем включёнными
 * (звук/вибрация — как раньше, repeatCount — 1, виджет не пульсирует).
 */
const FALLBACK_NOTIFICATION_SETTINGS: NotificationSettings = {
  notificationsEnabled: true,
  notifyNewTasks: true,
  notifyNewApplications: true,
  notifyStatusChangesApplications: true,
  notifyStatusChangesTasks: true,
  soundEnabled: true,
  vibrationEnabled: true,
  alertRepeatCount: 1,
  newApplicationSoundId: DEFAULT_NEW_APPLICATION_SOUND,
  newApplicationVolume: DEFAULT_ALERT_VOLUME,
  otherSoundId: DEFAULT_OTHER_SOUND,
  otherVolume: DEFAULT_ALERT_VOLUME,
  floatingWidgetEnabled: false,
};

/** Префикс namespace цели заявки в portal-уведомлениях customer_service. */
const APPLICATION_TARGET_NAMESPACE = 'customer_service';

/**
 * Превратить HTML-текст portal-уведомления в обычный текст:
 * убрать теги (br/переносы абзацев → пробел), раскрыть HTML-сущности,
 * схлопнуть пробелы и обрезать края.
 */
export function stripHtmlText(html: string): string {
  if (typeof html !== 'string' || html === '') {
    return '';
  }
  const withBreaks = html.replace(HTML_BREAK_TAGS, ' ');
  const withoutTags = withBreaks.replace(HTML_TAGS, '');
  const decoded = withoutTags.replace(HTML_ENTITIES, (match, hex, dec, name) => {
    if (hex !== undefined) {
      return codePointToText(parseInt(hex, 16), match);
    }
    if (dec !== undefined) {
      return codePointToText(parseInt(dec, 10), match);
    }
    const key = String(name).toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
  });
  return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * Диспетчер входящих публикаций: лог + уведомление/обновление списка заявок.
 * Ничего не отправляет на сервер — только реагирует на то, что пришло.
 * Best-effort: исключение обработчика не должно ломать поток Centrifuge
 * (в доке centrifuge-js исключения в колбэках недопустимы).
 */
function dispatchPublication(entry: RealtimeEntry, event: string, payload: unknown): void {
  try {
    if (event === FEED_MESSAGE_EVENT) {
      notifyFromFeedMessage(entry, payload);
      // Личное событие портала — новая заявка уже в списке, обновляем сразу
      // (debounce 2 с), не дожидаясь ближайшего опроса.
      requestApplicationsRefresh(entry.account.id);
      return;
    }
    if (event === OBJECT_EVENT) {
      const record = pickRecord(payload);
      const address = pickRecord(record === null ? null : record.address);
      logDiag(
        TAG,
        `object-event addressType=${toText(address === null ? null : address.type)} title=${limit(
          toText(record === null ? null : record.title),
        )}`,
      );
      return;
    }
    if (
      event.startsWith(BPM_INSTANCE_EVENT_PREFIX) ||
      event.startsWith(INSTANCE_EVENT_PREFIX)
    ) {
      requestApplicationsRefresh(entry.account.id);
    }
  } catch (error) {
    logDispatchError(event, error);
  }
}

/** Лог сбоя входящего события: `dispatch-error event=… error=…` (logDiag не бросает). */
function logDispatchError(event: string, error: unknown): void {
  logDiag(TAG, `dispatch-error event=${event || 'unknown'} error=${errorText(error)}`);
}

/** Личное уведомление portal-сервиса feed: дедуп по message.__id + локальный пуш. */
function notifyFromFeedMessage(entry: RealtimeEntry, payload: unknown): void {
  const message = pickRecord(pickRecord(payload)?.message);
  if (message === null) {
    return;
  }

  // Заявка из realtime: фиксируем её как «уже уведомлённую», чтобы
  // useApplicationAlerts не показало второе уведомление после обновления списка.
  markApplicationFromMessage(entry.account.id, message);

  const title = toText(message.title);
  const text = stripHtmlText(toText(message.body));
  if (title === '' && text === '') {
    return;
  }

  const id = toText(message.__id);
  const dedupKey = id !== '' ? id : [title, text, toText(message.__createdAt)].join('|');
  if (seenMessageIds.has(dedupKey)) {
    logDiag(TAG, `notify-skip reason=duplicate account=${maskValue(entry.account.id)} id=${id || '-'}`);
    return;
  }
  rememberMessageId(dedupKey);

  const kind = classifyNotification(title, text);
  const target = pickRecord(message.target);
  // Для смены статуса важно, относится ли событие к заявке или задаче:
  // цель заявки имеет namespace customer_service (см. APPLICATION_TARGET_NAMESPACE).
  const isApplication =
    toText(target === null ? null : target.namespace).startsWith(
      APPLICATION_TARGET_NAMESPACE,
    ) || kind === 'application-new';
  logDiag(
    TAG,
    `notify-class kind=${kind} title=${limit(title)} targetNs=${toText(
      target === null ? null : target.namespace,
    )} targetCode=${toText(target === null ? null : target.code)}`,
  );
  if (!isKindNotificationEnabled(kind, isApplication)) {
    logDiag(
      TAG,
      `notify-skip reason=kind-disabled kind=${kind} account=${maskValue(entry.account.id)}`,
    );
    return;
  }

  sendLocalNotification(title, text, entry.account.id, kind);
  logDiag(
    TAG,
    `notify account=${maskValue(entry.account.id)} title=${limit(title)} id=${id || '-'}`,
  );
  if (kind === 'application-new' && isApplication) {
    const targetId = toText(target === null ? null : target.id);
    if (targetId !== '') {
      insertApplicationFromFeed(entry.account, targetId);
    }
  }
}

/** Добавить message.__id в память дедупликации, не держа больше лимита. */
function rememberMessageId(id: string): void {
  seenMessageIds.add(id);
  for (const seen of seenMessageIds) {
    if (seenMessageIds.size <= SEEN_MESSAGE_IDS_LIMIT) {
      break;
    }
    seenMessageIds.delete(seen);
  }
}

/**
 * Прочитать настройки локальных уведомлений из settings-store.
 * Модуль/state недоступен — считаем уведомления включёнными (fallback).
 * Не булевы/некорректные значения полей приводятся к включённому состоянию.
 */
function readNotificationSettings(): NotificationSettings {
  try {
    const settingsMod = SettingsStore as SettingsStoreModule;
    const state = settingsMod?.useSettingsStore?.getState?.();
    if (state === null || state === undefined || typeof state !== 'object') {
      return {...FALLBACK_NOTIFICATION_SETTINGS};
    }
    return {
      notificationsEnabled: state.notificationsEnabled !== false,
      notifyNewTasks: state.notifyNewTasks !== false,
      notifyNewApplications: state.notifyNewApplications !== false,
      notifyStatusChangesApplications: state.notifyStatusChangesApplications !== false,
      notifyStatusChangesTasks: state.notifyStatusChangesTasks !== false,
      soundEnabled: state.soundEnabled !== false,
      vibrationEnabled: state.vibrationEnabled !== false,
      alertRepeatCount:
        typeof state.alertRepeatCount === 'number' && Number.isFinite(state.alertRepeatCount)
          ? state.alertRepeatCount
          : FALLBACK_NOTIFICATION_SETTINGS.alertRepeatCount,
      newApplicationSoundId:
        typeof state.newApplicationSoundId === 'string' && state.newApplicationSoundId !== ''
          ? state.newApplicationSoundId
          : DEFAULT_NEW_APPLICATION_SOUND,
      newApplicationVolume:
        typeof state.newApplicationVolume === 'number' && Number.isFinite(state.newApplicationVolume)
          ? state.newApplicationVolume
          : DEFAULT_ALERT_VOLUME,
      otherSoundId:
        typeof state.otherSoundId === 'string' && state.otherSoundId !== ''
          ? state.otherSoundId
          : DEFAULT_OTHER_SOUND,
      otherVolume:
        typeof state.otherVolume === 'number' && Number.isFinite(state.otherVolume)
          ? state.otherVolume
          : DEFAULT_ALERT_VOLUME,
      floatingWidgetEnabled: state.floatingWidgetEnabled === true,
    };
  } catch {
    return {...FALLBACK_NOTIFICATION_SETTINGS};
  }
}

/**
 * Включена ли категория уведомлений в настройках.
 * Для смены статуса различаем заявку/задачу по цели сообщения
 * (`isApplication` из target.namespace). `other` — всегда.
 */
function isKindNotificationEnabled(kind: NotificationKind, isApplication: boolean): boolean {
  if (kind === 'other') {
    return true;
  }
  const settings = readNotificationSettings();
  if (kind === 'task-new') {
    return settings.notifyNewTasks;
  }
  if (kind === 'application-new') {
    return settings.notifyNewApplications;
  }
  return isApplication
    ? settings.notifyStatusChangesApplications
    : settings.notifyStatusChangesTasks;
}

/**
 * Пометить заявку как «уже уведомлённую» в seen-хранилище: ключ
 * `${accountId}::${id}` — тот же, что использует useApplicationAlerts.
 * Пометка идёт в ОБЩИЙ Set (markSeenApplicationKey), поэтому хук её видит
 * и не показывает второе уведомление после обновления списка.
 * Асинхронно, best-effort: ошибки глушатся, приём публикаций не прерывается.
 */
export async function markApplicationSeen(accountId: string, id: string): Promise<void> {
  if (accountId === '' || id === '') {
    return;
  }
  try {
    const seenMod = SeenApplicationAlerts as SeenApplicationAlertsModule;
    if (typeof seenMod.markSeenApplicationKey !== 'function') {
      return;
    }
    await seenMod.markSeenApplicationKey(accountId, id);
  } catch {
    // best-effort: дедуп не должен ломать обработку входящих публикаций
  }
}

/**
 * Если в portal-уведомлении есть цель-заявка (namespace customer_service…, id) —
 * зафиксировать её в seen-хранилище, чтобы не дублировать уведомление из опроса.
 */
function markApplicationFromMessage(accountId: string, message: Record<string, unknown>): void {
  const target = pickRecord(message.target);
  if (target === null) {
    return;
  }
  const namespace = toText(target.namespace);
  const id = toText(target.id);
  if (id === '' || !namespace.startsWith(APPLICATION_TARGET_NAMESPACE)) {
    return;
  }
  logDiag(TAG, `notify-mark-seen account=${maskValue(accountId)} id=${id}`);
  void markApplicationSeen(accountId, id);
}

/**
 * Догрузить заявку по id из уведомления, чтобы она появилась в списке сразу.
 * Ленивый require: customer-service тянет сторы, статический импорт даёт цикл.
 */
function insertApplicationFromFeed(account: ElmaAccount, id: string): void {
  try {
    const mod = require('./customer-service') as {
      insertApplicationById?: (acc: ElmaAccount, applicationId: string) => Promise<boolean>;
    };
    if (typeof mod.insertApplicationById === 'function') {
      Promise.resolve(mod.insertApplicationById(account, id)).catch(() => {});
    }
  } catch (error) {
    logDiag(TAG, 'insert-app-failed id=' + id + ' error=' + errorText(error));
  }
}

/**
 * Локальное уведомление существующим native-модулем (best-effort):
 * уважает настройки (notificationsEnabled/sound/vibration/repeatCount/floatingWidget);
 * при отсутствии alertNewItem — notifyTask(title, text, опции).
 */
function sendLocalNotification(
  title: string,
  text: string,
  accountId: string,
  kind: NotificationKind,
): void {
  const settings = readNotificationSettings();
  if (settings.notificationsEnabled === false) {
    logDiag(TAG, `notify-skip reason=disabled account=${maskValue(accountId)}`);
    return;
  }

  // Две группы уведомлений: новая заявка и всё остальное — свой звук и громкость.
  const isApplicationGroup = kind === 'application-new';
  const soundId = isApplicationGroup ? settings.newApplicationSoundId : settings.otherSoundId;
  const volume = isApplicationGroup ? settings.newApplicationVolume : settings.otherVolume;

  let keepAlive: KeepAliveModule | null = null;
  try {
    // Ленивый require остаётся: keepAlive.notifyTask может отсутствовать в экспортах
    // модуля (см. KeepAlive.ts) — это проверяется typeof, а тесты проверяют
    // fallback «без alertNewItem», подменяя мок в рантайме. Статический
    // namespace-импорт дал бы снимок модуля и сломал бы эту проверку.
    keepAlive = require('../native/KeepAlive') as KeepAliveModule;
  } catch {
    keepAlive = null; // native module not available
  }
  if (keepAlive === null) {
    return;
  }

  let notified = false;
  try {
    if (typeof keepAlive.alertNewItem === 'function') {
      keepAlive.alertNewItem(
        title,
        text,
        {
          sound: settings.soundEnabled,
          vibration: settings.vibrationEnabled,
          repeatCount: settings.alertRepeatCount,
          soundId,
          volume,
        },
        accountId,
      );
      notified = true;
    }
  } catch {
    // native module not available
  }
  if (!notified) {
    try {
      if (typeof keepAlive.notifyTask === 'function') {
        keepAlive.notifyTask(title, text, {
          sound: settings.soundEnabled,
          vibration: settings.vibrationEnabled,
          soundId,
          volume,
        });
        notified = true;
      }
    } catch {
      // native module not available
    }
  }

  if (settings.floatingWidgetEnabled) {
    try {
      if (typeof keepAlive.pulseOverlayWidget === 'function') {
        keepAlive.pulseOverlayWidget();
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * Дополнительный триггер обновления списка заявок учётки по личному событию
 * портала (feed/target/message, instance/..., app/bpm/instance/...).
 * Debounce 2000 мс на учётку; интервалы опроса и сама логика
 * applications-sync при этом не меняются.
 */
function requestApplicationsRefresh(accountId: string): void {
  const now = Date.now();
  const lastRequestedAt = refreshRequestedAt.get(accountId) ?? 0;
  if (now - lastRequestedAt < APPLICATIONS_REFRESH_DEBOUNCE_MS) {
    return;
  }
  refreshRequestedAt.set(accountId, now);
  logDiag(TAG, `refresh-request account=${maskValue(accountId)}`);
  try {
    // Остаётся ленивым require: статический импорт создал бы реальную
    // циклическую зависимость realtime <-> applications-sync
    // (там isRealtimeSubscribed импортируется статически из этого модуля).
    const sync = require('./applications-sync') as ApplicationsSyncModule;
    if (typeof sync.refreshApplicationsNow === 'function') {
      Promise.resolve(sync.refreshApplicationsNow(accountId)).catch(() => {
        // обновление заявок — best-effort, ошибки уже логируются в applications-sync
      });
    }
  } catch (error) {
    logDiag(
      TAG,
      `refresh-request-failed account=${maskValue(accountId)} error=${errorText(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Внутреннее
// ---------------------------------------------------------------------------

/** Ленивый запуск таймера сторожа — при появлении первого соединения. */
function ensureWatchdogTimer(): void {
  if (entries.size === 0) {
    return;
  }
  if (watchdogTimer === null) {
    watchdogTimer = setInterval(watchdogTick, REALTIME_WATCHDOG_INTERVAL_MS);
  }
  // Здоровье по нативному тику: JS-таймеры в фоне замораживаются, а нативный
  // тикер (multiElmaSyncTick) продолжает идти — им и лечим соединения.
  if (tickSubscription === null) {
    tickSubscription = DeviceEventEmitter.addListener(SYNC_TICK_EVENT, syncTickHealth);
  }
}

/** Очистка таймера сторожа — когда активных соединений не осталось. */
function clearWatchdogTimerIfIdle(): void {
  if (entries.size !== 0) {
    return;
  }
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  if (tickSubscription !== null) {
    tickSubscription.remove();
    tickSubscription = null;
  }
  lastTickHealthAt = 0;
  lastHeartbeatAt = 0;
}

/**
 * Тик нативного сторожа: не чаще REALTIME_TICK_HEALTH_MIN_GAP_MS вызывает
 * проверку живости соединений (лечит не-subscribed даже в фоне).
 */
function syncTickHealth(): void {
  const now = Date.now();
  if (now - lastTickHealthAt < REALTIME_TICK_HEALTH_MIN_GAP_MS) {
    return;
  }
  lastTickHealthAt = now;
  const t = Date.now();
  if (entries.size > 0 && t - lastHeartbeatAt >= REALTIME_HEARTBEAT_MIN_GAP_MS) {
    lastHeartbeatAt = t;
    logRealtimeStatus();
  }
  ensureRealtimeAlive(false);
}

/** Тик сторожа: строка статуса + перезапуск closed/stale/age-соединений. */
function watchdogTick(): void {
  if (entries.size === 0) {
    return;
  }
  logRealtimeStatus();
  const now = Date.now();
  for (const entry of Array.from(entries.values())) {
    const reason = watchdogRestartReason(entry, now);
    if (reason === null) {
      continue;
    }
    if (now - entry.lastRestartAt < REALTIME_RESTART_MIN_GAP_MS) {
      continue; // перезапуск недавний — частоту ограничиваем
    }
    restartByWatchdog(entry, reason, now);
  }
}

/**
 * Причина перезапуска соединения сторожем: closed → stale → age → silent,
 * иначе null.
 * `stale` лечит застрявшие connecting/connected (не дошедшие до subscribed).
 * `silent` лечит «тихо умершие» subscribed-соединения: состояние осталось
 * subscribed, но входящих событий нет дольше REALTIME_SILENCE_MS (проверка
 * идёт после age, чтобы возрастные соединения логировались как age).
 */
function watchdogRestartReason(
  entry: RealtimeEntry,
  now: number,
): 'closed' | 'stale' | 'age' | 'silent' | null {
  if (entry.state === 'closed') {
    return 'closed';
  }
  if (entry.state !== 'subscribed' && now - entry.startedAt > REALTIME_STALE_MS) {
    return 'stale';
  }
  if (now - entry.startedAt > REALTIME_MAX_CONNECTION_AGE_MS) {
    return 'age';
  }
  if (entry.state === 'subscribed' && now - entry.lastActivityAt > REALTIME_SILENCE_MS) {
    return 'silent';
  }
  return null;
}

/**
 * Перезапуск соединения сторожем: закрывает старый клиент через `startRealtime`
 * и фиксирует момент перезапуска (для ограничения частоты). Сбой перезапуска
 * логируется и не должен ронять тик сторожа; сам logDiag исключений не бросает.
 */
function restartByWatchdog(entry: RealtimeEntry, reason: string, now: number): void {
  const accountId = entry.account.id;
  logDiag(TAG, `watchdog-restart reason=${reason} account=${maskValue(accountId)}`);
  try {
    startRealtime(entry.account);
  } catch (error) {
    logDiag(
      TAG,
      `watchdog-restart-failed account=${maskValue(accountId)} error=${errorText(error)}`,
    );
    return;
  }
  const restarted = entries.get(accountId);
  if (restarted) {
    restarted.lastRestartAt = now;
  }
}

/**
 * Перезапустить нездоровые соединения: закрытые и застрявшие
 * connecting/connected (state !== 'subscribed'), а также «тихо умершие»
 * subscribed-соединения (без входящих событий дольше REALTIME_SILENCE_MS).
 * Вызывается при возврате приложения из фона и с нативного тика сторожа
 * (в фоне JS-таймеры заморожены) — поэтому зомби-сокет пересоздаётся и в фоне.
 *
 * @param force true — принудительно, игнорируя REALTIME_RESTART_MIN_GAP_MS
 *   (возврат из фона: сокет обязан пересоздаться); false — мин-gap соблюдается.
 * Причина в логе: `silent` для молчащего subscribed, `resume` при force,
 * `stale` — в остальных случаях.
 */
export function ensureRealtimeAlive(force = false): void {
  const now = Date.now();
  for (const entry of Array.from(entries.values())) {
    const silent =
      entry.state === 'subscribed' && now - entry.lastActivityAt > REALTIME_SILENCE_MS;
    if (entry.state === 'subscribed' && !silent) {
      continue; // живая подписка — не трогаем
    }
    if (!force && now - entry.lastRestartAt < REALTIME_RESTART_MIN_GAP_MS) {
      continue;
    }
    restartByWatchdog(entry, silent ? 'silent' : force ? 'resume' : 'stale', now);
  }
}

/** Периодическая строка статуса: состояние каждого активного соединения + возраст. */
function logRealtimeStatus(): void {
  if (entries.size === 0) {
    return;
  }
  const now = Date.now();
  const pubSilenceMs = lastRealtimeEventAt === 0 ? -1 : now - lastRealtimeEventAt;
  const accounts = Array.from(entries.values())
    .map(entry => `${maskValue(entry.account.id)}=${entry.state}@${now - entry.startedAt}`)
    .join(',');
  logDiag(TAG, `status connections=${entries.size} pubSilenceMs=${pubSilenceMs} accounts=${accounts}`);
}

/** Подписки и обработчики входящих событий. Реконнект делает библиотека сама. */
function wireClient(entry: RealtimeEntry): void {
  const {account, client} = entry;

  client.on('connected', ctx => {
    entry.state = 'connected';
    entry.subscribedChannels.clear();
    const company = pickConnectValue(ctx.data, ['company']);
    const userID = pickConnectValue(ctx.data, ['userID', 'userId', 'user_id', 'user']);
    logDiag(
      TAG,
      `connected account=${maskValue(account.id)} transport=${String(
        ctx.transport,
      )} company=${company || '-'} user=${userID || '-'} data=${maskValue(
        limit(toJson(ctx.data)),
      )}`,
    );
    subscribeChannels(entry, company, userID);
  });

  client.on('connecting', ctx => {
    entry.state = 'connecting';
    logDiag(
      TAG,
      `connecting account=${maskValue(account.id)} code=${ctx.code} reason=${ctx.reason}`,
    );
  });

  client.on('disconnected', ctx => {
    entry.state = 'closed';
    entry.subscribedChannels.clear();
    logDiag(
      TAG,
      `disconnected account=${maskValue(account.id)} code=${ctx.code} reason=${ctx.reason}`,
    );
  });

  client.on('error', ctx => {
    entry.state = 'closed';
    entry.subscribedChannels.clear();
    logDiag(
      TAG,
      `error account=${maskValue(account.id)} type=${ctx.type} message=${errorText(ctx.error)}`,
    );
  });

  // Async-сообщения сервера, не привязанные к каналу — тоже входящие события.
  client.on('message', ctx => {
    entry.lastActivityAt = Date.now();
    lastRealtimeEventAt = Date.now();
    let event = '';
    try {
      const described = describePublication(ctx.data);
      event = described.event;
      logDiag(
        TAG,
        event.startsWith(COUNTERS_EVENT_PREFIX)
          ? `message account=${maskValue(account.id)} event=${event}`
          : `message account=${maskValue(account.id)} payload=${limit(toJson(ctx.data))}`,
      );
      dispatchPublication(entry, described.event, described.payload);
    } catch (error) {
      logDispatchError(event, error);
    }
  });

  // Публикации серверных подписок (broadcast.<company>) приходят на уровень
  // клиента, минуя объект подписки — обрабатываем и их.
  client.on('publication', ctx => {
    logPublication(entry, String(ctx.channel ?? ''), ctx.data);
  });
}

/**
 * Подписка на пользовательские каналы после connect.
 * Сбой одной подписки логируется и не прерывает остальные.
 */
function subscribeChannels(entry: RealtimeEntry, company: string, userID: string): void {
  const {account, client} = entry;
  if (!company || !userID) {
    logDiag(
      TAG,
      `connect-data-missing account=${maskValue(account.id)} company=${company || '-'} user=${
        userID || '-'
      }`,
    );
    return;
  }

  for (const channel of buildRealtimeChannels(company, userID)) {
    if (entry.channels.has(channel)) {
      continue; // уже подписана на этом соединении
    }
    try {
      const sub = client.newSubscription(channel);
      sub.on('publication', ctx => logPublication(entry, channel, ctx.data));
      sub.on('subscribed', () => {
        entry.subscribedChannels.add(channel);
        entry.lastActivityAt = Date.now();
        const allSubscribed =
          entry.channels.size > 0 && entry.subscribedChannels.size >= entry.channels.size;
        if (allSubscribed && entry.state !== 'closed') {
          entry.state = 'subscribed';
        }
        logDiag(TAG, `subscribed account=${maskValue(account.id)} channel=${channel}`);
      });
      sub.on('error', ctx => {
        logDiag(
          TAG,
          `subscribe-error account=${maskValue(account.id)} channel=${channel} type=${ctx.type} message=${errorText(
            ctx.error,
          )}`,
        );
      });
      sub.subscribe();
      entry.channels.add(channel);
    } catch (error) {
      logDiag(
        TAG,
        `subscribe-failed account=${maskValue(account.id)} channel=${channel} error=${errorText(
          error,
        )}`,
      );
    }
  }
}

/** События счётчиков портала (updatecounters/…) — payload бесполезен, шумит в логе. */
const COUNTERS_EVENT_PREFIX = 'updatecounters';

/** Лог любой входящей публикации + диспетчер уведомлений/обновлений. */
function logPublication(entry: RealtimeEntry, channel: string, data: unknown): void {
  entry.lastActivityAt = Date.now();
  lastRealtimeEventAt = Date.now();
  let event = '';
  try {
    const described = describePublication(data);
    event = described.event;
    if (event.startsWith(COUNTERS_EVENT_PREFIX)) {
      logDiag(
        TAG,
        `pub account=${maskValue(entry.account.id)} channel=${channel} event=${event}`,
      );
    } else {
      logDiag(
        TAG,
        `pub account=${maskValue(entry.account.id)} channel=${channel} event=${event} payload=${limit(
          toJson(described.payload),
        )}`,
      );
    }
    dispatchPublication(entry, described.event, described.payload);
  } catch (error) {
    logDispatchError(event, error);
  }
}

/** Публикации портала имеют вид `{event, payload}`; всё остальное логируем как есть. */
function describePublication(data: unknown): {event: string; payload: unknown} {
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const event = typeof record.event === 'string' ? record.event : '';
    const payload = Object.prototype.hasOwnProperty.call(record, 'payload')
      ? record.payload
      : data;
    return {event, payload};
  }
  return {event: '', payload: data};
}

/** Безопасно привести значение к plain-object (null/примитивы → null). */
function pickRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Привести значение к строке (undefined/null/объекты → ''). */
function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
}

/** Числовой HTML-код-пойнт в текст; некорректное значение → исходная сущность. */
function codePointToText(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

/** Достать строковое значение из данных connect-ответа по списку ключей. */
function pickConnectValue(data: unknown, keys: readonly string[]): string {
  if (data === null || typeof data !== 'object') {
    return '';
  }
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return '';
}

function toJson(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return String(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function limit(text: string): string {
  return text.length > PAYLOAD_LOG_LIMIT ? text.slice(0, PAYLOAD_LOG_LIMIT) + '…' : text;
}
