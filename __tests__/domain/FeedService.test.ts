jest.mock('../../src/services/elma-api', () => ({
  feedChannels: jest.fn(),
  feedMessages: jest.fn(),
  feedTargetsUnread: jest.fn(),
  resolveUserNames: jest.fn().mockResolvedValue(new Map()),
}));

import {FeedService} from '../../src/domain/FeedService';
import {
  feedChannels as apiFeedChannels,
  feedMessages as apiFeedMessages,
  feedTargetsUnread as apiFeedTargetsUnread,
} from '../../src/services/elma-api';
import {ElmaRequestError} from '../../src/types/errors';
import type {FeedPersistence, AccountPersistence} from '../../src/interfaces/persistence';
import type {ElmaAccount} from '../../src/types/account';

const mockedFeedChannels = apiFeedChannels as jest.MockedFunction<typeof apiFeedChannels>;
const mockedFeedMessages = apiFeedMessages as jest.MockedFunction<typeof apiFeedMessages>;
const mockedFeedTargetsUnread = apiFeedTargetsUnread as jest.MockedFunction<typeof apiFeedTargetsUnread>;

function makeAccount(overrides: Partial<ElmaAccount> = {}): ElmaAccount {
  return {
    id: 'acc-1',
    name: 'Test',
    baseUrl: 'https://test.elma.ru',
    portal: 'p',
    token: 'tok',
    userId: 'uid-1',
    color: '#6200EE',
    isActive: true,
    ...overrides,
  };
}

function makeFeedPersistence(): FeedPersistence {
  return {
    setMessages: jest.fn(),
    setChannels: jest.fn(),
    setUnreadCount: jest.fn(),
    setLoading: jest.fn(),
    setError: jest.fn(),
    setOffset: jest.fn(),
    setHasMore: jest.fn(),
  };
}

function makeAccountPersistence(): AccountPersistence {
  return {
    updateAccount: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// FeedService — loadMessages
// ---------------------------------------------------------------------------
describe('FeedService — loadMessages', () => {
  let fp: FeedPersistence;
  let ap: AccountPersistence;
  let service: FeedService;

  beforeEach(() => {
    jest.clearAllMocks();
    fp = makeFeedPersistence();
    ap = makeAccountPersistence();
    service = new FeedService(fp, ap);
  });

  it('успешная загрузка с маппингом через extractField', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({
      messages: [
        {id: 'msg-1', title: 'Привет', text: 'Текст', author: 'uid-1', userName: 'Имя', createdAt: '2025-01-01'},
      ],
    });

    const result = await service.loadMessages(account);

    expect(result.ok).toBe(true);
    expect(fp.setMessages).toHaveBeenCalled();
    const messages = (fp.setMessages as jest.Mock).mock.calls[0][1];
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].title).toBe('Привет');
    expect(messages[0].text).toBe('Текст');
    expect(messages[0].author).toBe('uid-1');
  });

  it('append=true при offset > 0', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({messages: [{id: 'm1'}]});

    await service.loadMessages(account, 20);

    expect(fp.setMessages).toHaveBeenCalledWith('acc-1', expect.any(Array), true);
  });

  it('append=false при offset = 0', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({messages: [{id: 'm1'}]});

    await service.loadMessages(account, 0);

    // append не передаётся (undefined/false)
    const args = (fp.setMessages as jest.Mock).mock.calls[0];
    expect(args[2]).toBeFalsy();
  });

  it('setHasMore=true когда >= 20 сообщений', async () => {
    const account = makeAccount();
    const msgs = Array.from({length: 20}, (_, i) => ({id: `m${i}`}));
    mockedFeedMessages.mockResolvedValue({messages: msgs});

    await service.loadMessages(account);

    expect(fp.setHasMore).toHaveBeenCalledWith('acc-1', true);
  });

  it('setHasMore=false когда < 20 сообщений', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({messages: [{id: 'm1'}]});

    await service.loadMessages(account);

    expect(fp.setHasMore).toHaveBeenCalledWith('acc-1', false);
  });

  it('setOffset обновляется', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({
      messages: [{id: 'm1'}, {id: 'm2'}, {id: 'm3'}],
    });

    await service.loadMessages(account, 10);

    expect(fp.setOffset).toHaveBeenCalledWith('acc-1', 13);
  });

  it('setLoading=true затем false', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({messages: []});

    await service.loadMessages(account);

    const loadingCalls = (fp.setLoading as jest.Mock).mock.calls;
    expect(loadingCalls[0]).toEqual(['acc-1', true]);
    expect(loadingCalls[loadingCalls.length - 1]).toEqual(['acc-1', false]);
  });

  it('обрабатывает ошибку → setError, setLoading(false)', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockRejectedValue(new Error('Network error'));

    const result = await service.loadMessages(account);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Network error');
    expect(fp.setError).toHaveBeenCalledWith('acc-1', 'Network error');
    expect(fp.setLoading).toHaveBeenCalledWith('acc-1', false);
  });

  it('обрабатывает ElmaRequestError с kind', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockRejectedValue(
      new ElmaRequestError('timeout', 'Превышен таймаут'),
    );

    const result = await service.loadMessages(account);

    expect(result.ok).toBe(false);
    expect(result.kind).toBe('timeout');
  });

  it('сохраняет updatedAccount если есть', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({
      messages: [],
      updatedAccount: {token: 'new-tok'},
    });

    await service.loadMessages(account);

    expect(ap.updateAccount).toHaveBeenCalledWith('acc-1', {token: 'new-tok'});
  });

  it('не удаляет события с автором другого пользователя (серверная изоляция)', async () => {
    const account = makeAccount({userId: 'uid-1'});
    mockedFeedMessages.mockResolvedValue({
      messages: [
        {id: 'm1', author: 'uid-1', title: 'От текущего'},
        {id: 'm2', author: 'uid-other', title: 'От другого'},
        {id: 'm3', title: 'Системное'},
      ],
    });

    await service.loadMessages(account);

    const messages = (fp.setMessages as jest.Mock).mock.calls[0][1];
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('m1');
    expect(messages[1].id).toBe('m2');
    expect(messages[2].id).toBe('m3');
  });

  it('резолвит GUID авторов в имена через resolveUserNames', async () => {
    const account = makeAccount();
    const {resolveUserNames} = require('../../src/services/elma-api');
    resolveUserNames.mockResolvedValue(new Map([['uid-abc', 'Тестовый Пользователь']]));

    mockedFeedMessages.mockResolvedValue({
      messages: [
        {id: 'm1', author: 'uid-abc', title: 'Тест'},
      ],
    });

    await service.loadMessages(account);

    const messages = (fp.setMessages as jest.Mock).mock.calls[0][1];
    expect(messages[0].author).toBe('Тестовый Пользователь');
  });

  it('очищает системный GUID и пустых авторов в пустую строку', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({
      messages: [
        {id: 'm1', author: '00000000-0000-0000-0000-000000000000', title: 'Системное'},
        {id: 'm2', title: 'Без автора'},
        {id: 'm3', author: 'uid-real', title: 'Настоящее'},
      ],
    });

    await service.loadMessages(account);

    const messages = (fp.setMessages as jest.Mock).mock.calls[0][1];
    expect(messages[0].author).toBe('');
    expect(messages[1].author).toBe('');
    expect(messages[2].author).toBe('uid-real');
  });

  it('передаёт account и offset без ctx', async () => {
    const account = makeAccount();
    mockedFeedMessages.mockResolvedValue({messages: [{id: 'm1'}]});

    await service.loadMessages(account, 5);

    expect(mockedFeedMessages).toHaveBeenCalledWith(account, 5);
    expect(fp.setMessages).toHaveBeenCalledWith('acc-1', expect.any(Array), true);
  });
});

