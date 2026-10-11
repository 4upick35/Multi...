jest.mock('../../src/diag/accept-log', () => ({
  logDiag: jest.fn(),
  getDiagLog: jest.fn(() => ''),
  hasDiagLog: jest.fn(() => false),
  shareDiagLog: jest.fn(() => Promise.resolve()),
  shareCookieBank: jest.fn(() => Promise.resolve()),
}));

// Нативные уведомления и обновление заявок не вызываем — только мокаем.
jest.mock('../../src/native/KeepAlive', () => ({
  SYNC_TICK_EVENT: 'multiElmaSyncTick',
  alertNewItem: jest.fn(),
  notify: jest.fn(),
  pulseOverlayWidget: jest.fn(),
}));

jest.mock('../../src/services/applications-sync', () => ({
  refreshApplicationsNow: jest.fn(() => Promise.resolve()),
}));

// Настройки уведомлений: мокаем стор, состояние доступно через __state.
jest.mock('../../src/store/settings-store', () => {
  const __state = {
    notificationsEnabled: true,
    notifyNewTasks: true,
    notifyNewApplications: true,
    notifyStatusChangesApplications: true,
    notifyStatusChangesTasks: true,
    soundEnabled: true,
    vibrationEnabled: true,
    alertRepeatCount: 1,
    floatingWidgetEnabled: false,
  };
  return {useSettingsStore: {getState: jest.fn(() => __state)}, __state};
});

// Хранилище «уже уведомлённых» заявок — только проверяем вызовы.
// markSeenApplicationKey повторяет поведение реального модуля (общий Set),
// чтобы существующие проверки loadSeenKeys/persistSeenKeys оставались валидными.
jest.mock('../../src/services/seen-application-alerts', () => {
  const loadSeenKeys = jest.fn(async () => new Set<string>());
  const persistSeenKeys = jest.fn();
  // Повторяет поведение реального модуля (общий Set), чтобы существующие
  // проверки loadSeenKeys/persistSeenKeys оставались валидными.
  const markSeenApplicationKey = jest.fn(async (accountId: string, id: string) => {
    const seen = await loadSeenKeys();
    seen.add(`${accountId}::${id}`);
    persistSeenKeys(seen);
  });
  return {MAX_SEEN_KEYS: 500, loadSeenKeys, persistSeenKeys, markSeenApplicationKey};
});

// Сокет не открываем: подменяем клиент Centrifugo фейком. Фейк дополнительно
// бросает ошибку на publish/rpc/send — realtime обязан быть строго read-only.
jest.mock('centrifuge', () => {
  const instances: any[] = [];

  class FakeSubscription {
    channel: string;
    listeners: {[event: string]: Array<(...args: any[]) => void>} = {};

    constructor(channel: string) {
      this.channel = channel;
    }

    on(event: string, cb: (...args: any[]) => void): this {
      this.listeners[event] = (this.listeners[event] || []).concat(cb);
      return this;
    }

    removeAllListeners(): void {
      this.listeners = {};
    }

    subscribe(): void {
      // без сети
    }

    emit(event: string, ...args: any[]): void {
      (this.listeners[event] || []).forEach(cb => cb(...args));
    }
  }

  class FakeCentrifuge {
    static instances = instances;
    url: string;
    options: any;
    listeners: {[event: string]: Array<(...args: any[]) => void>} = {};
    subs: {[channel: string]: FakeSubscription} = {};
    connectCalled = false;
    disconnectCalled = false;

    constructor(url: string, options: any) {
      this.url = url;
      this.options = options;
      instances.push(this);
    }

    on(event: string, cb: (...args: any[]) => void): this {
      this.listeners[event] = (this.listeners[event] || []).concat(cb);
      return this;
    }

    removeAllListeners(): void {
      this.listeners = {};
    }

    connect(): void {
      this.connectCalled = true;
    }

    disconnect(): void {
      this.disconnectCalled = true;
    }

    newSubscription(channel: string): FakeSubscription {
      if (this.subs[channel]) {
        throw new Error('subscription already exists: ' + channel);
      }
      const sub = new FakeSubscription(channel);
      this.subs[channel] = sub;
      return sub;
    }

    getSubscription(channel: string): FakeSubscription | null {
      return this.subs[channel] || null;
    }

    removeSubscription(sub: FakeSubscription): void {
      delete this.subs[sub.channel];
    }

    emit(event: string, ...args: any[]): void {
      (this.listeners[event] || []).forEach(cb => cb(...args));
    }

    publish(): never {
      throw new Error('realtime must be read-only');
    }

    rpc(): never {
      throw new Error('realtime must be read-only');
    }

    send(): never {
      throw new Error('realtime must be read-only');
    }
  }

  return {Centrifuge: FakeCentrifuge, __instances: instances};
});

import {
  buildRealtimeUrl,
  buildPrivateChannel,
  buildRealtimeChannels,
  REALTIME_SERVICES,
  REALTIME_WATCHDOG_INTERVAL_MS,
  REALTIME_RESTART_MIN_GAP_MS,
  REALTIME_MAX_CONNECTION_AGE_MS,
  REALTIME_STALE_MS,
  REALTIME_TICK_HEALTH_MIN_GAP_MS,
  REALTIME_SILENCE_MS,
  isRealtimeSubscribed,
  startRealtime,
  stopRealtime,
  stopAllRealtime,
  syncRealtimeAccounts,
  ensureRealtimeAlive,
  isRealtimeRunning,
  realtimeConnectionsCount,
  stripHtmlText,
  markApplicationSeen,
  classifyNotification,
} from '../../src/services/realtime';
import {DeviceEventEmitter} from 'react-native';
import {SYNC_TICK_EVENT} from '../../src/native/KeepAlive';
import {logDiag} from '../../src/diag/accept-log';
import type {ElmaAccount} from '../../src/types/account';

const instances = (jest.requireMock('centrifuge') as any).__instances as any[];
const mockedLogDiag = logDiag as jest.MockedFunction<typeof logDiag>;
const keepAliveMock = jest.requireMock('../../src/native/KeepAlive') as {
  alertNewItem: jest.Mock;
  notify: jest.Mock;
  pulseOverlayWidget: jest.Mock;
};
const applicationsSyncMock = jest.requireMock('../../src/services/applications-sync') as {
  refreshApplicationsNow: jest.Mock;
};
const settingsState = (
  jest.requireMock('../../src/store/settings-store') as {__state: Record<string, unknown>}
).__state;
const seenAlertsMock = jest.requireMock('../../src/services/seen-application-alerts') as {
  loadSeenKeys: jest.Mock;
  persistSeenKeys: jest.Mock;
  markSeenApplicationKey: jest.Mock;
};

/** Дефолт настроек в моке (обнуляется перед каждым тестом). */
const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  notifyNewTasks: true,
  notifyNewApplications: true,
  notifyStatusChangesApplications: true,
  notifyStatusChangesTasks: true,
  soundEnabled: true,
  vibrationEnabled: true,
  alertRepeatCount: 1,
  floatingWidgetEnabled: false,
};

/** Дождаться завершения best-effort async-цепочек (markApplicationSeen). */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Мок глобального WebSocket: фиксирует аргументы конструктора, чтобы проверить,
 * что cookie-сессия уходит в HTTP-рукопожатие третьим аргументом (options).
 */
class MockWebSocket {
  static lastArgs: unknown[] | null = null;

  constructor(...args: unknown[]) {
    MockWebSocket.lastArgs = args;
  }
}

const originalWebSocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');

