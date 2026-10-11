/**
 * useApplicationsSync: тап по уведомлению/виджету (событие multiElmaNavigate,
 * onOverlayNavigation) принудительно обновляет список заявок и поднимает
 * realtime-сокеты — без троттла 5 с, который действует на возврат в приложение.
 *
 * Сторы/сервисы/нативный модуль мокаем, чтобы не тянуть React-контекст приложения.
 */
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {useApplicationsSync} from '../../src/hooks/useApplicationsSync';

const mockAccounts = [{id: 'acc-1'}];
const mockSettingsState = {syncPaused: false};
const mockNavigationListeners = new Set<(nav: unknown) => void>();

jest.mock('../../src/store/auth-store', () => ({
  useAuthStore: (selector: (state: {accounts: unknown}) => unknown) =>
    selector({accounts: mockAccounts}),
}));

jest.mock('../../src/store/settings-store', () => ({
  useSettingsStore: Object.assign(
    (selector: (state: {syncPaused: boolean}) => unknown) => selector(mockSettingsState),
    {getState: () => mockSettingsState},
  ),
}));

jest.mock('../../src/services/applications-sync', () => ({
  startApplicationsSync: jest.fn(),
  stopApplicationsSync: jest.fn(),
  refreshApplicationsNow: jest.fn(() => Promise.resolve()),
  isApplicationsSyncRunning: jest.fn(() => true),
}));

jest.mock('../../src/services/realtime', () => ({
  syncRealtimeAccounts: jest.fn(),
  stopAllRealtime: jest.fn(),
  ensureRealtimeAlive: jest.fn(),
}));

jest.mock('../../src/native/KeepAlive', () => ({
  onOverlayNavigation: jest.fn((cb: (nav: unknown) => void) => {
    mockNavigationListeners.add(cb);
    return () => {
      mockNavigationListeners.delete(cb);
    };
  }),
}));

import {refreshApplicationsNow} from '../../src/services/applications-sync';
import {ensureRealtimeAlive} from '../../src/services/realtime';
import {onOverlayNavigation} from '../../src/native/KeepAlive';

const refreshMock = refreshApplicationsNow as jest.MockedFunction<
  typeof refreshApplicationsNow
>;
const realtimeMock = {
  ensureRealtimeAlive: ensureRealtimeAlive as jest.MockedFunction<typeof ensureRealtimeAlive>,
};
const navigationMock = onOverlayNavigation as jest.MockedFunction<typeof onOverlayNavigation>;

function Probe(): null {
  useApplicationsSync();
  return null;
}

let root: renderer.ReactTestRenderer | null = null;

async function mount(): Promise<void> {
  await act(async () => {
    root = renderer.create(React.createElement(Probe));
  });
}

async function unmount(): Promise<void> {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
}

/** Эмуляция тапа по уведомлению/виджету (натив шлёт multiElmaNavigate). */
async function tapNotification(): Promise<void> {
  await act(async () => {
    mockNavigationListeners.forEach(listener => listener({target: 'applications'}));
  });
}

beforeEach(async () => {
  await unmount();
  jest.clearAllMocks();
  mockNavigationListeners.clear();
  mockSettingsState.syncPaused = false;
});

afterEach(async () => {
  await unmount();
});

describe('подписка на onOverlayNavigation', () => {
  it('подписывается при монтировании', async () => {
    await mount();

    expect(navigationMock).toHaveBeenCalledTimes(1);
    expect(mockNavigationListeners.size).toBe(1);
  });

  it('снимает подписку при размонтировании', async () => {
    await mount();
    await unmount();

    expect(mockNavigationListeners.size).toBe(0);
  });
});

describe('обновление по событию из уведомления/виджета', () => {
  it('тап по уведомлению → refreshApplicationsNow + ensureRealtimeAlive', async () => {
    await mount();

    await tapNotification();

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(realtimeMock.ensureRealtimeAlive).toHaveBeenCalledTimes(1);
  });

  it('повторные тапы обновляют без троттла (в обход 5 с)', async () => {
    await mount();

    await tapNotification();
    await tapNotification();

    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(realtimeMock.ensureRealtimeAlive).toHaveBeenCalledTimes(2);
  });

  it('после размонтирования событие обновление не вызывает', async () => {
    await mount();
    await unmount();

    await tapNotification();

    expect(refreshMock).not.toHaveBeenCalled();
    expect(realtimeMock.ensureRealtimeAlive).not.toHaveBeenCalled();
  });

  it('ошибка обновления не ломает обработчик события', async () => {
    refreshMock.mockRejectedValueOnce(new Error('sync down'));
    await mount();

    await expect(async () => {
      await tapNotification();
    }).not.toThrow();

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(realtimeMock.ensureRealtimeAlive).toHaveBeenCalledTimes(1);
  });
});
