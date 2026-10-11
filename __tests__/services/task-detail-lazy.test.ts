/**
 * Tests for TTL caching in elma-api.ts.
 * Verifies cache for getTaskExits, fetchItemsLinked, searchWorkerQuery,
 * and batch resolve via fetchExecutorsByIds.
 */

jest.mock('../../src/infrastructure/HttpTransport', () => ({
  HttpTransport: jest.fn().mockImplementation(() => ({
    request: jest.fn(),
    clearClient: jest.fn(),
  })),
}));

import {HttpTransport} from '../../src/infrastructure/HttpTransport';
import {
  getTaskExits,
  fetchTaskExitsNormalized,
  fetchItemsLinked,
  searchWorkerQuery,
  resolveUserNames,
} from '../../src/services/elma-api';
import {cacheClearAccount} from '../../src/infrastructure/elma-cache';

const mockRequest = (HttpTransport as unknown as jest.Mock).mock.results[0].value
  .request as jest.Mock;

const account = {
  id: 'test-acc-1',
  userId: 'user-1',
  name: 'Test Account',
  baseUrl: 'https://example.com',
  token: 'token-1',
  cookies: '',
} as any;

beforeEach(() => {
  cacheClearAccount('test-acc-1');
  mockRequest.mockClear();
});

describe('elma-api — кэширование', () => {
  describe('getTaskExits', () => {
    it('первый вызов выполняет HTTP', async () => {
      mockRequest.mockResolvedValue({data: [{id: 'e1', key: 'submit'}]});
      await getTaskExits(account, 'task-1');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('второй вызов для той же задачи использует кэш', async () => {
      mockRequest.mockResolvedValue({data: [{id: 'e1', key: 'submit'}]});
      await getTaskExits(account, 'task-1');
      await getTaskExits(account, 'task-1');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchTaskExitsNormalized', () => {
    it('кэширует результат — второй вызов без HTTP', async () => {
      mockRequest.mockResolvedValue({data: [{id: 'e1', key: 'submit'}]});
      const r1 = await fetchTaskExitsNormalized(account, 'task-1');
      const r2 = await fetchTaskExitsNormalized(account, 'task-1');
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(r2);
    });

    it('пустой список не кэшируется — повторный вызов идёт в HTTP', async () => {
      mockRequest.mockResolvedValue({data: []});
      const r1 = await fetchTaskExitsNormalized(account, 'task-empty-1');
      const r2 = await fetchTaskExitsNormalized(account, 'task-empty-1');
      expect(r1).toEqual([]);
      expect(r2).toEqual([]);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('ошибка загрузки → пустой массив вместо фиктивных выходов', async () => {
      mockRequest.mockRejectedValue(new Error('network down'));
      const r = await fetchTaskExitsNormalized(account, 'task-error-1');
      expect(r).toEqual([]);
    });
  });

  describe('fetchItemsLinked', () => {
    it('первый вызов выполняет HTTP', async () => {
      mockRequest.mockResolvedValue({data: {result: []}});
      await fetchItemsLinked(account, 'parent-1');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('повторный вызов использует кэш', async () => {
      mockRequest.mockResolvedValue({data: {result: []}});
      await fetchItemsLinked(account, 'parent-1');
      await fetchItemsLinked(account, 'parent-1');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('searchWorkerQuery', () => {
    it('первый вызов выполняет HTTP', async () => {
      mockRequest.mockResolvedValue({data: {result: []}});
      await searchWorkerQuery(account, 'applications', {filter: {and: []}});
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('повторный вызов с теми же параметрами использует кэш', async () => {
      mockRequest.mockResolvedValue({data: {result: []}});
      await searchWorkerQuery(account, 'applications', {filter: {and: []}});
      await searchWorkerQuery(account, 'applications', {filter: {and: []}});
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveUserNames — батчинг', () => {
    it('использует fetchExecutorsByIds для батча', async () => {
      mockRequest.mockResolvedValue({data: [{__id: 'u1', __name: 'User One'}]});
      await resolveUserNames(account, ['u1', 'u2']);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      const callArgs = mockRequest.mock.calls[0];
      // callArgs = [account, method, url, data, params, headers]
      expect(callArgs[1]).toBe('put');
      expect(callArgs[2]).toContain('/executors/by_ids');
    });
  });
});
