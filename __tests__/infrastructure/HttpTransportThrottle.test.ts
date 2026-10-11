jest.mock('../../src/infrastructure/RequestQueue', () => {
  return {
    RequestQueue: class {
      enqueue = jest.fn(async (_, fn) => await fn());
    },
  };
});

jest.mock('axios', () => {
  const actualAxios = jest.requireActual('axios');
  const mockIsAxiosError = jest.fn((err) => err && err._isAxiosError);
  return {
    ...actualAxios,
    create: jest.fn(() => ({
      defaults: {headers: {common: {}}},
      request: jest.fn(),
    })),
    isAxiosError: mockIsAxiosError,
  };
});

import {HttpTransport, TransportThrottleError} from '../../src/infrastructure/HttpTransport';
import {isPaused, clearThrottle, recordThrottleError, getRemainingPauseMs} from '../../src/infrastructure/AccountThrottle';

function makeAccount(overrides: Record<string, unknown> = {}): any {
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

beforeEach(() => {
  clearThrottle('acc-1');
  clearThrottle('acc-2');
  jest.clearAllMocks();
});

afterAll(() => {
  clearThrottle('acc-1');
  clearThrottle('acc-2');
});

describe('HttpTransport — skipThrottle', () => {
  function makeMockTransport(): {transport: HttpTransport; mockClient: any} {
    const transport = new HttpTransport();
    const mockClient = {defaults: {headers: {common: {}}}, request: jest.fn()};
    (transport as any).instances = new Map([['acc-1', mockClient]]);
    return {transport, mockClient};
  }

  const makeAxiosError = (status: number) => ({response: {status}, _isAxiosError: true, isAxiosError: () => true});

  it('403 на неавторизационном запросе НЕ ставит паузу, ошибка проходит как обычная', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockRejectedValue(makeAxiosError(403));

    await expect(transport.request(account, 'get', '/api/tasks')).rejects.toBeDefined();
    expect(isPaused('acc-1')).toBe(false);
  });

  it('412 на неавторизационном запросе НЕ ставит паузу, ошибка проходит как обычная', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockRejectedValue(makeAxiosError(412));

    await expect(transport.request(account, 'get', '/api/tasks')).rejects.toBeDefined();
    expect(isPaused('acc-1')).toBe(false);
  });

  it('после паузы запросы отклоняются TransportThrottleError(429)', async () => {
    const {transport} = makeMockTransport();
    const account = makeAccount();
    recordThrottleError('acc-1');
    expect(isPaused('acc-1')).toBe(true);

    await expect(transport.request(account, 'get', '/api/tasks')).rejects.toThrow(TransportThrottleError);
  });

  it('403 на /guard/login НЕ ставит паузу при skipThrottle=true', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockRejectedValue(makeAxiosError(403));

    await expect(transport.request(account, 'post', '/guard/login', undefined, undefined, undefined, true)).rejects.toBeDefined();
    expect(isPaused('acc-1')).toBe(false);
  });

  it('429 на неавторизационном запросе ставит паузу с remaining > 0', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockRejectedValue(makeAxiosError(429));

    await expect(transport.request(account, 'get', '/api/tasks')).rejects.toThrow(TransportThrottleError);
    expect(isPaused('acc-1')).toBe(true);
    expect(getRemainingPauseMs('acc-1')).toBeGreaterThan(0);
  });

  it('503 ставит паузу с remaining > 0', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockRejectedValue(makeAxiosError(503));

    await expect(transport.request(account, 'get', '/api/tasks')).rejects.toThrow(TransportThrottleError);
    expect(isPaused('acc-1')).toBe(true);
    expect(getRemainingPauseMs('acc-1')).toBeGreaterThan(0);
  });

  it('успешный запрос сбрасывает троттл', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockResolvedValue({data: {}, status: 200, headers: {}});

    const result = await transport.request(account, 'get', '/api/tasks');
    expect(result.data).toBeDefined();
    expect(isPaused('acc-1')).toBe(false);
  });

  it('403 на /api/auth НЕ ставит паузу при skipThrottle', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockRejectedValue(makeAxiosError(403));

    await expect(transport.request(account, 'get', '/api/auth', undefined, undefined, undefined, true)).rejects.toBeDefined();
    expect(isPaused('acc-1')).toBe(false);
  });
});

describe('HttpTransport — soft throttle for 403/412', () => {
  function makeMockTransport(): {transport: HttpTransport; mockClient: any} {
    const transport = new HttpTransport();
    const mockClient = {defaults: {headers: {common: {}}}, request: jest.fn()};
    (transport as any).instances = new Map([['acc-1', mockClient]]);
    return {transport, mockClient};
  }

  const makeAxiosError = (status: number) => ({response: {status}, _isAxiosError: true, isAxiosError: () => true});

  it('5 разных 403 за 30 с → пауза 30 с', async () => {
    jest.useFakeTimers();
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;

    const urls = ['/api/pages/1', '/api/pages/2', '/api/pages/3', '/api/settings', '/api/feedHidden'];
    for (const url of urls) {
      mockRequest.mockRejectedValue(makeAxiosError(403));
      try { await transport.request(account, 'get', url); } catch {}
    }

    expect(isPaused('acc-1')).toBe(true);
    const remaining = getRemainingPauseMs('acc-1');
    expect(remaining).toBeGreaterThanOrEqual(29000);
    expect(remaining).toBeLessThanOrEqual(31000);
    jest.useRealTimers();
  });
});
