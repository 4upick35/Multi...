import {useFeedStore} from '../../src/store/feed-store';

beforeEach(() => {
  useFeedStore.setState({
    messagesByAccount: {},
    channelsByAccount: {},
    unreadCountByAccount: {},
    loadingByAccount: {},
    errorByAccount: {},
    offsetByAccount: {},
    hasMoreByAccount: {},
  });
});

describe('feed-store — clearAccount', () => {
  it('clearAccount удаляет все данные аккаунта', () => {
    const {setMessages, setChannels, setUnreadCount, setLoading, setError, setOffset, setHasMore, getMessages} =
      useFeedStore.getState();

    setMessages('acc-1', [{id: '1'} as any], false);
    setChannels('acc-1', [{id: 'ch1'} as any]);
    setUnreadCount('acc-1', 5);
    setLoading('acc-1', true);
    setError('acc-1', 'err');
    setOffset('acc-1', 10);
    setHasMore('acc-1', true);

    setMessages('acc-2', [{id: '2'} as any], false);

    useFeedStore.getState().clearAccount('acc-1');

    expect(getMessages('acc-1')).toEqual([]);
    expect(useFeedStore.getState().channelsByAccount['acc-1']).toBeUndefined();
    expect(useFeedStore.getState().unreadCountByAccount['acc-1']).toBeUndefined();
    expect(useFeedStore.getState().loadingByAccount['acc-1']).toBeUndefined();
    expect(useFeedStore.getState().errorByAccount['acc-1']).toBeUndefined();
    expect(useFeedStore.getState().offsetByAccount['acc-1']).toBeUndefined();
    expect(useFeedStore.getState().hasMoreByAccount['acc-1']).toBeUndefined();

    // Данные другого аккаунта не затронуты
    expect(getMessages('acc-2')).toHaveLength(1);
  });

  it('clearAccount на несуществующем аккаунте не падает', () => {
    expect(() => useFeedStore.getState().clearAccount('nonexistent')).not.toThrow();
  });
});
