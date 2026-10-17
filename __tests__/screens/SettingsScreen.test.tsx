/**
 * SettingsScreen — предпрослушивание звука по группам уведомлений.
 *
 * Кнопка «Прослушать» в каждой группе должна звать
 * `previewAlertSound(soundId, volume)` со значениями ИМЕННО своей группы
 * (новая заявка — отдельные звук/громкость, остальные — свои).
 *
 * Нативные модули и побочные сервисы замоканы — сетевых запросов и
 * обращений к нативному коду нет.
 */

import React from 'react';
import renderer, {act, ReactTestRenderer, TestInstance} from 'react-test-renderer';
import {PaperProvider} from 'react-native-paper';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('../../src/native/KeepAlive', () => ({
  isDiagBuild: false,
  hasOverlayPermission: jest.fn(() => Promise.resolve(false)),
  requestOverlayPermission: jest.fn(),
  requestBatteryOptimizationSettings: jest.fn(),
  previewAlertSound: jest.fn(),
}));
jest.mock('../../src/services/sync-scheduler', () => ({
  triggerSyncNow: jest.fn(),
}));
jest.mock('../../src/services/applications-sync', () => ({
  refreshApplicationsNow: jest.fn(() => Promise.resolve()),
  applyPriorityAccounts: jest.fn(),
}));
jest.mock('../../src/utils/permissions', () => ({
  requestNotificationPermission: jest.fn(() => Promise.resolve(true)),
  checkIsIgnoringBatteryOptimizations: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../src/diag/accept-log', () => ({
  hasDiagLog: jest.fn(() => false),
  shareDiagLog: jest.fn(),
}));
jest.mock('../../src/services/accept-template-cache', () => ({
  clearAcceptTemplates: jest.fn(() => Promise.resolve()),
}));

import SettingsScreen from '../../src/screens/tasks/SettingsScreen';
import {useSettingsStore} from '../../src/store/settings-store';
import {ALERT_SOUND_GENERAL} from '../../src/config/constants';
import {previewAlertSound} from '../../src/native/KeepAlive';

const mockedPreview = previewAlertSound as jest.Mock;

const NEW_APP_GROUP = 'Поступила новая заявка';
const OTHER_GROUP = 'Остальные уведомления';

beforeEach(() => {
  jest.clearAllMocks();
  // Мастер-переключатель и звук включены — кнопки предпрослушивания активны.
  useSettingsStore.setState({
    notificationsEnabled: true,
    soundEnabled: true,
    newApplicationSoundId: 'raw:custom_new_application',
    newApplicationVolume: 7,
    otherSoundId: 'system',
    otherVolume: 3,
  });
});

function renderScreen(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <PaperProvider>
        <SettingsScreen onAddAccount={jest.fn()} />
      </PaperProvider>,
    );
  });
  return tree;
}

type PressableNode = {props: {onPress: () => void | Promise<void> | undefined}};

const isPreviewButton = (n: {props: Record<string, unknown>}) =>
  n.props.children === 'Прослушать' && typeof n.props.onPress === 'function';

/**
 * Контейнер группы «Звук по группам уведомлений»: поднимаемся от заголовка
 * группы к предку, в котором ровно одна кнопка «Прослушать» — так чипы
 * ищутся внутри своей группы, а не по всему экрану.
 */
function findGroup(tree: ReactTestRenderer, title: string): TestInstance {
  const labels = tree.root.findAll((n) => n.props.children === title);
  expect(labels.length).toBeGreaterThan(0);
  let node: TestInstance | null = labels[0];
  while (node) {
    if (node.findAll(isPreviewButton).length === 1) {
      return node;
    }
    node = node.parent;
  }
  throw new Error('Не найден контейнер группы: ' + title);
}

function findIn(node: TestInstance, label: string | number): TestInstance {
  const found = node.findAll(
    (n) => n.props.children === label && typeof n.props.onPress === 'function',
  );
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

async function press(node: PressableNode): Promise<void> {
  await act(async () => {
    await node.props.onPress();
  });
}

describe('SettingsScreen — «Прослушать» в группах звуков', () => {
  it('группа «Поступила новая заявка»: previewAlertSound(soundId, volume) этой группы', async () => {
    const tree = renderScreen();

    const group = findGroup(tree, NEW_APP_GROUP);
    await press(findIn(group, 'Прослушать') as PressableNode);

    expect(mockedPreview).toHaveBeenCalledTimes(1);
    expect(mockedPreview).toHaveBeenCalledWith('raw:custom_new_application', 7);
  });

  it('группа «Остальные уведомления»: previewAlertSound(soundId, volume) своей группы', async () => {
    const tree = renderScreen();

    const group = findGroup(tree, OTHER_GROUP);
    await press(findIn(group, 'Прослушать') as PressableNode);

    expect(mockedPreview).toHaveBeenCalledTimes(1);
    expect(mockedPreview).toHaveBeenCalledWith('system', 3);
  });

  it('после смены звука и громкости в группе «Прослушать» зовёт уже новые значения', async () => {
    const tree = renderScreen();
    const group = findGroup(tree, NEW_APP_GROUP);

    // Другой звук и громкость — в группе новой заявки
    await press(findIn(group, 'Обычный') as PressableNode);
    await press(findIn(group, 5) as PressableNode);

    const state = useSettingsStore.getState();
    expect(state.newApplicationSoundId).toBe(ALERT_SOUND_GENERAL);
    expect(state.newApplicationVolume).toBe(5);

    await press(findIn(group, 'Прослушать') as PressableNode);

    expect(mockedPreview).toHaveBeenCalledTimes(1);
    expect(mockedPreview).toHaveBeenCalledWith(ALERT_SOUND_GENERAL, 5);
  });
});
