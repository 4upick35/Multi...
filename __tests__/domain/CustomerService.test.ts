jest.mock('../../src/services/elma-api', () => ({
  fetchCollectionItems: jest.fn(),
  searchWorkerQuery: jest.fn(),
  fetchWorkCalendar: jest.fn(),
  isPortalCustomerServiceAvailable: jest.fn(),
}));

jest.mock('../../src/services/app-metadata', () => ({
  getStatusMap: jest.fn().mockResolvedValue(new Map()),
  extractStatusId: jest.fn(),
  resolveStatus: jest.fn(),
}));

import {CustomerService} from '../../src/domain/CustomerService';
import {
  fetchCollectionItems as apiFetchCollectionItems,
  searchWorkerQuery,
  isPortalCustomerServiceAvailable,
} from '../../src/services/elma-api';
import {ElmaRequestError} from '../../src/types/errors';
import type {CustomerServicePersistence, AccountPersistence} from '../../src/interfaces/persistence';
import type {ElmaAccount} from '../../src/types/account';
import type {CollectionKey} from '../../src/types/customer-service';

const mockedFetchCollectionItems = apiFetchCollectionItems as jest.MockedFunction<typeof apiFetchCollectionItems>;
const mockedSearchWorkerQuery = searchWorkerQuery as jest.MockedFunction<typeof searchWorkerQuery>;
const mockedIsPortalAvailable = isPortalCustomerServiceAvailable as jest.MockedFunction<typeof isPortalCustomerServiceAvailable>;

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

function makeCSPersistence(): CustomerServicePersistence {
  return {
    setItems: jest.fn(),
    appendItems: jest.fn(),
    getItems: jest.fn().mockReturnValue([]),
    setCollectionStatus: jest.fn(),
  };
}

function makeAccountPersistence(): AccountPersistence {
  return {
    updateAccount: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// CustomerService — loadCollectionPage (пагинация)
// ---------------------------------------------------------------------------
describe('CustomerService — loadCollectionPage', () => {
  let csp: CustomerServicePersistence;
  let ap: AccountPersistence;
  let service: CustomerService;

  beforeEach(() => {
    jest.clearAllMocks();
    csp = makeCSPersistence();
    ap = makeAccountPersistence();
    service = new CustomerService(csp, ap);
  });

  it('worker/query коллекция: загружает страницу через searchWorkerQuery', async () => {
    const account = makeAccount();
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedSearchWorkerQuery.mockResolvedValue({
      items: [{__id: 'item-1', __name: 'Запись 1'}],
      total: 100,
    });

    const result = await service.loadCollectionPage(account, 'services' as CollectionKey, 0);

    expect(result.ok).toBe(true);
    expect(mockedSearchWorkerQuery).toHaveBeenCalled();
    expect(csp.appendItems).toHaveBeenCalled();
    expect(csp.setCollectionStatus).toHaveBeenCalledWith('acc-1', 'services', expect.objectContaining({
      status: 'ok',
      total: 100,
    }));
  });

  it('items/list коллекция: загружает через fetchCollectionItems', async () => {
    const account = makeAccount();
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockResolvedValue({
      items: [{__id: 'item-1', __name: 'Запись 1'}],
      total: 50,
    });

    const result = await service.loadCollectionPage(account, 'appeals' as CollectionKey, 0);

    expect(result.ok).toBe(true);
    expect(mockedFetchCollectionItems).toHaveBeenCalled();
    expect(csp.appendItems).toHaveBeenCalled();
  });

  it('когда isPortalCustomerServiceAvailable = false → возвращает ok', async () => {
    mockedIsPortalAvailable.mockResolvedValue(false);

    const result = await service.loadCollectionPage(makeAccount(), 'services' as CollectionKey, 0);

    expect(result.ok).toBe(true);
    expect(mockedSearchWorkerQuery).not.toHaveBeenCalled();
  });

  it('обрабатывает ошибку → возвращает ok:false', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockRejectedValue(new Error('Server error'));

    const result = await service.loadCollectionPage(makeAccount(), 'applications' as CollectionKey, 0);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Server error');
  });

  it('403/Unauthorized → возвращает ok:true с accessDenied', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockRejectedValue(
      new ElmaRequestError('unauthorized', 'Forbidden', 403),
    );

    const result = await service.loadCollectionPage(makeAccount(), 'applications' as CollectionKey, 0);

    expect(result.ok).toBe(false);
    expect(csp.setCollectionStatus).toHaveBeenCalledWith('acc-1', 'applications', expect.objectContaining({
      status: 'ok',
      accessDenied: true,
    }));
  });

  it('403 при непустом кэше → status:error (не accessDenied)', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    (csp.getItems as jest.Mock).mockReturnValue([{id: '1', name: 'Item'}]);
    mockedFetchCollectionItems.mockRejectedValue(
      new ElmaRequestError('unauthorized', 'Forbidden', 403),
    );

    const result = await service.loadCollectionPage(makeAccount(), 'applications' as CollectionKey, 0);

    expect(result.ok).toBe(false);
    expect(csp.setCollectionStatus).toHaveBeenCalledWith('acc-1', 'applications', expect.objectContaining({
      status: 'error',
    }));
    expect(csp.setCollectionStatus).not.toHaveBeenCalledWith('acc-1', 'applications', expect.objectContaining({
      accessDenied: true,
    }));
  });
});