beforeAll(() => {
  Object.defineProperty(globalThis, 'WebSocket', {
    value: MockWebSocket,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  MockWebSocket.lastArgs = null;
});

afterAll(() => {
  if (originalWebSocketDescriptor) {
    Object.defineProperty(globalThis, 'WebSocket', originalWebSocketDescriptor);
  } else {
    delete (globalThis as {WebSocket?: unknown}).WebSocket;
  }
});

function makeAccount(overrides: Partial<ElmaAccount> = {}): ElmaAccount {
  return {
    id: 'acc-1',
    name: 'Test',
    baseUrl: 'https://portal.elma.ru',
    portal: 'p',
    token: 'tok-1',
    cookies: 'ELMASSID=sess-1',
    userId: 'uid-1',
    color: '#6200EE',
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  stopAllRealtime();
  instances.length = 0;
  mockedLogDiag.mockClear();
  MockWebSocket.lastArgs = null;
  keepAliveMock.alertNewItem.mockClear();
  keepAliveMock.notify.mockClear();
  keepAliveMock.pulseOverlayWidget.mockClear();
  applicationsSyncMock.refreshApplicationsNow.mockClear();
  seenAlertsMock.loadSeenKeys.mockClear();
  seenAlertsMock.persistSeenKeys.mockClear();
  seenAlertsMock.markSeenApplicationKey.mockClear();
  Object.assign(settingsState, DEFAULT_SETTINGS);
});

afterEach(() => {
  stopAllRealtime();
  instances.length = 0;
});

// ---------------------------------------------------------------------------
// buildRealtimeUrl: http -> ws, https -> wss, путь /ws/v2/websocket
// ---------------------------------------------------------------------------
describe('buildRealtimeUrl', () => {
  it('https -> wss', () => {
    expect(buildRealtimeUrl('https://portal.elma.ru')).toBe(
      'wss://portal.elma.ru/ws/v2/websocket',
    );
  });

  it('http -> ws', () => {
    expect(buildRealtimeUrl('http://portal.elma.ru')).toBe(
      'ws://portal.elma.ru/ws/v2/websocket',
    );
  });

  it('убирает висящий слэш в конце baseUrl', () => {
    expect(buildRealtimeUrl('https://portal.elma.ru/')).toBe(
      'wss://portal.elma.ru/ws/v2/websocket',
    );
    expect(buildRealtimeUrl('http://portal.elma.ru//')).toBe(
      'ws://portal.elma.ru/ws/v2/websocket',
    );
  });

  it('сохраняет подпуть baseUrl', () => {
    expect(buildRealtimeUrl('https://portal.elma.ru/elma')).toBe(
      'wss://portal.elma.ru/elma/ws/v2/websocket',
    );
  });

  it('схема в верхнем регистре распознаётся', () => {
    expect(buildRealtimeUrl('HTTPS://Portal.Elma.Ru')).toBe(
      'wss://Portal.Elma.Ru/ws/v2/websocket',
    );
  });
});

// ---------------------------------------------------------------------------
// buildPrivateChannel: <service>:private.<company>#<userID>
// ---------------------------------------------------------------------------
describe('buildPrivateChannel', () => {
  it('базовый сервис (service=\'\') даёт канал с ведущим двоеточием', () => {
    expect(buildPrivateChannel('', 'acme', '42')).toBe(':private.acme#42');
  });

  it('именованные сервисы идут префиксом', () => {
    expect(buildPrivateChannel('feed', 'acme', '42')).toBe('feed:private.acme#42');
    expect(buildPrivateChannel('crm', 'acme', '42')).toBe('crm:private.acme#42');
    expect(buildPrivateChannel('events', 'acme', '42')).toBe('events:private.acme#42');
    expect(buildPrivateChannel('chat', 'acme', '42')).toBe('chat:private.acme#42');
  });

  it('buildRealtimeChannels строит канал для каждого сервиса', () => {
    const channels = buildRealtimeChannels('acme', '42');
    expect(channels).toHaveLength(REALTIME_SERVICES.length);
    expect(channels).toEqual(REALTIME_SERVICES.map(s => buildPrivateChannel(s, 'acme', '42')));
  });
});

// ---------------------------------------------------------------------------
// Жизненный цикл — без реальной сети (клиент замокан)
// ---------------------------------------------------------------------------
describe('startRealtime/stopRealtime', () => {
  it('открывает одно соединение с ws-url и websocket-конструктором cookies', () => {
    const account = makeAccount();
    startRealtime(account);

    expect(instances).toHaveLength(1);
    expect(instances[0].url).toBe('wss://portal.elma.ru/ws/v2/websocket');
    expect(instances[0].options.websocket).toBeDefined();
    expect(instances[0].connectCalled).toBe(true);
    expect(isRealtimeRunning(account.id)).toBe(true);
    expect(realtimeConnectionsCount()).toBe(1);
  });

  it('повторный startRealtime закрывает старое соединение', () => {
    const account = makeAccount();
    startRealtime(account);
    const first = instances[0];
    startRealtime(account);

    expect(instances).toHaveLength(2);
    expect(first.disconnectCalled).toBe(true);
    expect(instances[1].disconnectCalled).toBe(false);
    expect(realtimeConnectionsCount()).toBe(1);
  });

  it('stopRealtime закрывает соединение, повторный вызов — no-op', () => {
    const account = makeAccount();
    startRealtime(account);
    const client = instances[0];

    stopRealtime(account.id);
    expect(client.disconnectCalled).toBe(true);
    expect(isRealtimeRunning(account.id)).toBe(false);

    expect(() => stopRealtime(account.id)).not.toThrow();
    expect(realtimeConnectionsCount()).toBe(0);
  });

  it('не стартует без cookies и с некорректным baseUrl', () => {
    startRealtime(makeAccount({token: '', cookies: ''}));
    startRealtime(makeAccount({id: 'acc-2', baseUrl: ''}));

    expect(instances).toHaveLength(0);
    expect(realtimeConnectionsCount()).toBe(0);
    expect(
      mockedLogDiag.mock.calls.filter(call =>
        String(call[1]).includes('start-skip reason=no-cookies'),
      ),
    ).toHaveLength(1);
    expect(
      mockedLogDiag.mock.calls.filter(call => String(call[1]).includes('start-skip reason=bad-url')),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Авторизация realtime: cookie-сессия в рукопожатии WS вместо Centrifugo-токена
// ---------------------------------------------------------------------------
describe('авторизация realtime по cookies', () => {
  const COOKIES = 'ELMASSID=sess-secret-1; another=value-2';

  /** Аргументы, с которыми последний раз создавался WebSocket. */
  function lastWebSocketArgs(): unknown[] {
    expect(MockWebSocket.lastArgs).not.toBeNull();
    return MockWebSocket.lastArgs as unknown[];
  }

  it('Centrifuge создаётся без token, но с websocket-конструктором', () => {
    startRealtime(makeAccount({cookies: COOKIES}));

    expect(instances).toHaveLength(1);
    expect(instances[0].options).not.toHaveProperty('token');
    expect(instances[0].options.websocket).toBeDefined();
  });

  it('1 аргумент конструктора → Cookie уходит третьим аргументом (options)', () => {
    startRealtime(makeAccount({cookies: COOKIES}));

    const WebSocketCtor = instances[0].options.websocket;
    MockWebSocket.lastArgs = null;
    const socket = new WebSocketCtor('wss://portal.elma.ru/ws/v2/websocket');

    expect(socket).toBeInstanceOf(MockWebSocket);
    const args = lastWebSocketArgs();
    expect(args).toHaveLength(3);
    expect(args[0]).toBe('wss://portal.elma.ru/ws/v2/websocket');
    expect(args[2]).toEqual({headers: {Cookie: COOKIES}});
    expect(JSON.stringify(args[2])).not.toContain('Authorization');
  });

  it('2 аргумента конструктора → options всё равно третьим', () => {
    startRealtime(makeAccount({id: 'acc-2', cookies: COOKIES}));

    const WebSocketCtor = instances[0].options.websocket;
    MockWebSocket.lastArgs = null;
    new WebSocketCtor('wss://portal.elma.ru/ws/v2/websocket', 'centrifuge-json');

    const args = lastWebSocketArgs();
    expect(args).toHaveLength(3);
    expect(args[2]).toEqual({headers: {Cookie: COOKIES}});
  });

  it('пустые/отсутствующие cookies → соединение не создаётся, пишется no-cookies', () => {
    startRealtime(makeAccount({cookies: ''}));
    startRealtime(makeAccount({id: 'acc-2', cookies: undefined}));
    startRealtime(makeAccount({id: 'acc-3', cookies: '   '}));

    expect(instances).toHaveLength(0);
    expect(realtimeConnectionsCount()).toBe(0);
    expect(MockWebSocket.lastArgs).toBeNull();
    const skips = mockedLogDiag.mock.calls.filter(call =>
      String(call[1]).includes('start-skip reason=no-cookies'),
    );
    expect(skips).toHaveLength(3);
    expect(skips.every(call => String(call[1]).includes('account='))).toBe(true);
  });

  it('diag start пишет только имена cookie и их количество — без значений', () => {
    startRealtime(makeAccount({cookies: COOKIES}));

    const startCall = mockedLogDiag.mock.calls.find(call =>
      String(call[1]).startsWith('start account='),
    );
    expect(startCall).toBeDefined();
    const line = String(startCall![1]);
    expect(line).toContain('url=wss://portal.elma.ru/ws/v2/websocket');
    expect(line).toContain('cookies=2');
    expect(line).toContain('names=ELMASSID,another');
    expect(line).not.toContain('sess-secret-1');
    expect(line).not.toContain('value-2');
  });
});

// ---------------------------------------------------------------------------
// Подписки на пользовательские каналы
// ---------------------------------------------------------------------------
describe('подписки', () => {
  it('подписывается на каналы всех сервисов после connect-ответа', () => {
    const account = makeAccount();
    startRealtime(account);
    const client = instances[0];

    client.emit('connected', {
      transport: 'websocket',
      client: 'c1',
      data: {company: 'acme', userID: '42'},
    });

    expect(Object.keys(client.subs).sort()).toEqual(
      buildRealtimeChannels('acme', '42').sort(),
    );
    expect(client.subs[':private.acme#42']).toBeDefined();
    expect(client.subs['feed:private.acme#42']).toBeDefined();
  });

  it('реконнект не создаёт дубликатов подписок', () => {
    const account = makeAccount();
    startRealtime(account);
    const client = instances[0];
    const reply = {transport: 'websocket', client: 'c1', data: {company: 'acme', userID: '42'}};

    client.emit('connected', reply);
    client.emit('connected', reply);

    expect(Object.keys(client.subs)).toHaveLength(REALTIME_SERVICES.length);
    expect(realtimeConnectionsCount()).toBe(1);
  });

  it('нет данных company/userID — подписок нет, но соединение живо', () => {
    startRealtime(makeAccount());
    const client = instances[0];

    client.emit('connected', {transport: 'websocket', client: 'c1', data: {}});

    expect(Object.keys(client.subs)).toHaveLength(0);
    expect(isRealtimeRunning('acc-1')).toBe(true);
    expect(
      mockedLogDiag.mock.calls.some(call => String(call[1]).includes('connect-data-missing')),
    ).toBe(true);
  });

  it('логирует любую входящую публикацию (account + channel + event + payload)', () => {
    startRealtime(makeAccount());
    const client = instances[0];
    client.emit('connected', {
      transport: 'websocket',
      client: 'c1',
      data: {company: 'acme', userID: '42'},
    });
    mockedLogDiag.mockClear();

    client.subs['feed:private.acme#42'].emit('publication', {
      channel: 'feed:private.acme#42',
      data: {event: 'task-created', payload: {name: 'Заявка', id: '7'}},
    });

    expect(mockedLogDiag).toHaveBeenCalledTimes(1);
    const [tag, text] = mockedLogDiag.mock.calls[0];
    expect(tag).toBe('realtime');
    expect(text).toContain('channel=feed:private.acme#42');
    expect(text).toContain('event=task-created');
    expect(text).toContain('payload=');
    expect(text).toContain('Заявка');
  });
});

// ---------------------------------------------------------------------------
// syncRealtimeAccounts: старт/стоп по списку активных учёток
// ---------------------------------------------------------------------------
describe('syncRealtimeAccounts', () => {
  it('открывает недостающие и закрывает лишние соединения', () => {
    const a1 = makeAccount({id: 'acc-1'});
    const a2 = makeAccount({id: 'acc-2', baseUrl: 'http://other.elma.ru'});

    syncRealtimeAccounts([a1, a2]);
    expect(realtimeConnectionsCount()).toBe(2);
    expect(instances.map(i => i.url).sort()).toEqual([
      'ws://other.elma.ru/ws/v2/websocket',
      'wss://portal.elma.ru/ws/v2/websocket',
    ]);

    syncRealtimeAccounts([a2]);
    expect(realtimeConnectionsCount()).toBe(1);
    expect(isRealtimeRunning('acc-1')).toBe(false);
    expect(isRealtimeRunning('acc-2')).toBe(true);

    syncRealtimeAccounts([]);
    expect(realtimeConnectionsCount()).toBe(0);
  });

  it('не пересоздаёт уже работающие соединения', () => {
    const a1 = makeAccount({id: 'acc-1'});
    syncRealtimeAccounts([a1]);
    syncRealtimeAccounts([a1]);

    expect(instances).toHaveLength(1);
    expect(instances[0].disconnectCalled).toBe(false);
    expect(realtimeConnectionsCount()).toBe(1);
  });

  it('переподключает при смене baseUrl/token', () => {
    const a1 = makeAccount({id: 'acc-1'});
    syncRealtimeAccounts([a1]);
    syncRealtimeAccounts([makeAccount({id: 'acc-1', token: 'tok-2'})]);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnectCalled).toBe(true);
    expect(instances[1].options).not.toHaveProperty('token');
    expect(instances[1].options.websocket).toBeDefined();
    expect(realtimeConnectionsCount()).toBe(1);
  });
});

it('stopAllRealtime закрывает все соединения', () => {
  syncRealtimeAccounts([makeAccount({id: 'acc-1'}), makeAccount({id: 'acc-2'})]);
  expect(realtimeConnectionsCount()).toBe(2);

  stopAllRealtime();
  expect(realtimeConnectionsCount()).toBe(0);
  expect(instances.every(i => i.disconnectCalled)).toBe(true);
});

// ---------------------------------------------------------------------------
// Этап 2: входящие публикации → уведомления и обновление списка заявок
// ---------------------------------------------------------------------------

const PRIVATE_CHANNEL = ':private.acme#42';

/** Реальный пример личного уведомления портала (feed/target/message). */
const FEED_MESSAGE = {
  __id: 'msg-21978',
  __createdAt: '2026-10-08T09:15:00.000Z',
  author: 'system',
  title: 'Появилась новая заявка',
  body: 'Уважаемый партнер!<br/>Появилась новая заявка №<a href="http://portal/21978"> 21978</a>. Вы можете взять ее в работу.',
  target: {
    namespace: 'customer_service',
    code: 'applications',
    id: '01a11b37-0116-7480-bf6c-8591860b2b7d',
    title: ' 21978',
  },
  is_personal: true,
};

const FEED_TEXT =
  'Уважаемый партнер! Появилась новая заявка № 21978. Вы можете взять ее в работу.';

const BPM_EVENT = {
  event: 'app/bpm/instance/customer_service.applications/_process_accept_application',
  payload: {instance: 'i-1'},
};

/** Открыть соединение учётки и подписаться на пользовательские каналы. */
function startConnected(account: ElmaAccount = makeAccount()): any {
  startRealtime(account);
  const client = instances[instances.length - 1];
  client.emit('connected', {
    transport: 'websocket',
    client: 'c1',
    data: {company: 'acme', userID: '42'},
  });
  return client;
}

/** Доставить публикацию так же, как это делает клиент Centrifugo. */
function publish(client: any, data: unknown, channel: string = PRIVATE_CHANNEL): void {
  client.subs[channel].emit('publication', {channel, data});
}

/**
 * Привести соединение в состояние subscribed (connect-ответ + подписки).
 * Для уже подключённого клиента subs уже созданы — просто подписываемся.
 */
function markSubscribed(client: any): void {
  client.emit('connected', {
    transport: 'websocket',
    client: 'c1',
    data: {company: 'acme', userID: '42'},
  });
  for (const channel of buildRealtimeChannels('acme', '42')) {
    client.subs[channel].emit('subscribed', {channel});
  }
}

describe('stripHtmlText', () => {
  it('преобразует body из примера портала в обычный текст', () => {
    expect(stripHtmlText(FEED_MESSAGE.body)).toBe(FEED_TEXT);
  });

  it('раскрывает &nbsp;/&amp; и схлопывает пробелы', () => {
    expect(stripHtmlText('A&nbsp;&amp;&nbsp;B<br/> C \n\t D')).toBe('A & B C D');
  });

  it('устойчиво к пустому и нестроковому значению', () => {
    expect(stripHtmlText('')).toBe('');
    expect(stripHtmlText(undefined as unknown as string)).toBe('');
    expect(stripHtmlText(null as unknown as string)).toBe('');
  });
});

describe('уведомления feed/target/message', () => {
  it('вызывает уведомление 1 раз с правильным title/text', () => {
    const client = startConnected();

    publish(client, {event: 'feed/target/message', payload: {message: FEED_MESSAGE}});

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(keepAliveMock.alertNewItem).toHaveBeenCalledWith(
      'Появилась новая заявка',
      FEED_TEXT,
      {sound: true, vibration: true, repeatCount: 1},
      'acc-1',
    );
    expect(keepAliveMock.notify).not.toHaveBeenCalled();
  });

  it('повторная публикация с тем же message.__id не дублирует уведомление', () => {
    const client = startConnected();
    const message = {...FEED_MESSAGE, __id: 'msg-dup'};
    const data = {event: 'feed/target/message', payload: {message}};

    publish(client, data);
    publish(client, data);
    publish(client, data);

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
  });

  it('при отсутствии alertNewItem используется notify(title, text)', () => {
    const original = keepAliveMock.alertNewItem;
    keepAliveMock.alertNewItem = undefined as unknown as jest.Mock;
    try {
      const client = startConnected();
      publish(client, {
        event: 'feed/target/message',
        payload: {message: {...FEED_MESSAGE, __id: 'msg-fallback'}},
      });

      expect(keepAliveMock.notify).toHaveBeenCalledTimes(1);
      expect(keepAliveMock.notify).toHaveBeenCalledWith('Появилась новая заявка', FEED_TEXT);
      expect(keepAliveMock.alertNewItem).toBeUndefined();
    } finally {
      keepAliveMock.alertNewItem = original;
    }
  });

  it('без message/без текста уведомление не показывается', () => {
    const client = startConnected();

    publish(client, {event: 'feed/target/message', payload: {}});
    publish(client, {event: 'feed/target/message', payload: {message: {title: '', body: ''}}});

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(keepAliveMock.notify).not.toHaveBeenCalled();
  });
});

describe('обновление списка заявок по app/bpm/instance', () => {
  it('дёргает обновление; повторы в пределах debounce — не чаще 1 раза', () => {
    const client = startConnected(makeAccount({id: 'acc-bpm'}));

    publish(client, BPM_EVENT);
    publish(client, BPM_EVENT);
    publish(client, BPM_EVENT);

    expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(1);
  });

  it('после debounce-окна обновление можно запросить снова', () => {
    jest.useFakeTimers();
    try {
      const client = startConnected(makeAccount({id: 'acc-bpm-later'}));

      publish(client, BPM_EVENT);
      expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2100);

      publish(client, BPM_EVENT);
      expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(2);
    } finally {
      stopAllRealtime();
      jest.useRealTimers();
    }
  });

  it('обрабатывает публикацию серверной подписки broadcast.<company>', () => {
    const client = startConnected(makeAccount({id: 'acc-broadcast'}));

    client.emit('publication', {channel: 'broadcast.acme', data: BPM_EVENT});

    expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(1);
  });

  it('разные учётки дебаунсятся независимо', () => {
    const client = startConnected(makeAccount({id: 'acc-bpm-a'}));
    const other = startConnected(makeAccount({id: 'acc-bpm-b'}));

    publish(client, BPM_EVENT);
    publish(other, BPM_EVENT);

    expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(2);
  });
});

describe('обновление списка по личным событиям портала', () => {
  it('feed/target/message → refreshApplicationsNow + уведомление по-прежнему показывается', () => {
    const client = startConnected(makeAccount({id: 'acc-feed-refresh'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-refresh'}},
    });

    expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(1);
    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
  });

  it('instance/end → refreshApplicationsNow', () => {
    const client = startConnected(makeAccount({id: 'acc-instance-end'}));

    publish(client, {event: 'instance/end', payload: {instance: 'i-9'}});

    expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(1);
    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
  });

  it('debounce: два подряд события в пределах 2 с → один вызов refreshApplicationsNow', () => {
    const client = startConnected(makeAccount({id: 'acc-personal-debounce'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-debounce-1'}},
    });
    publish(client, {event: 'instance/end', payload: {instance: 'i-10'}});

    expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(1);
  });

  it('после debounce-окна личное событие снова обновляет список', () => {
    jest.useFakeTimers();
    try {
      const client = startConnected(makeAccount({id: 'acc-personal-later'}));

      publish(client, {event: 'instance/end', payload: {instance: 'i-11'}});
      expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2100);

      publish(client, {
        event: 'feed/target/message',
        payload: {message: {...FEED_MESSAGE, __id: 'msg-personal-later'}},
      });
      expect(applicationsSyncMock.refreshApplicationsNow).toHaveBeenCalledTimes(2);
    } finally {
      stopAllRealtime();
      jest.useRealTimers();
    }
  });
});

describe('прочие события', () => {
  it('ни уведомления, ни обновления', () => {
    const client = startConnected(makeAccount({id: 'acc-other'}));

    publish(client, {event: 'task-created', payload: {name: 'Заявка'}});
    client.emit('message', {data: {event: 'feed/sync', payload: {}}});

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(keepAliveMock.notify).not.toHaveBeenCalled();
    expect(applicationsSyncMock.refreshApplicationsNow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Этап 2b: уведомления из realtime уважают настройки и не дублируются с опросом
// ---------------------------------------------------------------------------

/** Feed-уведомление о задаче (цель system/tasks) — заявка тут ни при чём. */
const FEED_TASK_MESSAGE = {
  __id: 'msg-task-1',
  __createdAt: '2026-10-08T09:20:00.000Z',
  author: 'system',
  title: 'Новая задача',
  body: 'Вам назначена задача № 55',
  target: {namespace: 'system', code: 'tasks', id: 'task-55', title: 'Задача 55'},
  is_personal: true,
};

/** Последний набор seen-ключей, переданный в persistSeenKeys (null — не вызывался). */
function persistedSeenKeys(): Set<string> | null {
  const calls = seenAlertsMock.persistSeenKeys.mock.calls;
  if (calls.length === 0) {
    return null;
  }
  return calls[calls.length - 1][0] as Set<string>;
}

/** Был ли в диагностическом журнале фрагмент (например notify-skip reason=…). */
function diagLogged(fragment: string): boolean {
  return mockedLogDiag.mock.calls.some(call => String(call[1]).includes(fragment));
}

describe('настройки уведомлений realtime', () => {
  it('notificationsEnabled: false → alertNewItem/notify не вызываются, виджет не пульсирует', () => {
    settingsState.notificationsEnabled = false;
    settingsState.floatingWidgetEnabled = true;
    const client = startConnected(makeAccount({id: 'acc-disabled'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-disabled'}},
    });

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(keepAliveMock.notify).not.toHaveBeenCalled();
    expect(keepAliveMock.pulseOverlayWidget).not.toHaveBeenCalled();
    expect(diagLogged('notify-skip reason=disabled')).toBe(true);
  });

  it('notificationsEnabled: false → дедуп-ключ заявки всё равно фиксируется', async () => {
    settingsState.notificationsEnabled = false;
    const client = startConnected(makeAccount({id: 'acc-disabled-seen'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-disabled-seen'}},
    });
    await flushAsync();

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    const keys = persistedSeenKeys();
    expect(keys).not.toBeNull();
    expect(Array.from(keys as Set<string>)).toContain(
      `acc-disabled-seen::${FEED_MESSAGE.target.id}`,
    );
  });

  it('включённые настройки → alertNewItem получает sound/vibration/repeatCount из стора', () => {
    settingsState.soundEnabled = false;
    settingsState.vibrationEnabled = true;
    settingsState.alertRepeatCount = 3;
    const client = startConnected(makeAccount({id: 'acc-settings'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-settings'}},
    });

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(keepAliveMock.alertNewItem).toHaveBeenCalledWith(
      'Появилась новая заявка',
      FEED_TEXT,
      {sound: false, vibration: true, repeatCount: 3},
      'acc-settings',
    );
    expect(keepAliveMock.notify).not.toHaveBeenCalled();
  });

  it('floatingWidgetEnabled: true → пульсирует overlay-виджет', () => {
    settingsState.floatingWidgetEnabled = true;
    const client = startConnected(makeAccount({id: 'acc-widget'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-widget'}},
    });

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(keepAliveMock.pulseOverlayWidget).toHaveBeenCalledTimes(1);
  });
});

describe('дедуп с уведомлениями из опроса (seen-application-alerts)', () => {
  it('заявка customer_service/applications → seen-ключ `${accountId}::${target.id}` сохранён', async () => {
    const client = startConnected(makeAccount({id: 'acc-app'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-seen-app'}},
    });
    await flushAsync();

    expect(seenAlertsMock.loadSeenKeys).toHaveBeenCalledTimes(1);
    expect(seenAlertsMock.persistSeenKeys).toHaveBeenCalledTimes(1);
    const keys = persistedSeenKeys();
    expect(keys).not.toBeNull();
    expect(Array.from(keys as Set<string>)).toContain(`acc-app::${FEED_MESSAGE.target.id}`);
  });

  it('feed-уведомление о задаче (system/tasks) → seen-ключ заявки НЕ добавляется', async () => {
    const client = startConnected(makeAccount({id: 'acc-task'}));

    publish(client, {event: 'feed/target/message', payload: {message: FEED_TASK_MESSAGE}});
    await flushAsync();

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(seenAlertsMock.persistSeenKeys).not.toHaveBeenCalled();
  });

  it('сбой хранилища seen не ломает приём публикации и уведомление показывается', async () => {
    seenAlertsMock.loadSeenKeys.mockRejectedValueOnce(new Error('storage down'));
    const client = startConnected(makeAccount({id: 'acc-seen-fail'}));

    expect(() =>
      publish(client, {
        event: 'feed/target/message',
        payload: {message: {...FEED_MESSAGE, __id: 'msg-seen-fail'}},
      }),
    ).not.toThrow();
    await flushAsync();

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(seenAlertsMock.persistSeenKeys).not.toHaveBeenCalled();
  });
});

describe('markApplicationSeen', () => {
  it('добавляет ключ accountId::id и сохраняет набор', async () => {
    await markApplicationSeen('acc-x', 'item-9');

    const keys = persistedSeenKeys();
    expect(keys).not.toBeNull();
    expect(Array.from(keys as Set<string>)).toContain('acc-x::item-9');
  });

  it('сбой чтения хранилища глушится (resolves без записи)', async () => {
    seenAlertsMock.loadSeenKeys.mockRejectedValueOnce(new Error('down'));

    await expect(markApplicationSeen('acc-x', 'item-10')).resolves.toBeUndefined();
    expect(seenAlertsMock.persistSeenKeys).not.toHaveBeenCalled();
  });

  it('пустые accountId/id — no-op', async () => {
    await markApplicationSeen('', 'item-11');
    await markApplicationSeen('acc-x', '');

    expect(seenAlertsMock.loadSeenKeys).not.toHaveBeenCalled();
    expect(seenAlertsMock.persistSeenKeys).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Периодический статус соединений в diag-логе (раз в 60 секунд)
// ---------------------------------------------------------------------------

/** Последняя строка статуса `status connections=…` (null — статус не писался). */
function statusLine(): string | null {
  const call = mockedLogDiag.mock.calls.find(c => String(c[1]).includes('status connections='));
  return call === undefined ? null : String(call[1]);
}

describe('периодический статус realtime', () => {
  it('раз в 60 секунд пишет status connections= при наличии соединения', () => {
    jest.useFakeTimers();
    try {
      startConnected(makeAccount({id: 'acc-status'}));
      mockedLogDiag.mockClear();

      jest.advanceTimersByTime(60000);

      const statusCall = mockedLogDiag.mock.calls.find(
        call => String(call[1]).includes('status connections='),
      );
      expect(statusCall).toBeDefined();
      expect(statusCall![0]).toBe('realtime');
      expect(String(statusCall![1])).toContain('status connections=1');
      expect(String(statusCall![1])).toContain('accounts=acc-status=connected');
      expect(statusLine()).toBe(String(statusCall![1]));
    } finally {
      stopAllRealtime();
      jest.useRealTimers();
    }
  });

  it('статус отражает состояние каждой учётки (connected/subscribed/closed)', () => {
    jest.useFakeTimers();
    try {
      startConnected(makeAccount({id: 'acc-states'}));

      jest.advanceTimersByTime(60000);
      expect(statusLine()).toContain('accounts=acc-states=connected');
      // Первый тик перезапускает не-subscribed старше REALTIME_STALE_MS —
      // дальше работаем с уже пересозданным клиентом.
      const client = instances[instances.length - 1];

      markSubscribed(client);
      mockedLogDiag.mockClear();
      jest.advanceTimersByTime(60000);
      expect(statusLine()).toContain('status connections=1');
      expect(statusLine()).toContain('accounts=acc-states=subscribed');
      expect(realtimeConnectionsCount()).toBe(1);

      client.emit('disconnected', {code: 0, reason: 'stop'});
      mockedLogDiag.mockClear();
      jest.advanceTimersByTime(60000);
      expect(statusLine()).toContain('accounts=acc-states=closed');
    } finally {
      stopAllRealtime();
      jest.useRealTimers();
    }
  });

  it('после остановки всех соединений таймер статуса очищен', () => {
    jest.useFakeTimers();
    try {
      startConnected(makeAccount({id: 'acc-stopped'}));
      stopAllRealtime();
      mockedLogDiag.mockClear();

      jest.advanceTimersByTime(180000);

      expect(statusLine()).toBeNull();
      expect(mockedLogDiag).not.toHaveBeenCalled();
    } finally {
      stopAllRealtime();
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Сторож realtime: перезапуск закрытых (closed) и простаревших (age) соединений
// ---------------------------------------------------------------------------

/** Число перезапусков сторожа в диагностическом журнале. */
function watchdogRestarts(reason?: string): string[] {
  const needle = reason === undefined ? 'watchdog-restart ' : `watchdog-restart reason=${reason} `;
  return mockedLogDiag.mock.calls
    .map(call => String(call[1]))
    .filter(text => text.includes(needle));
}

describe('сторож realtime', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('через 60 с перезапускает соединение в состоянии closed', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-closed'}));
    client.emit('disconnected', {code: 0, reason: 'bye'});
    mockedLogDiag.mockClear();

    jest.advanceTimersByTime(REALTIME_WATCHDOG_INTERVAL_MS);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnectCalled).toBe(true);
    expect(instances[1].connectCalled).toBe(true);
    expect(instances[1].url).toBe('wss://portal.elma.ru/ws/v2/websocket');
    expect(watchdogRestarts('closed')).toHaveLength(1);
    expect(watchdogRestarts('closed')[0]).toContain('acc-closed');
    expect(statusLine()).toContain('accounts=acc-closed=closed');
  });

  it('не перезапускается чаще REALTIME_RESTART_MIN_GAP_MS (два тика подряд — один перезапуск)', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-gap'}));
    client.emit('disconnected', {code: 0, reason: 'bye'});
    mockedLogDiag.mockClear();

    jest.advanceTimersByTime(REALTIME_WATCHDOG_INTERVAL_MS); // тик 1 → перезапуск
    expect(instances).toHaveLength(2);

    // Перезапущенное соединение успело подписаться (state=subscribed) — живое,
    // поэтому за два тика подряд ровно один перезапуск.
    markSubscribed(instances[1]);
    jest.advanceTimersByTime(REALTIME_WATCHDOG_INTERVAL_MS);
    expect(instances).toHaveLength(2);
    expect(watchdogRestarts()).toHaveLength(1);
  });

  it('перезапуск блокируется, пока не прошло REALTIME_RESTART_MIN_GAP_MS', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-min-gap'}));
    client.emit('disconnected', {code: 0, reason: 'bye'});

    jest.advanceTimersByTime(REALTIME_WATCHDOG_INTERVAL_MS); // перезапуск сторожем
    expect(instances).toHaveLength(2);

    instances[1].emit('disconnected', {code: 0, reason: 'bye'}); // упало снова
    ensureRealtimeAlive(); // сразу после перезапуска — gap не прошёл
    expect(instances).toHaveLength(2);
    expect(watchdogRestarts('stale')).toHaveLength(0);

    jest.advanceTimersByTime(REALTIME_RESTART_MIN_GAP_MS); // gap прошёл (тика нет)
    ensureRealtimeAlive();
    expect(instances).toHaveLength(3);
    expect(watchdogRestarts('stale')).toHaveLength(1);
  });

  it('перезапускает по возрасту (> REALTIME_MAX_CONNECTION_AGE_MS), даже если state не closed', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-age'}));
    markSubscribed(client); // subscribed: срабатывает только причина age, не stale

    jest.advanceTimersByTime(REALTIME_MAX_CONNECTION_AGE_MS + REALTIME_WATCHDOG_INTERVAL_MS);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnectCalled).toBe(true);
    expect(instances[1].connectCalled).toBe(true);
    expect(watchdogRestarts('age')).toHaveLength(1);
    expect(watchdogRestarts('closed')).toHaveLength(0);
    expect(watchdogRestarts('age')[0]).toContain('acc-age');
  });

  it('connecting дольше REALTIME_STALE_MS → перезапуск с reason=stale (не age)', () => {
    jest.useFakeTimers();
    startRealtime(makeAccount({id: 'acc-stale'})); // state=connecting, подписок не было
    mockedLogDiag.mockClear();

    jest.advanceTimersByTime(REALTIME_STALE_MS + REALTIME_WATCHDOG_INTERVAL_MS);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnectCalled).toBe(true);
    expect(instances[1].connectCalled).toBe(true);
    expect(watchdogRestarts('stale')).toHaveLength(1);
    expect(watchdogRestarts('stale')[0]).toContain('acc-stale');
    expect(watchdogRestarts('age')).toHaveLength(0);
    expect(watchdogRestarts('closed')).toHaveLength(0);
  });

  it('ensureRealtimeAlive() перезапускает не-subscribed соединения, subscribed не трогает', () => {
    const live = startConnected(makeAccount({id: 'acc-live'}));
    markSubscribed(live); // subscribed — живое, не трогаем
    startConnected(makeAccount({id: 'acc-stuck'})); // connected, но подписок нет
    const dead = startConnected(makeAccount({id: 'acc-dead'}));
    dead.emit('disconnected', {code: 0, reason: 'background'});
    mockedLogDiag.mockClear();

    ensureRealtimeAlive();

    expect(instances).toHaveLength(5);
    expect(instances[0].disconnectCalled).toBe(false); // subscribed не тронуто
    expect(instances[1].disconnectCalled).toBe(true); // connected → перезапущено
    expect(instances[2].disconnectCalled).toBe(true); // closed → перезапущено
    const staleLogs = watchdogRestarts('stale').join('\n');
    expect(watchdogRestarts('stale')).toHaveLength(2);
    expect(staleLogs).toContain('acc-stuck');
    expect(staleLogs).toContain('acc-dead');
    expect(staleLogs).not.toContain('acc-live');
    expect(watchdogRestarts('resume')).toHaveLength(0);
  });

  it('ensureRealtimeAlive(true) перезапускает connecting немедленно, min-gap игнорируется', () => {
    jest.useFakeTimers();
    startRealtime(makeAccount({id: 'acc-force'})); // state=connecting, lastRestartAt=0

    ensureRealtimeAlive(false); // min-gap от начала эпохи прошёл → перезапуск
    expect(instances).toHaveLength(2);
    expect(watchdogRestarts('stale')).toHaveLength(1);

    ensureRealtimeAlive(false); // сразу после — min-gap не прошёл → без перезапуска
    expect(instances).toHaveLength(2);
    expect(watchdogRestarts('stale')).toHaveLength(1);

    ensureRealtimeAlive(true); // force — min-gap игнорируется
    expect(instances).toHaveLength(3);
    expect(instances[1].disconnectCalled).toBe(true);
    expect(watchdogRestarts('resume')).toHaveLength(1);
  });

  it('ensureRealtimeAlive() только с subscribed-соединениями — no-op', () => {
    const client = startConnected(makeAccount({id: 'acc-ok'}));
    markSubscribed(client);

    ensureRealtimeAlive();

    expect(instances).toHaveLength(1);
    expect(instances[0].disconnectCalled).toBe(false);
    expect(watchdogRestarts()).toHaveLength(0);
  });

  it('ensureRealtimeAlive() без соединений — no-op без исключений', () => {
    expect(() => ensureRealtimeAlive()).not.toThrow();
    expect(realtimeConnectionsCount()).toBe(0);
    expect(instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// «Зомби-подписка»: TCP-сокет Centrifugo умирает молча — ни disconnected, ни
// error не приходит, state остаётся subscribed, и в пуш-режиме страховочный
// опрос никогда не включается. Спасает учёт lastActivityAt: молчащее
// соединение перестаёт считаться подписанным.
// ---------------------------------------------------------------------------

describe('молчащая (зомби) подписка realtime', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('свежая подписка считается активной', () => {
    const client = startConnected(makeAccount({id: 'acc-fresh'}));
    markSubscribed(client);

    expect(isRealtimeSubscribed('acc-fresh')).toBe(true);
  });

  it('без соединения учётки подписки нет', () => {
    expect(isRealtimeSubscribed('acc-unknown')).toBe(false);
  });

  it('после тишины дольше REALTIME_SILENCE_MS подписка считается мёртвой', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-silent'}));
    markSubscribed(client);
    expect(isRealtimeSubscribed('acc-silent')).toBe(true);

    jest.advanceTimersByTime(REALTIME_SILENCE_MS + 1000);

    expect(isRealtimeSubscribed('acc-silent')).toBe(false);
    expect(instances).toHaveLength(1); // в фоне сокет сам не пересоздаётся
  });

  it('входящая публикация вновь делает подписку активной', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-revive'}));
    markSubscribed(client);

    jest.advanceTimersByTime(REALTIME_SILENCE_MS + 1000);
    expect(isRealtimeSubscribed('acc-revive')).toBe(false);

    publish(client, FEED_MESSAGE);

    expect(isRealtimeSubscribed('acc-revive')).toBe(true);
  });

  it('ensureRealtimeAlive(false) молчащую подписку не трогает (фон)', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-bg'}));
    markSubscribed(client);
    jest.advanceTimersByTime(REALTIME_SILENCE_MS + 1000);
    mockedLogDiag.mockClear();

    ensureRealtimeAlive(false);

    expect(instances).toHaveLength(1);
    expect(instances[0].disconnectCalled).toBe(false);
    expect(watchdogRestarts()).toHaveLength(0);
  });

  it('ensureRealtimeAlive(true) перезапускает молчащую подписку (возврат из фона)', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-resume'}));
    markSubscribed(client);
    jest.advanceTimersByTime(REALTIME_SILENCE_MS + 1000);
    mockedLogDiag.mockClear();

    ensureRealtimeAlive(true);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnectCalled).toBe(true);
    expect(watchdogRestarts('resume')).toHaveLength(1);
  });

  it('ensureRealtimeAlive(true) свежую подписку не трогает', () => {
    const client = startConnected(makeAccount({id: 'acc-recent'}));
    markSubscribed(client); // lastActivityAt = сейчас

    ensureRealtimeAlive(true);

    expect(instances).toHaveLength(1);
    expect(instances[0].disconnectCalled).toBe(false);
    expect(watchdogRestarts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Здоровье по НАТИВНОМУ тику (multiElmaSyncTick): в фоне JS-таймеры заморожены,
// поэтому проверка живости соединений идёт от нативного тикера.
// ---------------------------------------------------------------------------

describe('здоровье realtime по нативному тику', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('первый тик лечит не-subscribed соединение с reason=stale', () => {
    jest.useFakeTimers();
    startConnected(makeAccount({id: 'acc-tick'})); // connected, подписок нет
    mockedLogDiag.mockClear();

    DeviceEventEmitter.emit(SYNC_TICK_EVENT);

    expect(instances).toHaveLength(2);
    expect(instances[0].disconnectCalled).toBe(true);
    expect(instances[1].connectCalled).toBe(true);
    expect(watchdogRestarts('stale')).toHaveLength(1);
    expect(watchdogRestarts('stale')[0]).toContain('acc-tick');
  });

  it('частота проверки ограничена REALTIME_TICK_HEALTH_MIN_GAP_MS', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-tick-rate'}));
    markSubscribed(client); // первый тик ничего не лечит, но фиксирует момент
    mockedLogDiag.mockClear();

    DeviceEventEmitter.emit(SYNC_TICK_EVENT);
    expect(instances).toHaveLength(1);

    client.emit('disconnected', {code: 0, reason: 'bye'}); // стало не-subscribed
    DeviceEventEmitter.emit(SYNC_TICK_EVENT); // тик сразу же — частота не выдержана
    expect(instances).toHaveLength(1);
    expect(watchdogRestarts()).toHaveLength(0);

    jest.advanceTimersByTime(REALTIME_TICK_HEALTH_MIN_GAP_MS); // пауза выдержана
    DeviceEventEmitter.emit(SYNC_TICK_EVENT);
    expect(instances).toHaveLength(2);
    expect(watchdogRestarts('stale')).toHaveLength(1);
  });

  it('после остановки всех соединений подписка на тик снята', () => {
    jest.useFakeTimers();
    const client = startConnected(makeAccount({id: 'acc-tick-off'}));
    markSubscribed(client);
    stopAllRealtime();
    mockedLogDiag.mockClear();

    client.emit('disconnected', {code: 0, reason: 'bye'});
    DeviceEventEmitter.emit(SYNC_TICK_EVENT);
    jest.advanceTimersByTime(180000);

    expect(realtimeConnectionsCount()).toBe(0);
    expect(watchdogRestarts()).toHaveLength(0);
    expect(mockedLogDiag).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Классификация уведомлений и фильтр по категориям
// ---------------------------------------------------------------------------

describe('classifyNotification', () => {
  it('«Поставлена задача: …» → task-new', () => {
    expect(
      classifyNotification('Поставлена задача: "Связаться с клиентом по заявке 16209"', ''),
    ).toBe('task-new');
  });

  it('«Назначена задача …» → task-new', () => {
    expect(classifyNotification('Назначена задача № 55', 'Срок сегодня')).toBe('task-new');
  });

  it('«Новая заявка 22178» → application-new', () => {
    expect(classifyNotification('Новая заявка 22178', '')).toBe('application-new');
  });

  it('«Заявка 123 переведена …» → status', () => {
    expect(classifyNotification('Заявка 123 переведена в работу', '')).toBe('status');
  });

  it('«Задача … изменён статус» → status', () => {
    expect(classifyNotification('Задача № 10 изменён статус', 'Выполнена')).toBe('status');
  });

  it('«Изменён статус задачи …» → status', () => {
    expect(classifyNotification('Изменён статус задачи № 10', '')).toBe('status');
  });

  it('прочее → other', () => {
    expect(classifyNotification('Системное сообщение', 'Профилактика')).toBe('other');
  });
});

describe('фильтр категорий уведомлений', () => {
  it('notifyNewTasks: false → уведомление о задаче не показывается, в diag notify-skip reason=kind-disabled', () => {
    settingsState.notifyNewTasks = false;
    const client = startConnected(makeAccount({id: 'acc-kind-task'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_TASK_MESSAGE, __id: 'msg-kind-task'}},
    });

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(diagLogged('notify-skip reason=kind-disabled kind=task-new')).toBe(true);
    expect(diagLogged('notify-class kind=task-new')).toBe(true);
  });

  it('notifyNewApplications: false → уведомление о заявке не показывается', () => {
    settingsState.notifyNewApplications = false;
    const client = startConnected(makeAccount({id: 'acc-kind-app'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-kind-app'}},
    });

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(diagLogged('notify-skip reason=kind-disabled kind=application-new')).toBe(true);
  });

  it('notifyStatusChangesTasks: false → смена статуса ЗАДАЧИ не показывается', () => {
    settingsState.notifyStatusChangesTasks = false;
    const client = startConnected(makeAccount({id: 'acc-kind-status-task'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {
        message: {
          ...FEED_TASK_MESSAGE,
          __id: 'msg-kind-status-task',
          title: 'Изменён статус задачи № 10',
          body: '',
        },
      },
    });

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(diagLogged('notify-skip reason=kind-disabled kind=status')).toBe(true);
    expect(diagLogged('targetNs=system')).toBe(true);
  });

  it('notifyStatusChangesTasks: false → смена статуса ЗАЯВКИ всё равно показывается', () => {
    settingsState.notifyStatusChangesTasks = false;
    const client = startConnected(makeAccount({id: 'acc-kind-status-app-on'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {
        message: {
          ...FEED_MESSAGE,
          __id: 'msg-kind-status-app-on',
          title: 'Заявка 123 переведена в работу',
          body: '',
        },
      },
    });

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(diagLogged('notify-class kind=status')).toBe(true);
    expect(diagLogged('targetNs=customer_service')).toBe(true);
    expect(diagLogged('notify-skip reason=kind-disabled kind=status')).toBe(false);
  });

  it('notifyStatusChangesApplications: false → смена статуса ЗАЯВКИ не показывается', () => {
    settingsState.notifyStatusChangesApplications = false;
    const client = startConnected(makeAccount({id: 'acc-kind-status-app'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {
        message: {
          ...FEED_MESSAGE,
          __id: 'msg-kind-status-app',
          title: 'Заявка 123 переведена в работу',
          body: '',
        },
      },
    });

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(diagLogged('notify-skip reason=kind-disabled kind=status')).toBe(true);
  });

  it('notifyStatusChangesApplications: false → смена статуса ЗАДАЧИ всё равно показывается', () => {
    settingsState.notifyStatusChangesApplications = false;
    const client = startConnected(makeAccount({id: 'acc-kind-status-task-on'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {
        message: {
          ...FEED_TASK_MESSAGE,
          __id: 'msg-kind-status-task-on',
          title: 'Изменён статус задачи № 10',
          body: '',
        },
      },
    });

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(diagLogged('notify-class kind=status')).toBe(true);
    expect(diagLogged('notify-skip reason=kind-disabled kind=status')).toBe(false);
  });

  it('категории включены → alertNewItem вызван, notify-class пишет kind/target', () => {
    const client = startConnected(makeAccount({id: 'acc-kind-on'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_TASK_MESSAGE, __id: 'msg-kind-on'}},
    });

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(diagLogged('notify-class kind=task-new')).toBe(true);
    expect(diagLogged('targetNs=system')).toBe(true);
    expect(diagLogged('targetCode=tasks')).toBe(true);
  });

  it('категория other показывается всегда', () => {
    settingsState.notifyNewTasks = false;
    settingsState.notifyNewApplications = false;
    settingsState.notifyStatusChangesApplications = false;
    settingsState.notifyStatusChangesTasks = false;
    const client = startConnected(makeAccount({id: 'acc-kind-other'}));

    publish(client, {
      event: 'feed/target/message',
      payload: {
        message: {
          __id: 'msg-kind-other',
          __createdAt: '2026-10-08T10:00:00.000Z',
          title: 'Системное сообщение',
          body: 'Профилактика',
          target: {namespace: 'system', code: 'news', id: 'n-1', title: 'Новость'},
        },
      },
    });

    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
    expect(diagLogged('notify-class kind=other')).toBe(true);
    expect(diagLogged('notify-skip reason=kind-disabled kind=other')).toBe(false);
  });

  it('фильтр применяется после дедуп-ключа: повтор того же message.__id не даёт второго skip/notify', () => {
    settingsState.notifyNewTasks = false;
    const client = startConnected(makeAccount({id: 'acc-kind-dedup'}));
    const data = {
      event: 'feed/target/message',
      payload: {message: {...FEED_TASK_MESSAGE, __id: 'msg-kind-dedup'}},
    };

    publish(client, data);
    publish(client, data);

    expect(diagLogged('notify-skip reason=kind-disabled kind=task-new')).toBe(true);
    const skips = mockedLogDiag.mock.calls.filter(call =>
      String(call[1]).includes('notify-skip reason=kind-disabled'),
    );
    expect(skips).toHaveLength(1);
    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
  });
});

describe('diag-логирование object-событий', () => {
  it('object-событие не показывает уведомление, но пишет object-event в diag', () => {
    const client = startConnected(makeAccount({id: 'acc-object'}));

    publish(client, {
      event: 'object',
      payload: {
        address: {type: 'task-created'},
        title: 'Задача создана',
        body: '…',
      },
    });

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(keepAliveMock.notify).not.toHaveBeenCalled();
    expect(diagLogged('object-event addressType=task-created title=Задача создана')).toBe(true);
  });

  it('updatecounters/... не логируется как уведомление и не показывает пуш', () => {
    const client = startConnected(makeAccount({id: 'acc-counters'}));

    client.emit('message', {
      data: {event: 'updatecounters/income/inc', payload: {count: 1}},
    });

    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
    expect(keepAliveMock.notify).not.toHaveBeenCalled();
    expect(diagLogged('notify-class')).toBe(false);
    expect(diagLogged('notify-skip')).toBe(false);
    expect(diagLogged('object-event')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Шум от updatecounters + устойчивость обработчика входящих событий
// ---------------------------------------------------------------------------

/** Строка лога pub/… с указанным событием (null — не логировалась). */
function pubLineFor(event: string): string | null {
  const call = mockedLogDiag.mock.calls.find(c => String(c[1]).includes(`event=${event}`));
  return call === undefined ? null : String(call[1]);
}

describe('логирование updatecounters и устойчивость dispatch', () => {
  it('pub для updatecounters/income/inc — без payload и без его содержимого', () => {
    const client = startConnected(makeAccount({id: 'acc-uc'}));
    mockedLogDiag.mockClear();

    client.emit('publication', {
      channel: 'broadcast.acme',
      data: {event: 'updatecounters/income/inc', payload: {count: 5, marker: 'UC-MARKER-5'}},
    });

    const line = pubLineFor('updatecounters/income/inc');
    expect(line).not.toBeNull();
    expect(line).toContain('pub account=');
    expect(line).toContain('channel=broadcast.acme');
    expect(line).not.toContain('payload=');
    expect(line).not.toContain('UC-MARKER-5');
  });

  it('message-путь для updatecounters — тоже без содержимого payload', () => {
    const client = startConnected(makeAccount({id: 'acc-uc-msg'}));
    mockedLogDiag.mockClear();

    client.emit('message', {
      data: {event: 'updatecounters/income/inc', payload: {marker: 'UC-MARKER-MSG'}},
    });

    const lines = mockedLogDiag.mock.calls.map(call => String(call[1]));
    expect(lines.some(text => text.includes('event=updatecounters/income/inc'))).toBe(true);
    expect(lines.some(text => text.includes('UC-MARKER-MSG'))).toBe(false);
    expect(lines.some(text => text.includes('payload='))).toBe(false);
  });

  it('остальные события логируются с payload', () => {
    const client = startConnected(makeAccount({id: 'acc-uc-other'}));
    mockedLogDiag.mockClear();

    client.emit('publication', {
      channel: 'broadcast.acme',
      data: {event: 'task-created', payload: {name: 'Заявка'}},
    });

    const line = pubLineFor('task-created');
    expect(line).not.toBeNull();
    expect(line).toContain('payload=');
    expect(line).toContain('Заявка');
  });

  it('исключение в обработчике не выбрасывается наружу: dispatch-error в diag', () => {
    const client = startConnected(makeAccount({id: 'acc-dispatch-boom'}));
    const payload = {};
    Object.defineProperty(payload, 'message', {
      get() {
        throw new Error('boom');
      },
      enumerable: false,
    });
    mockedLogDiag.mockClear();

    expect(() =>
      publish(client, {event: 'feed/target/message', payload}),
    ).not.toThrow();

    expect(diagLogged('dispatch-error event=feed/target/message')).toBe(true);
    expect(diagLogged('error=boom')).toBe(true);
    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();

    // Поток обработки жив: следующая публикация обрабатывается как обычно.
    publish(client, {
      event: 'feed/target/message',
      payload: {message: {...FEED_MESSAGE, __id: 'msg-after-boom'}},
    });
    expect(keepAliveMock.alertNewItem).toHaveBeenCalledTimes(1);
  });

  it('исключение при разборе публикации тоже не ломает поток', () => {
    const client = startConnected(makeAccount({id: 'acc-log-boom'}));
    const data: Record<string, unknown> = {event: 'feed/target/message'};
    Object.defineProperty(data, 'payload', {
      get() {
        throw new Error('describe-boom');
      },
      enumerable: true,
    });
    mockedLogDiag.mockClear();

    expect(() =>
      client.emit('publication', {channel: 'broadcast.acme', data}),
    ).not.toThrow();

    expect(diagLogged('dispatch-error')).toBe(true);
    expect(diagLogged('error=describe-boom')).toBe(true);
    expect(keepAliveMock.alertNewItem).not.toHaveBeenCalled();
  });
});
