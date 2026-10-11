/**
 * Настройка «Приоритетные учётки»: src/store/settings-store.ts.
 *
 *  (а) updateSettings обрезает список до PRIORITY_MAX_ACCOUNTS;
 *  (б) дубликаты и пустые строки отбрасываются;
 *  (в) значение сохраняется в AsyncStorage и восстанавливается через loadSettings;
 *  (г) если в сохранённых данных не массив — используется [].
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSettingsStore} from '../../src/store/settings-store';
import {STORAGE_KEYS, PRIORITY_MAX_ACCOUNTS} from '../../src/config/constants';

async function readStoredSettings(): Promise<Record<string, unknown>> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.settings);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useSettingsStore.setState({
    priorityAccountIds: [],
    notifyNewTasks: true,
    notifyNewApplications: true,
    notifyStatusChangesApplications: true,
    notifyStatusChangesTasks: true,
    pushMode: false,
  });
});

describe('settings-store — приоритетные учётки', () => {
  it('сохраняет не больше 3 учёток (лишние отбрасываются)', () => {
    useSettingsStore
      .getState()
      .updateSettings({priorityAccountIds: ['a', 'b', 'c', 'd']});

    const ids = useSettingsStore.getState().priorityAccountIds;
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(ids).toHaveLength(PRIORITY_MAX_ACCOUNTS);
  });

  it('убирает дубликаты и пустые строки', () => {
    const updateSettings = useSettingsStore.getState().updateSettings;

    updateSettings({priorityAccountIds: ['a', 'a', 'b']});
    expect(useSettingsStore.getState().priorityAccountIds).toEqual(['a', 'b']);

    updateSettings({priorityAccountIds: ['', '   ', 'b', 'c']});
    expect(useSettingsStore.getState().priorityAccountIds).toEqual(['b', 'c']);

    updateSettings({priorityAccountIds: []});
    expect(useSettingsStore.getState().priorityAccountIds).toEqual([]);
  });

  it('восстанавливает список из AsyncStorage через loadSettings', async () => {
    useSettingsStore.getState().updateSettings({priorityAccountIds: ['x', 'y']});
    await Promise.resolve();

    const stored = await readStoredSettings();
    expect(stored.priorityAccountIds).toEqual(['x', 'y']);

    useSettingsStore.setState({priorityAccountIds: []});
    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().priorityAccountIds).toEqual(['x', 'y']);
  });

  it('при загрузке список тоже обрезается до лимита', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({priorityAccountIds: ['a', 'b', 'c', 'd', 'e']}),
    );

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().priorityAccountIds).toEqual(['a', 'b', 'c']);
  });

  it('если в сохранённых данных не массив — используется []', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({priorityAccountIds: 'not-an-array'}),
    );

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().priorityAccountIds).toEqual([]);
  });
});

describe('settings-store — категории уведомлений', () => {
  it('дефолты: notifyNewTasks/notifyNewApplications/notifyStatusChangesApplications/notifyStatusChangesTasks = true', () => {
    const state = useSettingsStore.getState();
    expect(state.notifyNewTasks).toBe(true);
    expect(state.notifyNewApplications).toBe(true);
    expect(state.notifyStatusChangesApplications).toBe(true);
    expect(state.notifyStatusChangesTasks).toBe(true);
  });

  it('updateSettings сохраняет новые поля и пишет их в AsyncStorage', async () => {
    useSettingsStore.getState().updateSettings({
      notifyNewTasks: false,
      notifyNewApplications: false,
      notifyStatusChangesApplications: false,
      notifyStatusChangesTasks: false,
    });
    await Promise.resolve();

    const state = useSettingsStore.getState();
    expect(state.notifyNewTasks).toBe(false);
    expect(state.notifyNewApplications).toBe(false);
    expect(state.notifyStatusChangesApplications).toBe(false);
    expect(state.notifyStatusChangesTasks).toBe(false);

    const stored = await readStoredSettings();
    expect(stored.notifyNewTasks).toBe(false);
    expect(stored.notifyNewApplications).toBe(false);
    expect(stored.notifyStatusChangesApplications).toBe(false);
    expect(stored.notifyStatusChangesTasks).toBe(false);
  });

  it('updateSettings переключает поля независимо друг от друга', async () => {
    useSettingsStore.getState().updateSettings({
      notifyStatusChangesApplications: false,
      notifyStatusChangesTasks: true,
    });
    await Promise.resolve();

    expect(useSettingsStore.getState().notifyStatusChangesApplications).toBe(false);
    expect(useSettingsStore.getState().notifyStatusChangesTasks).toBe(true);

    const stored = await readStoredSettings();
    expect(stored.notifyStatusChangesApplications).toBe(false);
    expect(stored.notifyStatusChangesTasks).toBe(true);
  });

  it('loadSettings восстанавливает новые поля из AsyncStorage', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        notifyNewTasks: false,
        notifyNewApplications: true,
        notifyStatusChangesApplications: false,
        notifyStatusChangesTasks: true,
      }),
    );

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().notifyNewTasks).toBe(false);
    expect(useSettingsStore.getState().notifyNewApplications).toBe(true);
    expect(useSettingsStore.getState().notifyStatusChangesApplications).toBe(false);
    expect(useSettingsStore.getState().notifyStatusChangesTasks).toBe(true);
  });

  it('миграция: сохранённый старый notifyStatusChanges:false транслируется в оба новых поля', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({notifyStatusChanges: false}),
    );

    useSettingsStore.setState({
      notifyStatusChangesApplications: true,
      notifyStatusChangesTasks: true,
    });
    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().notifyStatusChangesApplications).toBe(false);
    expect(useSettingsStore.getState().notifyStatusChangesTasks).toBe(false);
  });

  it('миграция: старый notifyStatusChanges:true даёт оба новых поля true', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({notifyStatusChanges: true}),
    );

    useSettingsStore.setState({
      notifyStatusChangesApplications: false,
      notifyStatusChangesTasks: false,
    });
    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().notifyStatusChangesApplications).toBe(true);
    expect(useSettingsStore.getState().notifyStatusChangesTasks).toBe(true);
  });

  it('раздельные поля имеют приоритет над старым notifyStatusChanges', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        notifyStatusChanges: false,
        notifyStatusChangesApplications: true,
        notifyStatusChangesTasks: false,
      }),
    );

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().notifyStatusChangesApplications).toBe(true);
    expect(useSettingsStore.getState().notifyStatusChangesTasks).toBe(false);
  });

  it('если в сохранённых данных новых полей нет — используются true', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({}));

    useSettingsStore.setState({
      notifyNewTasks: false,
      notifyNewApplications: false,
      notifyStatusChangesApplications: false,
      notifyStatusChangesTasks: false,
    });
    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().notifyNewTasks).toBe(true);
    expect(useSettingsStore.getState().notifyNewApplications).toBe(true);
    expect(useSettingsStore.getState().notifyStatusChangesApplications).toBe(true);
    expect(useSettingsStore.getState().notifyStatusChangesTasks).toBe(true);
  });
});

describe('settings-store — pushMode', () => {
  it('дефолт: pushMode === false', () => {
    expect(useSettingsStore.getState().pushMode).toBe(false);
  });

  it('updateSettings({pushMode:true}) обновляет состояние и персистится в AsyncStorage', async () => {
    useSettingsStore.getState().updateSettings({pushMode: true});
    await Promise.resolve();

    expect(useSettingsStore.getState().pushMode).toBe(true);
    const stored = await readStoredSettings();
    expect(stored.pushMode).toBe(true);
  });

  it('loadSettings восстанавливает pushMode из AsyncStorage', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({pushMode: true}),
    );

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().pushMode).toBe(true);
  });

  it('если pushMode в сохранённых данных нет — false', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.settings, JSON.stringify({}));

    useSettingsStore.setState({pushMode: true});
    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().pushMode).toBe(false);
  });
});
