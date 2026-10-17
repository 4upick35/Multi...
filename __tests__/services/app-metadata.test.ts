jest.mock('../../src/services/elma-api', () => ({
  fetchAppMetadata: jest.fn(),
  fetchCollectionItemsByIds: jest.fn(),
  fetchCollectionKeyFields: jest.fn(),
}));

jest.mock('../../src/infrastructure/elma-cache', () => {
  const store = new Map<string, unknown>();
  return {
    cacheGet: jest.fn((_accountId: string, key: string) => store.get(key) as undefined),
    cacheSet: jest.fn((_accountId: string, key: string, value: unknown) => { store.set(key, value); }),
    cacheHas: jest.fn(),
    cacheDelete: jest.fn(),
    cacheClearAccount: jest.fn(() => { store.clear(); }),
    TTL_5MIN_MS: 300000,
    TTL_30MIN_MS: 1800000,
    __store: store,
  };
});

import {
  getStatusMap,
  getFieldCollectionMap,
  resolveStatus,
  extractStatusId,
  isUuidArray,
  resolveRefNames,
} from '../../src/services/app-metadata';
import {
  fetchAppMetadata,
  fetchCollectionItemsByIds,
  fetchCollectionKeyFields,
} from '../../src/services/elma-api';
import type {ElmaAccount} from '../../src/types/account';

const mockedFetchAppMetadata = fetchAppMetadata as jest.MockedFunction<typeof fetchAppMetadata>;
const mockedFetchCollectionItemsByIds = fetchCollectionItemsByIds as jest.MockedFunction<typeof fetchCollectionItemsByIds>;
const mockedFetchCollectionKeyFields = fetchCollectionKeyFields as jest.MockedFunction<typeof fetchCollectionKeyFields>;

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

beforeEach(() => {
  jest.clearAllMocks();
  // По умолчанию keyfields ничего не вернул — resolveRefNames уходит в items/list
  mockedFetchCollectionKeyFields.mockResolvedValue({items: []});
  // Очищаем мок-кэш между тестами
  const store = (jest.requireMock('../../src/infrastructure/elma-cache') as Record<string, unknown>).__store as Map<string, unknown>;
  store.clear();
});