// ---------------------------------------------------------------------------
// CustomerService — searchCollection
// ---------------------------------------------------------------------------
describe('CustomerService — searchCollection', () => {
  let csp: CustomerServicePersistence;
  let service: CustomerService;

  beforeEach(() => {
    jest.clearAllMocks();
    csp = makeCSPersistence();
    service = new CustomerService(csp, makeAccountPersistence());
  });

  it('поиск по worker/query коллекции через searchWorkerQuery', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedSearchWorkerQuery.mockResolvedValue({
      items: [{__id: 's1', __name: 'Результат'}],
    });

    const result = await service.searchCollection(makeAccount(), 'services' as CollectionKey, 'query');

    expect(result.ok).toBe(true);
    expect(mockedSearchWorkerQuery).toHaveBeenCalled();
    expect(csp.setItems).toHaveBeenCalled();
  });

  it('поиск по items/list коллекции через fetchCollectionItems', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockResolvedValue({
      items: [{__id: 'a1', __name: 'Новость'}],
    });

    const result = await service.searchCollection(makeAccount(), 'articles' as CollectionKey, 'test');

    expect(result.ok).toBe(true);
    expect(mockedFetchCollectionItems).toHaveBeenCalled();
    expect(csp.setItems).toHaveBeenCalled();
  });

  it('когда csAvailable = false → setItems([], ok)', async () => {
    mockedIsPortalAvailable.mockResolvedValue(false);

    const result = await service.searchCollection(makeAccount(), 'applications' as CollectionKey, 'test');

    expect(result.ok).toBe(true);
    expect(csp.setItems).not.toHaveBeenCalled();
  });

  it('ошибка при поиске → ok:false', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedSearchWorkerQuery.mockRejectedValue(new Error('Search error'));

    const result = await service.searchCollection(makeAccount(), 'services' as CollectionKey, 'q');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Search error');
  });

  it('403 при поиске → ok:true с accessDenied', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedSearchWorkerQuery.mockRejectedValue(
      new ElmaRequestError('unauthorized', 'Forbidden', 403),
    );

    const result = await service.searchCollection(makeAccount(), 'services' as CollectionKey, 'q');

    expect(result.ok).toBe(false);
    expect(csp.setItems).not.toHaveBeenCalled();
    expect(csp.setCollectionStatus).toHaveBeenCalledWith('acc-1', 'services', expect.objectContaining({
      status: 'ok',
      accessDenied: true,
    }));
  });

  it('пустой текст поиска не добавляет tf-фильтр', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedSearchWorkerQuery.mockResolvedValue({items: []});

    await service.searchCollection(makeAccount(), 'services' as CollectionKey, '');

    const callArgs = mockedSearchWorkerQuery.mock.calls[0][2];
    // при пустом поиске — tf фильтра не должно быть
    expect(JSON.stringify(callArgs?.filter)).not.toContain('"tf"');
  });
});

