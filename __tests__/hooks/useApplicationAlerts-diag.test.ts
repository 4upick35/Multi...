/**
 * Диагностический вывод хука useApplicationAlerts (тег `alerts`):
 *   - poll-new-application — новая заявка, найденная опросом (до уведомления);
 *   - alert                 — уведомление отправлено;
 *   - alert-skip reason=disabled — уведомления выключены в настройках.
 *
 * Модули сторов/нативный мокаем, чтобы не тянуть React-контекст приложения.
 */
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {logDiag} from '../../src/diag/accept-log';
import {useApplicationAlerts} from '../../src/hooks/useApplicationAlerts';
import {CollectionItem} from '../../src/types/customer-service';

jest.mock('../../src/diag/accept-log', () => ({logDiag: jest.fn()}));

jest.mock('../../src/services/seen-application-alerts', () => ({
  MAX_SEEN_KEYS: 500,
  loadSeenKeys: jest.fn(() => Promise.resolve(new Set<string>())),
  persistSeenKeys: jest.fn(),
}));

const mockCsItems: Record<string, Record<string, CollectionItem[]>> = {};
const mockAccounts = [{id: 'acc-1', name: 'Account 1'}];
const mockSettings = {
  notificationsEnabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  alertRepeatCount: 1,
  floatingWidgetEnabled: false,
};
const mockCsListeners = new Set<() => void>();
const mockSettingsListeners = new Set<() => void>();
const mockAlertNewItem = jest.fn();
const mockPulseOverlayWidget = jest.fn();

jest.mock('../../src/store/customer-service-store', () => ({
  useCustomerServiceStore: {
    getState: () => ({itemsByAccount: mockCsItems}),
    subscribe: (listener: () => void) => {
      mockCsListeners.add(listener);
      return () => {
        mockCsListeners.delete(listener);
      };
    },
  },
}));

jest.mock('../../src/store/auth-store', () => ({
  useAuthStore: {
    getState: () => ({accounts: mockAccounts}),
  },
}));

jest.mock('../../src/store/settings-store', () => ({
  useSettingsStore: {
    getState: () => mockSettings,
    subscribe: (listener: () => void) => {
      mockSettingsListeners.add(listener);
      return () => {
        mockSettingsListeners.delete(listener);
      };
    },
  },
}));

jest.mock('../../src/native/KeepAlive', () => ({
  alertNewItem: mockAlertNewItem,
  pulseOverlayWidget: mockPulseOverlayWidget,
}));

const mockedLogDiag = logDiag as jest.MockedFunction<typeof logDiag>;

const makeItem = (id: string, name = `Item ${id}`): CollectionItem => ({
  id,
  name,
  status: 'active',
  createdAt: '2025-01-01T00:00:00Z',
  raw: {},
});

function Probe() {
  useApplicationAlerts();
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

function fireCs(): void {
  mockCsListeners.forEach((listener) => listener());
}

/** Первый снимок (нет prev) — без записей в diag. */
async function primeSnapshot(): Promise<void> {
  mockCsItems['acc-1'] = {};
  await act(async () => {
    fireCs();
  });
}

beforeEach(async () => {
  await unmount();
  jest.clearAllMocks();
  for (const key of Object.keys(mockCsItems)) {
    delete mockCsItems[key];
  }
  mockCsListeners.clear();
  mockSettingsListeners.clear();
  mockSettings.notificationsEnabled = true;
});

describe('useApplicationAlerts — diag (тег alerts)', () => {
  it('пишет poll-new-application для каждой новой заявки и alert после уведомления', async () => {
    await mount();
    await primeSnapshot();
    expect(mockedLogDiag).not.toHaveBeenCalled();

    mockCsItems['acc-1'] = {applications: [makeItem('1'), makeItem('2')]};
    await act(async () => {
      fireCs();
    });

    const pollLogs = mockedLogDiag.mock.calls.filter(([tag, text]) =>
      tag === 'alerts' && String(text).includes('poll-new-application'),
    );
    expect(pollLogs).toHaveLength(2);
    expect(String(pollLogs[0][1])).toContain('account=acc-1');
    expect(String(pollLogs[0][1])).toContain('id=1');
    expect(String(pollLogs[0][1])).toContain('name=Item 1');

    expect(mockAlertNewItem).toHaveBeenCalledTimes(2);
    expect(mockedLogDiag).toHaveBeenCalledWith(
      'alerts',
      expect.stringContaining('alert account=acc-1'),
    );
    expect(mockedLogDiag).not.toHaveBeenCalledWith(
      'alerts',
      expect.stringContaining('alert-skip'),
    );
  });

  it('при отключённых уведомлениях пишет alert-skip reason=disabled и не шлёт alert', async () => {
    mockSettings.notificationsEnabled = false;
    await mount();
    await primeSnapshot();

    mockCsItems['acc-1'] = {applications: [makeItem('1')]};
    await act(async () => {
      fireCs();
    });

    expect(mockedLogDiag).toHaveBeenCalledWith(
      'alerts',
      expect.stringContaining('poll-new-application'),
    );
    expect(mockedLogDiag).toHaveBeenCalledWith(
      'alerts',
      expect.stringContaining('alert-skip reason=disabled account=acc-1'),
    );
    expect(mockedLogDiag).not.toHaveBeenCalledWith(
      'alerts',
      expect.stringContaining('alert account='),
    );
    expect(mockAlertNewItem).not.toHaveBeenCalled();
  });
});
