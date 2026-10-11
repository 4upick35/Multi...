import {useCustomerServiceStore} from '../../src/store/customer-service-store';
import type {CollectionKey} from '../../src/types/customer-service';

beforeEach(() => {
  useCustomerServiceStore.setState({itemsByAccount: {}, syncStates: {}});
});

describe('customer-service-store — clearAccount', () => {
  it('clearAccount удаляет данные аккаунта из itemsByAccount и syncStates', () => {
    const {setItems, setCollectionStatus, getItems, getCollectionStatus} =
      useCustomerServiceStore.getState();

    setItems('acc-1', 'services' as CollectionKey, [{id: '1'} as any]);
    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'ok', total: 5});
    setItems('acc-2', 'services' as CollectionKey, [{id: '2'} as any]);

    useCustomerServiceStore.getState().clearAccount('acc-1');

    expect(getItems('acc-1', 'services' as CollectionKey)).toEqual([]);
    expect(getCollectionStatus('acc-1', 'services' as CollectionKey).status).toBe('idle');
    // Данные другого аккаунта не затронуты
    expect(getItems('acc-2', 'services' as CollectionKey)).toHaveLength(1);
  });

  it('clearAccount на несуществующем аккаунте не падает', () => {
    expect(() =>
      useCustomerServiceStore.getState().clearAccount('nonexistent'),
    ).not.toThrow();
  });
});

describe('customer-service-store — accessDenied', () => {
  it('setCollectionStatus с accessDenied:true сохраняет флаг', () => {
    const {setCollectionStatus, getCollectionStatus} = useCustomerServiceStore.getState();
    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'ok', accessDenied: true});

    const ss = getCollectionStatus('acc-1', 'services' as CollectionKey);
    expect(ss.accessDenied).toBe(true);
    expect(ss.status).toBe('ok');
  });

  it('setCollectionStatus со status:ok сбрасывает accessDenied в false', () => {
    const {setCollectionStatus, getCollectionStatus} = useCustomerServiceStore.getState();
    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'ok', accessDenied: true});
    expect(getCollectionStatus('acc-1', 'services' as CollectionKey).accessDenied).toBe(true);

    // Повторная успешная загрузка — сбрасывает флаг
    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'ok', total: 10});
    const ss = getCollectionStatus('acc-1', 'services' as CollectionKey);
    expect(ss.accessDenied).toBe(false);
    expect(ss.total).toBe(10);
  });

  it('setCollectionStatus со status:error НЕ сбрасывает accessDenied', () => {
    const {setCollectionStatus, getCollectionStatus} = useCustomerServiceStore.getState();
    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'ok', accessDenied: true});

    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'error', error: 'fail'});
    const ss = getCollectionStatus('acc-1', 'services' as CollectionKey);
    expect(ss.accessDenied).toBe(true); // не сброшен, т.к. не ok
  });

  it('setCollectionStatus со status:loading НЕ сбрасывает accessDenied', () => {
    const {setCollectionStatus, getCollectionStatus} = useCustomerServiceStore.getState();
    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'ok', accessDenied: true});

    setCollectionStatus('acc-1', 'services' as CollectionKey, {status: 'loading'});
    const ss = getCollectionStatus('acc-1', 'services' as CollectionKey);
    expect(ss.accessDenied).toBe(true);
  });

  it('getCollectionStatus возвращает idle по умолчанию (без accessDenied)', () => {
    const ss = useCustomerServiceStore.getState().getCollectionStatus('acc-1', 'services' as CollectionKey);
    expect(ss.status).toBe('idle');
    expect(ss.accessDenied).toBeUndefined();
  });
});

describe('customer-service-store — защита от чужого accountId', () => {
  it('setItems отбрасывает элементы с чужим accountId', () => {
    const {setItems, getItems} = useCustomerServiceStore.getState();

    setItems('acc-1', 'services' as CollectionKey, [
      {id: '1', accountId: 'acc-1'} as any,
      {id: '2', accountId: 'acc-2'} as any,
    ]);

    const stored = getItems('acc-1', 'services' as CollectionKey);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('1');
    expect(stored[0].accountId).toBe('acc-1');
  });

  it('appendItems отбрасывает элементы с чужим accountId', () => {
    const {setItems, appendItems, getItems} = useCustomerServiceStore.getState();

    setItems('acc-1', 'services' as CollectionKey, [
      {id: '1', accountId: 'acc-1'} as any,
    ]);
    appendItems('acc-1', 'services' as CollectionKey, [
      {id: '2', accountId: 'acc-2'} as any,
      {id: '3', accountId: 'acc-1'} as any,
    ]);

    const stored = getItems('acc-1', 'services' as CollectionKey);
    expect(stored.map((it) => it.id)).toEqual(['1', '3']);
    expect(stored.every((it) => it.accountId === 'acc-1')).toBe(true);
  });

  it('элементы без accountId сохраняются', () => {
    const {setItems, appendItems, getItems} = useCustomerServiceStore.getState();

    setItems('acc-1', 'services' as CollectionKey, [
      {id: '1'} as any,
      {id: '2', accountId: 'acc-2'} as any,
    ]);
    appendItems('acc-1', 'services' as CollectionKey, [
      {id: '3'} as any,
    ]);

    const stored = getItems('acc-1', 'services' as CollectionKey);
    expect(stored.map((it) => it.id)).toEqual(['1', '3']);
  });
});