// ---------------------------------------------------------------------------
// CustomerService — loadCollection
// ---------------------------------------------------------------------------
describe('CustomerService — loadCollection', () => {
  let csp: CustomerServicePersistence;
  let service: CustomerService;

  beforeEach(() => {
    jest.clearAllMocks();
    csp = makeCSPersistence();
    service = new CustomerService(csp, makeAccountPersistence());
  });

  it('articles коллекция: специальный фильтр с public_article', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockResolvedValue({
      items: [{__id: 'art-1', __name: 'Статья'}],
      total: 1,
    });

    const result = await service.loadCollection(makeAccount(), 'articles');

    expect(result.ok).toBe(true);
    expect(mockedFetchCollectionItems).toHaveBeenCalledWith(
      expect.anything(),
      'articles',
      expect.objectContaining({
        filter: expect.objectContaining({
          and: expect.arrayContaining([
            expect.objectContaining({
              eq: expect.arrayContaining([expect.objectContaining({field: 'public_article'})]),
            }),
          ]),
        }),
      }),
    );
  });

  it('news коллекция: worker/query с фильтром published', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedSearchWorkerQuery.mockResolvedValue({
      items: [{__id: 'news-1', __name: 'Новость'}],
      total: 1,
    });

    const result = await service.loadCollection(makeAccount(), 'news');

    expect(result.ok).toBe(true);
    expect(mockedSearchWorkerQuery).toHaveBeenCalled();
  });

  it('isPortalCustomerServiceAvailable = false → setItems([], ok)', async () => {
    mockedIsPortalAvailable.mockResolvedValue(false);

    const result = await service.loadCollection(makeAccount(), 'applications');

    expect(result.ok).toBe(true);
    expect(csp.setItems).not.toHaveBeenCalled();
  });

  it('обрабатывает ошибку → status:error', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockRejectedValue(new Error('fail'));

    const result = await service.loadCollection(makeAccount(), 'applications');

    expect(result.ok).toBe(false);
    expect(csp.setCollectionStatus).toHaveBeenCalledWith('acc-1', 'applications', expect.objectContaining({
      status: 'error',
    }));
  });

  it('403 ошибка → ok:true с accessDenied', async () => {
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockRejectedValue(
      new ElmaRequestError('unauthorized', 'Forbidden', 403),
    );

    const result = await service.loadCollection(makeAccount(), 'applications');

    expect(result.ok).toBe(false);
    expect(csp.setItems).not.toHaveBeenCalled();
    expect(csp.setCollectionStatus).toHaveBeenCalledWith('acc-1', 'applications', expect.objectContaining({
      status: 'ok',
      accessDenied: true,
    }));
  });

  it('пустой ответ при непустом кэше НЕ стирает данные в пределах 10 минут', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockResolvedValue({items: [], total: 0});

    // Реальный «хранилище» кэша: персистентность мокается, но setItems/getItems
    // связаны между собой, чтобы было видно, стёрлись данные или нет.
    const store: Record<string, Record<string, unknown>[]> = {
      'acc-1::applications': [{__id: 'app-1', __name: 'Заявка'}],
    };
    (csp.getItems as jest.Mock).mockImplementation(
      (accountId: string, collection: string) => store[accountId + '::' + collection] ?? [],
    );
    (csp.setItems as jest.Mock).mockImplementation(
      (accountId: string, collection: string, items: Record<string, unknown>[]) => {
        store[accountId + '::' + collection] = items;
      },
    );

    try {
      // 3 подряд пустых ответа с интервалом 1 минута — бан ещё длится.
      for (let i = 1; i <= 3; i++) {
        now.mockReturnValue(1_000_000 + i * 60_000);
        const result = await service.loadCollection(makeAccount(), 'applications');
        expect(result).toEqual({ok: false, error: 'empty-response', kind: 'other'});
      }
    } finally {
      now.mockRestore();
    }

    expect(csp.setItems).not.toHaveBeenCalled();
    expect(csp.getItems('acc-1', 'applications')).toEqual([
      {__id: 'app-1', __name: 'Заявка'},
    ]);
  });

  it('пустой ответ принимается, если серия длится больше 10 минут', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
    mockedIsPortalAvailable.mockResolvedValue(true);
    mockedFetchCollectionItems.mockResolvedValue({items: [], total: 0});

    const store: Record<string, Record<string, unknown>[]> = {
      'acc-1::applications': [{__id: 'app-1', __name: 'Заявка'}],
    };
    (csp.getItems as jest.Mock).mockImplementation(
      (accountId: string, collection: string) => store[accountId + '::' + collection] ?? [],
    );
    (csp.setItems as jest.Mock).mockImplementation(
      (accountId: string, collection: string, items: Record<string, unknown>[]) => {
        store[accountId + '::' + collection] = items;
      },
    );

    try {
      const first = await service.loadCollection(makeAccount(), 'applications');
      expect(first).toEqual({ok: false, error: 'empty-response', kind: 'other'});

      now.mockReturnValue(2_000_000 + 11 * 60_000);
      const second = await service.loadCollection(makeAccount(), 'applications');
      expect(second).toEqual({ok: true});
    } finally {
      now.mockRestore();
    }

    expect(csp.setItems).toHaveBeenCalledWith('acc-1', 'applications', []);
    expect(csp.getItems('acc-1', 'applications')).toEqual([]);
  });
});

describe('CustomerService — markApplicationAccepted', () => {
  it('меняет статус на «Принято» и убирает кнопку приёма', () => {
    const csp = makeCSPersistence();
    const service = new CustomerService(csp, makeAccountPersistence());
    (csp.getItems as jest.Mock).mockReturnValue([
      {id: 'app-1', name: 'Заявка', status: 'Новая', accountId: 'acc-1', raw: {__id: 'app-1', show_button_get_application: true, __status: {status: 1}}},
      {id: 'app-2', name: 'Другая', status: 'Новая', accountId: 'acc-1', raw: {__id: 'app-2'}},
    ]);

    service.markApplicationAccepted('acc-1', 'app-1');

    expect(csp.setItems).toHaveBeenCalledTimes(1);
    const call = (csp.setItems as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('acc-1');
    expect(call[1]).toBe('applications');
    expect(call[2][0].status).toBe('Принято');
    expect(call[2][0].raw.show_button_get_application).toBe(false);
    expect(call[2][0].raw.__status).toEqual({status: 2, name: 'Принято'});
    expect(call[2][1].raw).toEqual({__id: 'app-2'});
  });

  it('ничего не делает, если заявки нет в кэше', () => {
    const csp = makeCSPersistence();
    const service = new CustomerService(csp, makeAccountPersistence());
    (csp.getItems as jest.Mock).mockReturnValue([
      {id: 'app-2', name: 'Другая', status: 'Новая', accountId: 'acc-1', raw: {__id: 'app-2'}},
    ]);

    service.markApplicationAccepted('acc-1', 'missing');

    expect(csp.setItems).not.toHaveBeenCalled();
  });
});