// ---------------------------------------------------------------------------
// extractStatusId
// ---------------------------------------------------------------------------
describe('extractStatusId', () => {
  it('извлекает числовое id из {order:0, status:3}', () => {
    expect(extractStatusId({__status: {order: 0, status: 3}})).toBe(3);
  });

  it('возвращает null если __status — объект без поля status', () => {
    expect(extractStatusId({__status: {name: 'Новая'}})).toBeNull();
  });

  it('возвращает null если __status — строка', () => {
    expect(extractStatusId({__status: 'Новая'})).toBeNull();
  });

  it('возвращает null если __status отсутствует', () => {
    expect(extractStatusId({})).toBeNull();
  });

  it('возвращает числовое id если __status — число', () => {
    expect(extractStatusId({__status: 5})).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// isUuidArray
// ---------------------------------------------------------------------------
describe('isUuidArray', () => {
  it('возвращает true для массива UUID', () => {
    expect(isUuidArray(['019c5190-269a-7b01-9a58-120b2ccd953a'])).toBe(true);
  });

  it('возвращает true для нескольких UUID', () => {
    expect(isUuidArray([
      '019c5190-269a-7b01-9a58-120b2ccd953a',
      '019e8397-2c1e-7b7f-917a-0cb8c0eecdde',
    ])).toBe(true);
  });

  it('возвращает false для пустого массива', () => {
    expect(isUuidArray([])).toBe(false);
  });

  it('возвращает false для массива строк (не UUID)', () => {
    expect(isUuidArray(['hello', 'world'])).toBe(false);
  });

  it('возвращает false для не-массива', () => {
    expect(isUuidArray('019c5190-269a-7b01-9a58-120b2ccd953a')).toBe(false);
    expect(isUuidArray(null)).toBe(false);
    expect(isUuidArray(undefined)).toBe(false);
  });

  it('возвращает false если хотя бы один элемент не UUID', () => {
    expect(isUuidArray(['019c5190-269a-7b01-9a58-120b2ccd953a', 'not-a-uuid'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveStatus
// ---------------------------------------------------------------------------
describe('resolveStatus', () => {
  it('возвращает name и color по id', () => {
    const map = new Map([[3, {name: 'В работе', color: '#FF0000'}]]);
    const result = resolveStatus(3, map);
    expect(result).toEqual({name: 'В работе', color: '#FF0000'});
  });

  it('возвращает null при undefined id', () => {
    const map = new Map([[3, {name: 'В работе', color: ''}]]);
    expect(resolveStatus(undefined, map)).toBeNull();
  });

  it('возвращает null при null id', () => {
    const map = new Map([[3, {name: 'В работе', color: ''}]]);
    expect(resolveStatus(null, map)).toBeNull();
  });

  it('возвращает null если id не найден в маппинге', () => {
    const map = new Map([[3, {name: 'В работе', color: ''}]]);
    expect(resolveStatus(99, map)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getStatusMap
// ---------------------------------------------------------------------------
describe('getStatusMap', () => {
  it('загружает и кэширует маппинг статусов', async () => {
    const account = makeAccount();
    mockedFetchAppMetadata.mockResolvedValue({
      metadata: {
        statuses: [
          {id: 3, code: 'in_progress', name: 'В работе', color: '#FF0000', isFinished: false},
          {id: 4, code: 'completed', name: 'Завершена', color: '#00FF00', isFinished: true},
        ],
      },
    });

    const map = await getStatusMap(account);
    expect(map.size).toBe(2);
    expect(map.get(3)).toEqual({name: 'В работе', color: '#FF0000'});
    expect(map.get(4)).toEqual({name: 'Завершена', color: '#00FF00'});
    expect(mockedFetchAppMetadata).toHaveBeenCalledTimes(1);

    // Второй вызов — из кэша
    const map2 = await getStatusMap(account);
    expect(map2.size).toBe(2);
    expect(mockedFetchAppMetadata).toHaveBeenCalledTimes(1);
  });

  it('возвращает пустой маппинг при ошибке', async () => {
    const account = makeAccount();
    mockedFetchAppMetadata.mockResolvedValue({metadata: null});

    const map = await getStatusMap(account);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getFieldCollectionMap
// ---------------------------------------------------------------------------
describe('getFieldCollectionMap', () => {
  it('загружает маппинг полей SYS_COLLECTION', async () => {
    const account = makeAccount();
    mockedFetchAppMetadata.mockResolvedValue({
      metadata: {
        fields: [
          {code: 'technic', type: 'SYS_COLLECTION', data: {code: 'directory_of_nomenclature', namespace: 'customer_service'}},
          {code: 'subject_of_request', type: 'STRING'},
          {code: 'service', type: 'SYS_COLLECTION', data: {code: 'services', namespace: 'customer_service'}},
        ],
      },
    });

    const map = await getFieldCollectionMap(account);
    expect(map.size).toBe(2);
    expect(map.get('technic')).toEqual({namespace: 'customer_service', code: 'directory_of_nomenclature'});
    expect(map.get('service')).toEqual({namespace: 'customer_service', code: 'services'});
    expect(map.has('subject_of_request')).toBe(false);
  });

  it('возвращает пустой маппинг при ошибке', async () => {
    const account = makeAccount();
    mockedFetchAppMetadata.mockResolvedValue({metadata: null});

    const map = await getFieldCollectionMap(account);
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveRefNames
// ---------------------------------------------------------------------------
describe('resolveRefNames', () => {
  it('резолвит UUID массивы в имена', async () => {
    const account = makeAccount();
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {
      technic: ['019c5190-269a-7b01-9a58-120b2ccd953a'],
    };

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [
        {__id: '019c5190-269a-7b01-9a58-120b2ccd953a', __name: 'Стиральная машина Bosch'},
      ],
    });

    const resolved = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(resolved.size).toBe(1);
    expect(resolved.get('technic')).toBe('Стиральная машина Bosch');
  });

  it('возвращает пустую карту для полей без UUID', async () => {
    const account = makeAccount();
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {
      technic: 'Не включается',
    };

    const resolved = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(resolved.size).toBe(0);
  });

  it('возвращает пустую карту при ошибке запроса', async () => {
    const account = makeAccount();
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {
      technic: ['019c5190-269a-7b01-9a58-120b2ccd953a'],
    };

    mockedFetchCollectionItemsByIds.mockRejectedValue(new Error('Network error'));

    const resolved = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(resolved.size).toBe(0);
  });

  it('группирует UUID по целевым коллекциям', async () => {
    const account = makeAccount();
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
      ['service', {namespace: 'customer_service', code: 'services'}],
    ]);
    const raw = {
      technic: ['019c5190-269a-7b01-9a58-120b2ccd953a'],
      service: ['019e6b99-acb5-7b7c-8279-4e5d3c3236a7'],
    };

    mockedFetchCollectionItemsByIds
      .mockResolvedValueOnce({
        items: [{__id: '019c5190-269a-7b01-9a58-120b2ccd953a', __name: 'Bosch'}],
      })
      .mockResolvedValueOnce({
        items: [{__id: '019e6b99-acb5-7b7c-8279-4e5d3c3236a7', __name: 'Ремонт'}],
      });

    const resolved = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(resolved.size).toBe(2);
    expect(resolved.get('technic')).toBe('Bosch');
    expect(resolved.get('service')).toBe('Ремонт');
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(2);
  });

  it('дедуплицирует UUID при запросе', async () => {
    const account = makeAccount();
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {
      technic: ['019c5190-269a-7b01-9a58-120b2ccd953a', '019c5190-269a-7b01-9a58-120b2ccd953a'],
    };

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [{__id: '019c5190-269a-7b01-9a58-120b2ccd953a', __name: 'Bosch'}],
    });

    const resolved = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(1);
    expect(resolved.get('technic')).toBe('Bosch, Bosch');
  });

  it('повторный resolveRefNames с теми же id не делает нового сетевого запроса', async () => {
    const account = makeAccount();
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {
      technic: ['019c5190-269a-7b01-9a58-120b2ccd953a'],
    };

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [
        {__id: '019c5190-269a-7b01-9a58-120b2ccd953a', __name: 'Стиральная машина Bosch'},
      ],
    });

    const first = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(1);
    expect(first.get('technic')).toBe('Стиральная машина Bosch');

    const second = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(1);
    expect(second.get('technic')).toBe('Стиральная машина Bosch');
  });

  it('частичный ответ keyfields → в items/list уходят только реально недостающие id', async () => {
    const account = makeAccount();
    const idA = '019c5190-269a-7b01-9a58-120b2ccd953a';
    const idB = '019e6b99-acb5-7b7c-8279-4e5d3c3236a7';
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {technic: [idA, idB]};

    mockedFetchCollectionKeyFields.mockResolvedValue({
      items: [{__id: idA, __name: 'Bosch'}],
    });
    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [{__id: idB, __name: 'Indesit'}],
    });

    const resolved = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(resolved.get('technic')).toBe('Bosch, Indesit');
    expect(mockedFetchCollectionKeyFields).toHaveBeenCalledTimes(1);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(1);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledWith(
      account,
      'customer_service',
      'directory_of_nomenclature',
      [idB],
    );
  });

  it('ошибка keyfields → фолбэк в items/list', async () => {
    const account = makeAccount();
    const idA = '019c5190-269a-7b01-9a58-120b2ccd953a';
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {technic: [idA]};

    mockedFetchCollectionKeyFields.mockRejectedValue(new Error('keyfields boom'));
    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [{__id: idA, __name: 'Bosch'}],
    });

    const resolved = await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(resolved.get('technic')).toBe('Bosch');
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledWith(
      account,
      'customer_service',
      'directory_of_nomenclature',
      [idA],
    );
  });

  it('негативный кэш: после первого пустого keyfields повторный вызов не дёргает keyfields', async () => {
    const account = makeAccount();
    const idA = '019c5190-269a-7b01-9a58-120b2ccd953a';
    const fieldMap = new Map([
      ['technic', {namespace: 'customer_service', code: 'directory_of_nomenclature'}],
    ]);
    const raw = {technic: [idA]};

    mockedFetchCollectionKeyFields.mockResolvedValue({items: []});
    mockedFetchCollectionItemsByIds.mockResolvedValue({items: []});

    await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(mockedFetchCollectionKeyFields).toHaveBeenCalledTimes(1);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(1);

    await resolveRefNames(account, raw as Record<string, unknown>, fieldMap);
    expect(mockedFetchCollectionKeyFields).toHaveBeenCalledTimes(1);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(2);
  });
});