// ---------------------------------------------------------------------------
// FeedService — loadChannels
// ---------------------------------------------------------------------------
describe('FeedService — loadChannels', () => {
  let fp: FeedPersistence;
  let service: FeedService;

  beforeEach(() => {
    jest.clearAllMocks();
    fp = makeFeedPersistence();
    service = new FeedService(fp, makeAccountPersistence());
  });

  it('успешная загрузка каналов', async () => {
    mockedFeedChannels.mockResolvedValue({
      channels: [{id: 'ch-1', name: 'Общий'}],
    });

    const result = await service.loadChannels(makeAccount());

    expect(result.ok).toBe(true);
    expect(fp.setChannels).toHaveBeenCalled();
    const channels = (fp.setChannels as jest.Mock).mock.calls[0][1];
    expect(channels[0].id).toBe('ch-1');
    expect(channels[0].name).toBe('Общий');
  });

  it('ошибка при загрузке каналов', async () => {
    mockedFeedChannels.mockRejectedValue(new Error('fail'));

    const result = await service.loadChannels(makeAccount());

    expect(result.ok).toBe(false);
    expect(result.error).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// FeedService — loadUnread
// ---------------------------------------------------------------------------
describe('FeedService — loadUnread', () => {
  let fp: FeedPersistence;
  let service: FeedService;

  beforeEach(() => {
    jest.clearAllMocks();
    fp = makeFeedPersistence();
    service = new FeedService(fp, makeAccountPersistence());
  });

  it('считает количество непрочитанных', async () => {
    mockedFeedTargetsUnread.mockResolvedValue({
      targets: [{id: '1'}, {id: '2'}, {id: '3'}],
    });

    const result = await service.loadUnread(makeAccount());

    expect(result.ok).toBe(true);
    expect(fp.setUnreadCount).toHaveBeenCalledWith('acc-1', 3);
  });

  it('0 для пустого массива', async () => {
    mockedFeedTargetsUnread.mockResolvedValue({targets: []});

    await service.loadUnread(makeAccount());

    expect(fp.setUnreadCount).toHaveBeenCalledWith('acc-1', 0);
  });

  it('ошибка при загрузке unread', async () => {
    mockedFeedTargetsUnread.mockRejectedValue(new Error('err'));

    const result = await service.loadUnread(makeAccount());

    expect(result.ok).toBe(false);
  });
});
