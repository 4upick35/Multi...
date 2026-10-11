jest.mock('../../src/services/elma-api', () => ({
  fetchAppMetadata: jest.fn(),
  fetchCollectionItemsByIds: jest.fn(),
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

import {resolveRefNames, FieldCollectionTarget} from '../../src/services/app-metadata';
import {fetchCollectionItemsByIds} from '../../src/services/elma-api';
import {getExtraFields} from '../../src/utils/collection-fields';
import type {ElmaAccount} from '../../src/types/account';

const mockedFetchCollectionItemsByIds =
  fetchCollectionItemsByIds as jest.MockedFunction<typeof fetchCollectionItemsByIds>;

const SERVICE_ID = '019e6b99-acb5-7b7c-8279-4e5d3c3236a7';
const SERVICE_ID_2 = '019c5190-269a-7b01-9a58-120b2ccd953a';

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

function serviceFieldMap(): Map<string, FieldCollectionTarget> {
  return new Map([
    ['service', {namespace: 'customer_service', code: 'services'}],
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  const store = (jest.requireMock('../../src/infrastructure/elma-cache') as Record<string, unknown>)
    .__store as Map<string, unknown>;
  store.clear();
});

// ---------------------------------------------------------------------------
// Одиночная ссылка (строка-UUID)
// ---------------------------------------------------------------------------
describe('resolveRefNames: одиночная ссылка', () => {
  it('резолвит одиночную строку-UUID в имя', async () => {
    const account = makeAccount();
    const raw = {service: SERVICE_ID};

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [{__id: SERVICE_ID, __name: 'Ремонт СМА'}],
    });

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    expect(resolved.size).toBe(1);
    expect(resolved.get('service')).toBe('Ремонт СМА');
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledWith(
      account,
      'customer_service',
      'services',
      [SERVICE_ID],
    );
  });

  it('поле «Услуга» попадает в карточку через getExtraFields', async () => {
    const account = makeAccount();
    const raw = {service: SERVICE_ID};

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [{__id: SERVICE_ID, __name: 'Ремонт СМА'}],
    });

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    const fields = getExtraFields(raw, resolved, 'applications');
    expect(fields).toContainEqual({label: 'Услуга', value: 'Ремонт СМА'});
  });

  it('id не найден → запись не добавляется (поле скрыто)', async () => {
    const account = makeAccount();
    const raw = {service: SERVICE_ID};

    mockedFetchCollectionItemsByIds.mockResolvedValue({items: []});

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    expect(resolved.has('service')).toBe(false);

    const fields = getExtraFields(raw, resolved, 'applications');
    expect(fields).not.toContainEqual({label: 'Услуга', value: expect.anything()});
    expect(fields.find(f => f.label === 'Услуга')).toBeUndefined();
  });

  it('не-UUID строка не запрашивается и не резолвится', async () => {
    const account = makeAccount();
    const raw = {service: 'Ремонт СМА'};

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    expect(resolved.size).toBe(0);
    expect(mockedFetchCollectionItemsByIds).not.toHaveBeenCalled();
  });

  it('ошибка запроса → одиночная ссылка остаётся нерезолвнутой', async () => {
    const account = makeAccount();
    const raw = {service: SERVICE_ID};

    mockedFetchCollectionItemsByIds.mockRejectedValue(new Error('Network error'));

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    expect(resolved.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Массив UUID — прежнее поведение
// ---------------------------------------------------------------------------
describe('resolveRefNames: массив UUID', () => {
  it('резолвит массив и склеивает имена через ", "', async () => {
    const account = makeAccount();
    const raw = {service: [SERVICE_ID, SERVICE_ID_2]};

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [
        {__id: SERVICE_ID, __name: 'Ремонт СМА'},
        {__id: SERVICE_ID_2, __name: 'Диагностика'},
      ],
    });

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    expect(resolved.size).toBe(1);
    expect(resolved.get('service')).toBe('Ремонт СМА, Диагностика');
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(1);
  });

  it('часть id не найдена → выводятся только найденные', async () => {
    const account = makeAccount();
    const raw = {service: [SERVICE_ID, SERVICE_ID_2]};

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [{__id: SERVICE_ID, __name: 'Ремонт СМА'}],
    });

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    expect(resolved.get('service')).toBe('Ремонт СМА');
  });

  it('ни один id не найден → запись не добавляется', async () => {
    const account = makeAccount();
    const raw = {service: [SERVICE_ID, SERVICE_ID_2]};

    mockedFetchCollectionItemsByIds.mockResolvedValue({items: []});

    const resolved = await resolveRefNames(account, raw, serviceFieldMap());
    expect(resolved.has('service')).toBe(false);
  });

  it('одиночная и массивовая ссылки в одной коллекции запрашиваются одним вызовом', async () => {
    const account = makeAccount();
    const fieldMap = new Map<string, FieldCollectionTarget>([
      ['service', {namespace: 'customer_service', code: 'services'}],
      ['contract', {namespace: 'customer_service', code: 'services'}],
    ]);
    const raw = {
      service: SERVICE_ID,
      contract: [SERVICE_ID_2],
    };

    mockedFetchCollectionItemsByIds.mockResolvedValue({
      items: [
        {__id: SERVICE_ID, __name: 'Ремонт СМА'},
        {__id: SERVICE_ID_2, __name: 'Договор №12'},
      ],
    });

    const resolved = await resolveRefNames(account, raw, fieldMap);
    expect(mockedFetchCollectionItemsByIds).toHaveBeenCalledTimes(1);
    expect(resolved.get('service')).toBe('Ремонт СМА');
    expect(resolved.get('contract')).toBe('Договор №12');
  });
});
