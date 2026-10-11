import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useAppTheme} from '../../theme';
import {View, StyleSheet, Alert, ScrollView, TouchableOpacity, AppState} from 'react-native';
import {Text, Button, Switch, Chip, Divider, TextInput, Checkbox} from 'react-native-paper';
import {useAuthStore} from '../../store/auth-store';
import {useSettingsStore} from '../../store/settings-store';
import {useTasksStore, AccountSyncState} from '../../store/tasks-store';
import AccountAvatar from '../../components/AccountAvatar';
import {triggerSyncNow} from '../../services/sync-scheduler';
import {refreshApplicationsNow, applyPriorityAccounts} from '../../services/applications-sync';
import {
  requestNotificationPermission,
  checkIsIgnoringBatteryOptimizations,
} from '../../utils/permissions';
import {ACCOUNT_COLORS, PRIORITY_MAX_ACCOUNTS} from '../../config/constants';
import {contrastText} from '../../utils/color';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  isDiagBuild,
  hasOverlayPermission,
  requestOverlayPermission,
  requestBatteryOptimizationSettings,
} from '../../native/KeepAlive';
import {hasDiagLog, shareDiagLog} from '../../diag/accept-log';
import {clearAcceptTemplates} from '../../services/accept-template-cache';

type Props = {onAddAccount: () => void; onProfile?: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

const POLL_OPTIONS = [15, 30, 60, 120];
const REPEAT_OPTIONS = [1, 2, 3, 5, 10];

function formatSyncStatus(s: AccountSyncState | undefined): {text: string; color: string} {
  if (!s || s.status === 'idle') {
    return {text: '', color: '#999'};
  }
  switch (s.status) {
    case 'syncing':
      return {text: 'Синхронизация…', color: '#FF9800'};
    case 'ok': {
      const timeStr = s.lastSyncAt
        ? new Date(s.lastSyncAt).toLocaleTimeString('ru')
        : '—';
      return {text: `ok: ${timeStr}`, color: '#4CAF50'};
    }
    case 'error':
      return {text: `Ошибка: ${s.error || 'неизвестна'}`, color: '#E53935'};
    case 'auth':
      return {
        text: 'Нужен повторный вход (удалите и добавьте аккаунт заново на сервере)',
        color: '#E53935',
      };
  }
}

export default function SettingsScreen({onAddAccount, onProfile}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const accounts = useAuthStore((s) => s.accounts);
  const removeAccount = useAuthStore((s) => s.removeAccount);
  const pollIntervalSec = useSettingsStore((s) => s.pollIntervalSec);
  const priorityAccountIds = useSettingsStore((s) => s.priorityAccountIds);
  const syncPaused = useSettingsStore((s) => s.syncPaused);
  const keepScreenOn = useSettingsStore((s) => s.keepScreenOn);
  const backgroundSync = useSettingsStore((s) => s.backgroundSync);
  const serverAddress = useSettingsStore((s) => s.serverAddress);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const notifyNewTasks = useSettingsStore((s) => s.notifyNewTasks);
  const notifyNewApplications = useSettingsStore((s) => s.notifyNewApplications);
  const notifyStatusChangesApplications = useSettingsStore((s) => s.notifyStatusChangesApplications);
  const notifyStatusChangesTasks = useSettingsStore((s) => s.notifyStatusChangesTasks);
  const pushMode = useSettingsStore((s) => s.pushMode);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const vibrationEnabled = useSettingsStore((s) => s.vibrationEnabled);
  const alertRepeatCount = useSettingsStore((s) => s.alertRepeatCount);
  const floatingWidgetEnabled = useSettingsStore((s) => s.floatingWidgetEnabled);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const saveServerAddress = useSettingsStore((s) => s.saveServerAddress);
  const syncStates = useTasksStore((s) => s.syncStates);

  const [batteryOk, setBatteryOk] = useState<boolean | null>(null);
  const [serverAddressInput, setServerAddressInput] = useState(serverAddress);
  const [serverAddressSaved, setServerAddressSaved] = useState(false);

  const refreshBattery = useCallback(async () => {
    const ok = await checkIsIgnoringBatteryOptimizations();
    setBatteryOk(ok);
  }, []);

  useEffect(() => {
    refreshBattery();
  }, [refreshBattery]);

  const handleRemove = (id: string, name: string) => {
    Alert.alert('Удалить аккаунт', `Удалить «${name}»?`, [
      {text: 'Отмена'},
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          await removeAccount(id);
          useTasksStore.getState().removeAccountTasks(id);
        },
      },
    ]);
  };

  const handleToggleBackgroundSync = async (val: boolean) => {
    if (val) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Разрешение',
          'Для фоновой синхронизации нужно разрешение на уведомления.',
        );
        return;
      }
    }
    updateSettings({backgroundSync: val});
  };

  const handleToggleNotifications = async (val: boolean) => {
    if (val) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        Alert.alert(
          'Разрешение',
          'Для уведомления о новых заявках нужно разрешение на уведомления.',
        );
        return;
      }
    }
    updateSettings({notificationsEnabled: val});
  };

  const handleToggleFloatingWidget = useCallback(async (val: boolean) => {
    if (val) {
      try {
        const granted = await hasOverlayPermission();
        if (!granted) {
          Alert.alert(
            'Разрешение',
            'Для плавающего виджета нужно разрешение «Поверх других приложений». Сейчас откроются системные настройки — включите разрешение и вернитесь в приложение.',
          );
          requestOverlayPermission();
          return;
        }
      } catch {
        // native module not available
      }
    }
    updateSettings({floatingWidgetEnabled: val});
  }, [updateSettings]);

  useEffect(() => {
    if (!floatingWidgetEnabled) {
      return;
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        try {
          hasOverlayPermission().then((granted: boolean) => {
            if (!granted) {
              updateSettings({floatingWidgetEnabled: false});
            }
          }).catch(() => {});
        } catch {
          // native module not available
        }
      }
    });
    return () => sub.remove();
  }, [floatingWidgetEnabled, updateSettings]);

  const handleTogglePriorityAccount = useCallback(
    (accId: string) => {
      const checked = priorityAccountIds.includes(accId);
      if (!checked && priorityAccountIds.length >= PRIORITY_MAX_ACCOUNTS) {
        Alert.alert('Приоритетные учётки', 'Можно выбрать не более 3 учёток');
        return;
      }
      const next = checked
        ? priorityAccountIds.filter((id) => id !== accId)
        : [...priorityAccountIds, accId];
      updateSettings({priorityAccountIds: next});
      applyPriorityAccounts(next);
    },
    [priorityAccountIds, updateSettings],
  );

  const handleSaveServerAddress = async () => {
    await saveServerAddress(serverAddressInput.trim());
    setServerAddressSaved(true);
    setTimeout(() => setServerAddressSaved(false), 2000);
  };

  useEffect(() => {
    setServerAddressInput(serverAddress);
  }, [serverAddress]);

  const handleRequestBattery = () => {
    try {
      if (typeof requestBatteryOptimizationSettings === 'function') {
        requestBatteryOptimizationSettings();
      }
    } catch {
      // native module not available
    }
    setTimeout(refreshBattery, 1500);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text variant="titleLarge" style={styles.header}>
        Настройки
      </Text>

      {onProfile && (
        <Button
          mode="contained"
          icon="account-circle"
          onPress={onProfile}
          style={styles.profileBtn}>
          Профиль
        </Button>
      )}

      {/* Адрес сервера */}
      <Text variant="titleMedium" style={styles.section}>
        Адрес сервера
      </Text>
      <View style={styles.serverRow}>
        <TextInput
          label="URL сервера ELMA"
          value={serverAddressInput}
          onChangeText={setServerAddressInput}
          mode="outlined"
          style={styles.serverInput}
          placeholder="https://elma.example.ru"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          mode="contained"
          onPress={handleSaveServerAddress}
          style={styles.serverSaveBtn}
          disabled={serverAddressInput.trim() === serverAddress}>
          {serverAddressSaved ? 'Сохранено' : 'Сохранить'}
        </Button>
      </View>

      {/* Синхронизация */}
      <Text variant="titleMedium" style={styles.section}>
        Синхронизация
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Автообновление</Text>
          <Text style={styles.switchHint}>
            Выкл — приложение не опрашивает сервер (удобно на ночь)
          </Text>
        </View>
        <Switch
          value={hydrated && !syncPaused}
          onValueChange={(val) => updateSettings({syncPaused: !val})}
        />
      </View>
      <Text style={styles.label}>Интервал опроса</Text>
      <View style={styles.chipRow}>
        {POLL_OPTIONS.map((sec) => (
          <Chip
            key={sec}
            selected={pollIntervalSec === sec}
            onPress={() => updateSettings({pollIntervalSec: sec})}
            style={[styles.chip, pollIntervalSec === sec && styles.chipActive]}
            textStyle={pollIntervalSec === sec ? styles.chipTextActive : undefined}>
            {sec}с
          </Chip>
        ))}
      </View>
      {accounts.length > 0 && (
        <View style={styles.priorityBlock}>
          <Text style={styles.label}>Приоритетные учётки (до 3)</Text>
          <Text style={styles.switchHint}>
            Отмеченные обновляются каждые 5 секунд, остальные — по интервалу опроса
          </Text>
          <Text style={styles.switchHint}>
            {`Выбрано ${priorityAccountIds.length} из ${PRIORITY_MAX_ACCOUNTS}`}
          </Text>
          {accounts.map((acc) => {
            const checked = priorityAccountIds.includes(acc.id);
            return (
              <View key={acc.id} style={styles.priorityRow}>
                <Checkbox
                  testID={'priority-' + acc.id}
                  status={checked ? 'checked' : 'unchecked'}
                  disabled={
                    !checked && priorityAccountIds.length >= PRIORITY_MAX_ACCOUNTS
                  }
                  onPress={() => handleTogglePriorityAccount(acc.id)}
                />
                <AccountAvatar name={acc.name} color={acc.color} size={20} />
                <Text style={styles.syncText}>{acc.name}</Text>
              </View>
            );
          })}
        </View>
      )}
      <Button
        mode="outlined"
        onPress={() => {
          triggerSyncNow();
          refreshApplicationsNow().catch(() => {});
        }}
        style={styles.btn}>
        Обновить сейчас
      </Button>

      {accounts.length > 0 && (
        <View style={styles.syncBlock}>
          {accounts.map((acc) => {
            const st = formatSyncStatus(syncStates[acc.id]);
            if (!st.text) {
              return null;
            }
            return (
              <View key={acc.id} style={styles.syncRow}>
                <AccountAvatar name={acc.name} color={acc.color} size={20} />
                <Text style={[styles.syncText, {color: st.color}]}>
                  {acc.name}: {st.text}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <Divider style={styles.divider} />

      {/* Фоновая работа */}
      <Text variant="titleMedium" style={styles.section}>
        Фоновая работа
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Не гасить экран</Text>
          <Text style={styles.switchHint}>Пока приложение открыто</Text>
        </View>
        <Switch
          value={hydrated && keepScreenOn}
          onValueChange={(val) => updateSettings({keepScreenOn: val})}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Фоновая синхронизация</Text>
          <Text style={styles.switchHint}>Работает в фоне (Android)</Text>
        </View>
        <Switch
          value={hydrated && backgroundSync}
          onValueChange={handleToggleBackgroundSync}
        />
      </View>
      <View style={styles.batteryRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Оптимизация батареи</Text>
          <Text style={styles.switchHint}>
            {batteryOk === null
              ? 'Проверка…'
              : batteryOk
              ? 'Исключено'
              : 'Включена'}
          </Text>
        </View>
        <Button mode="text" onPress={handleRequestBattery}>
          Настроить
        </Button>
      </View>

      <Divider style={styles.divider} />

      {/* Уведомления */}
      <Text variant="titleMedium" style={styles.section}>
        Уведомления
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Уведомления о новых заявках</Text>
          <Text style={styles.switchHint}>Звук и вибрация при новой заявке</Text>
        </View>
        <Switch
          value={hydrated && notificationsEnabled}
          onValueChange={handleToggleNotifications}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Новые задачи</Text>
          <Text style={styles.switchHint}>Уведомлять о поставленных задачах</Text>
        </View>
        <Switch
          value={hydrated && notifyNewTasks}
          onValueChange={(val) => updateSettings({notifyNewTasks: val})}
          disabled={!notificationsEnabled}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Новые заявки</Text>
          <Text style={styles.switchHint}>Уведомлять о поступивших заявках</Text>
        </View>
        <Switch
          value={hydrated && notifyNewApplications}
          onValueChange={(val) => updateSettings({notifyNewApplications: val})}
          disabled={!notificationsEnabled}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Смена статуса заявки</Text>
          <Text style={styles.switchHint}>Уведомлять при изменении статуса заявки</Text>
        </View>
        <Switch
          value={hydrated && notifyStatusChangesApplications}
          onValueChange={(val) => updateSettings({notifyStatusChangesApplications: val})}
          disabled={!notificationsEnabled}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Смена статуса задачи</Text>
          <Text style={styles.switchHint}>Уведомлять при изменении статуса задачи</Text>
        </View>
        <Switch
          value={hydrated && notifyStatusChangesTasks}
          onValueChange={(val) => updateSettings({notifyStatusChangesTasks: val})}
          disabled={!notificationsEnabled}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Звук</Text>
          <Text style={styles.switchHint}>Громкий сигнал</Text>
        </View>
        <Switch
          value={hydrated && soundEnabled}
          onValueChange={(val) => updateSettings({soundEnabled: val})}
          disabled={!notificationsEnabled}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Вибрация</Text>
          <Text style={styles.switchHint}>Вибрация при уведомлении</Text>
        </View>
        <Switch
          value={hydrated && vibrationEnabled}
          onValueChange={(val) => updateSettings({vibrationEnabled: val})}
          disabled={!notificationsEnabled}
        />
      </View>
      <Text style={styles.label}>Сколько раз повторять звук</Text>
      <View style={styles.chipRow}>
        {REPEAT_OPTIONS.map((count) => (
          <Chip
            key={count}
            selected={alertRepeatCount === count}
            onPress={() => updateSettings({alertRepeatCount: count})}
            disabled={!notificationsEnabled || !soundEnabled}
            style={[styles.chip, alertRepeatCount === count && styles.chipActive]}
            textStyle={alertRepeatCount === count ? styles.chipTextActive : undefined}>
            {count}
          </Chip>
        ))}
      </View>

      <Divider style={styles.divider} />

      {/* Режим работы */}
      <Text variant="titleMedium" style={styles.section}>
        Режим работы
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Пуш-режим</Text>
          <Text style={styles.switchHint}>
            Обновлять список заявок из пуша, не опрашивая сервер каждые несколько секунд.
            Если пуш отвалится — опрос включится автоматически.
          </Text>
        </View>
        <Switch
          value={hydrated && pushMode}
          onValueChange={(val) => updateSettings({pushMode: val})}
        />
      </View>

      <Divider style={styles.divider} />

      {/* Плавающий виджет */}
      <Text variant="titleMedium" style={styles.section}>
        Плавающий виджет
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Виджет поверх приложений</Text>
          <Text style={styles.switchHint}>Показывает время обновления заявок</Text>
        </View>
        <Switch
          value={hydrated && floatingWidgetEnabled}
          onValueChange={handleToggleFloatingWidget}
        />
      </View>

      <Divider style={styles.divider} />

      {/* Оформление */}
      <Text variant="titleMedium" style={styles.section}>
        Оформление
      </Text>
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Режим отображения</Text>
          <Text style={styles.switchHint}>Выбор темы приложения</Text>
        </View>
        <View style={styles.switchHint} />
      </View>
      <View style={styles.chipRow}>
        {['system', 'light', 'dark'].map((tm) => {
          const isSelected = themeMode === tm;
          return (
            <Chip
              key={tm}
              selected={isSelected}
              onPress={() => updateSettings({themeMode: tm as 'light' | 'dark' | 'system'})}
              style={[styles.chip, isSelected && styles.chipActive]}
              textStyle={isSelected ? styles.chipTextActive : undefined}>
              {tm === 'system' ? 'Системная' : tm.charAt(0).toUpperCase() + tm.slice(1)}
            </Chip>
          );
        })}
      </View>

      <Divider style={styles.divider} />

      {/* Аккаунты */}
      <Text variant="titleMedium" style={styles.section}>
        Аккаунты
      </Text>
      {accounts.length === 0 ? (
        <Text style={styles.empty}>Нет подключённых аккаунтов</Text>
      ) : (
        accounts.map((acc) => (
          <React.Fragment key={acc.id}>
            <View style={styles.accountRow}>
              <AccountAvatar name={acc.name} color={acc.color} />
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{acc.name}</Text>
                <Text style={styles.accountUrl}>{acc.baseUrl}</Text>
              </View>
              <Button
                mode="text"
                textColor={colors.error}
                onPress={() => handleRemove(acc.id, acc.name)}>
                Удалить
              </Button>
            </View>
            <View style={styles.colorSwatches}>
              {ACCOUNT_COLORS.map((hex) => {
                const selected = acc.color === hex;
                return (
                  <TouchableOpacity
                    key={hex}
                    style={[
                      styles.swatch,
                      {backgroundColor: hex},
                      selected && styles.swatchSelected,
                    ]}
                    onPress={() =>
                      useAuthStore.getState().updateAccount(acc.id, {color: hex})
                    }
                    activeOpacity={0.7}>
                    {selected && (
                      <Icon name="check" size={16} color={contrastText(hex)} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </React.Fragment>
        ))
      )}

      <Button mode="outlined" style={styles.addBtn} onPress={onAddAccount}>
        + Добавить аккаунт
      </Button>

      {isDiagBuild && (
        <Button
          mode="outlined"
          style={styles.btn}
          onPress={() => {
            if (hasDiagLog()) {
              shareDiagLog('вручную');
            } else {
              Alert.alert('Диагностика', 'Лог пуст — сначала примите заявку.');
            }
          }}>
          Лог капчи (diag)
        </Button>
      )}

      <Divider style={styles.divider} />

      <Text variant="titleMedium" style={styles.section}>
        Кэш
      </Text>
      <Button
        mode="outlined"
        style={styles.btn}
        onPress={() => {
          Alert.alert(
            'Сбросить кэш шаблона',
            'Шаблон будет запрошен заново с сервера.',
            [
              {text: 'Отмена'},
              {
                text: 'Сбросить',
                onPress: async () => {
                  await clearAcceptTemplates();
                  Alert.alert('Готово', 'Кэш шаблона приёма сброшен.');
                },
              },
            ],
          );
        }}>
        Сбросить кэш шаблона приёма
      </Button>
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  content: {paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40},
  header: {fontWeight: 'bold', marginBottom: 16},
  profileBtn: {marginBottom: 16, borderRadius: 12},
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  serverInput: {flex: 1},
  serverSaveBtn: {borderRadius: 12, minWidth: 100},
  section: {fontWeight: '600', marginBottom: 12},
  empty: {color: c.textTertiary, marginBottom: 16},
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 1,
  },
  accountInfo: {flex: 1, marginLeft: 12},
  accountName: {fontWeight: '600'},
  accountUrl: {fontSize: 12, color: c.textTertiary},
  addBtn: {marginTop: 16, borderRadius: 12},
  label: {fontSize: 14, color: c.textSecondary, marginBottom: 8},
  chipRow: {flexDirection: 'row', gap: 8, marginBottom: 12},
  chip: {backgroundColor: c.chipDefault},
  chipActive: {backgroundColor: c.primary},
  chipTextActive: {color: c.onBackground},
  btn: {marginBottom: 12, borderRadius: 12},
  syncBlock: {marginBottom: 8},
  priorityBlock: {marginBottom: 12},
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  syncRow: {flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8},
  syncText: {fontSize: 13, flex: 1},
  divider: {marginVertical: 16},
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 1,
  },
  switchInfo: {flex: 1},
  switchLabel: {fontWeight: '600'},
  switchHint: {fontSize: 12, color: c.textTertiary, marginTop: 2},
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 1,
  },
  colorSwatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: c.onBackground,
    elevation: 3,
  },
});
