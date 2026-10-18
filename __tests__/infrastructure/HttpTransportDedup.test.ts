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

import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import {clearThrottle} from '../../src/infrastructure/AccountThrottle';

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

function makeMockTransport(): {transport: HttpTransport; mockClient: any} {
  const transport = new HttpTransport();
  const mockClient = {defaults: {headers: {common: {}}}, request: jest.fn()};
  (transport as any).instances = new Map([['acc-1', mockClient]]);
  return {transport, mockClient};
}

beforeEach(() => {
  clearThrottle('acc-1');
  jest.clearAllMocks();
});

afterAll(() => {
  clearThrottle('acc-1');
});

describe('HttpTransport — дедупликация одинаковых in-flight GET', () => {
  it('два параллельных одинаковых GET → один вызов axios', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockResolvedValue({data: {ok: true}, status: 200, headers: {}});

    const [r1, r2] = await Promise.all([
      transport.request(account, 'get', '/api/apps', undefined, {a: 1}),
      transport.request(account, 'get', '/api/apps', undefined, {a: 1}),
    ]);

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(r1.data).toEqual({ok: true});
    expect(r2.data).toEqual({ok: true});
  });

  it('разные params → два вызова axios', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockResolvedValue({data: {}, status: 200, headers: {}});

    await Promise.all([
      transport.request(account, 'get', '/api/apps', undefined, {a: 1}),
      transport.request(account, 'get', '/api/apps', undefined, {a: 2}),
    ]);

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('POST не дедуплицируется — два параллельных одинаковых POST дают два вызова', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockResolvedValue({data: {}, status: 200, headers: {}});

    await Promise.all([
      transport.request(account, 'post', '/api/items', {x: 1}),
      transport.request(account, 'post', '/api/items', {x: 1}),
    ]);

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('после reject карта очищается — следующий GET снова идёт в сеть', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockRejectedValueOnce(new Error('boom'));

    await expect(
      transport.request(account, 'get', '/api/apps', undefined, {a: 1}),
    ).rejects.toThrow('boom');

    mockRequest.mockResolvedValueOnce({data: {ok: true}, status: 200, headers: {}});
    const result = await transport.request(account, 'get', '/api/apps', undefined, {a: 1});

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ok: true});
  });

  it('dedupe=false отключает склейку — два параллельных GET дают два вызова', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockResolvedValue({data: {}, status: 200, headers: {}});

    await Promise.all([
      transport.request(account, 'get', '/api/apps', undefined, {a: 1}, undefined, undefined, undefined, false),
      transport.request(account, 'get', '/api/apps', undefined, {a: 1}, undefined, undefined, undefined, false),
    ]);

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('стабильный ключ: разный порядок ключей params склеивается в один GET', async () => {
    const {transport, mockClient} = makeMockTransport();
    const account = makeAccount();
    const mockRequest = mockClient.request as jest.Mock;
    mockRequest.mockResolvedValue({data: {}, status: 200, headers: {}});

    await Promise.all([
      transport.request(account, 'get', '/api/apps', undefined, {a: 1, b: 2}),
      transport.request(account, 'get', '/api/apps', undefined, {b: 2, a: 1}),
    ]);

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
