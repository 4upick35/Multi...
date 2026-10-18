/**
 * Мастер-переключатели (notificationsEnabled/notifyNewTasks) и проброс
 * {soundId, volume} из настроек в notifyTask для хука useNotifications.
 */
import React from 'react';
import renderer, {act} from 'react-test-renderer';
import {useNotifications} from '../../src/hooks/useNotifications';
import {notifyTask} from '../../src/native/KeepAlive';
import type {ElmaTask} from '../../src/types/task';

const mockTasksByAccount: Record<string, ElmaTask[]> = {};
const mockAccounts = [{id: 'acc-1', name: 'Аккаунт 1'}];
const mockSettings = {
  notificationsEnabled: true,
  notifyNewTasks: true,
  soundEnabled: true,
  vibrationEnabled: true,
  otherSoundId: 'other-sound',
  otherVolume: 7,
  quietHoursEnabled: false,
  quietHoursFrom: '22:00',
  quietHoursTo: '07:00',
  notificationDisabledAccountIds: [] as string[],
};
const mockTaskListeners = new Set<() => void>();

jest.mock('../../src/store/tasks-store', () => ({
  useTasksStore: {
    getState: () => ({tasksByAccount: mockTasksByAccount}),
    subscribe: (listener: () => void) => {
      mockTaskListeners.add(listener);
      return () => {
        mockTaskListeners.delete(listener);
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
  },
}));

jest.mock('../../src/native/KeepAlive', () => ({
  notifyTask: jest.fn(),
}));

const mockedNotifyTask = notifyTask as jest.MockedFunction<typeof notifyTask>;

function makeTask(id: string): ElmaTask {
  return {
    id,
    accountId: 'acc-1',
    name: `Задача ${id}`,
    subject: `Тема ${id}`,
    status: 'New',
    priority: 'Normal',
    createdAt: '2025-01-01T00:00:00Z',
    isOverdue: false,
  };
}

function Probe() {
  useNotifications();
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

function fireTasks(): void {
  mockTaskListeners.forEach((listener) => listener());
}

/** Первый снимок задач — без уведомлений. */
async function primeSnapshot(): Promise<void> {
  mockTasksByAccount['acc-1'] = [makeTask('1')];
  await act(async () => {
    fireTasks();
  });
}

async function addTaskAndFire(id: string): Promise<void> {
  mockTasksByAccount['acc-1'] = [...mockTasksByAccount['acc-1'], makeTask(id)];
  await act(async () => {
    fireTasks();
  });
}

beforeEach(async () => {
  await unmount();
  jest.clearAllMocks();
  for (const key of Object.keys(mockTasksByAccount)) {
    delete mockTasksByAccount[key];
  }
  mockTaskListeners.clear();
  mockSettings.notificationsEnabled = true;
  mockSettings.notifyNewTasks = true;
  mockSettings.soundEnabled = true;
  mockSettings.vibrationEnabled = true;
  mockSettings.otherSoundId = 'other-sound';
  mockSettings.otherVolume = 7;
  mockSettings.quietHoursEnabled = false;
  mockSettings.quietHoursFrom = '22:00';
  mockSettings.quietHoursTo = '07:00';
  mockSettings.notificationDisabledAccountIds = [];
});

describe('useNotifications: мастер-переключатели и опции звука', () => {
  it('при включённых переключателях notifyTask вызывается с otherSoundId/otherVolume из настроек', async () => {
    await mount();
    await primeSnapshot();
    expect(mockedNotifyTask).not.toHaveBeenCalled();

    await addTaskAndFire('2');

    expect(mockedNotifyTask).toHaveBeenCalledTimes(1);
    expect(mockedNotifyTask).toHaveBeenCalledWith(
      'Новая задача: Тема 2',
      'Аккаунт 1',
      {
        sound: true,
        vibration: true,
        soundId: 'other-sound',
        volume: 7,
      },
      '2',
    );
  });

  it('при выключенных уведомлениях (notificationsEnabled=false) notifyTask не вызывается', async () => {
    mockSettings.notificationsEnabled = false;
    await mount();
    await primeSnapshot();

    await addTaskAndFire('2');

    expect(mockedNotifyTask).not.toHaveBeenCalled();
  });

  it('при выключенных задачах (notifyNewTasks=false) notifyTask не вызывается', async () => {
    mockSettings.notifyNewTasks = false;
    await mount();
    await primeSnapshot();

    await addTaskAndFire('2');

    expect(mockedNotifyTask).not.toHaveBeenCalled();
  });
});
