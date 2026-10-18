import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useAppTheme} from '../../theme';
import {View, StyleSheet, Alert, ScrollView, TouchableOpacity, AppState} from 'react-native';
import {Text, Button, Switch, Chip, TextInput, Checkbox} from 'react-native-paper';
import {useAuthStore} from '../../store/auth-store';
import {useSettingsStore} from '../../store/settings-store';
import {useTasksStore, AccountSyncState} from '../../store/tasks-store';
import AccountAvatar from '../../components/AccountAvatar';
import PressScale from '../../components/PressScale';
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
import NotificationsSection from './settings-sections/NotificationsSection';

type Props = {onAddAccount: () => void; onProfile?: () => void; onHealth?: () => void};
export type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

const POLL_OPTIONS = [15, 30, 60, 120];

/** Ключи секций → ключевые слова для поиска по настройкам. */
const SECTION_KEYWORDS: Record<string, string[]> = {
  server: ['адрес', 'сервер', 'url'],
  sync: ['синхронизация', 'опрос', 'интервал', 'приоритет', 'обновить'],
  background: ['фон', 'экран', 'батарея', 'энергосбережение'],
  notifications: ['уведомления', 'звук', 'вибрация', 'тихие часы', 'аккаунт'],
  workmode: ['пуш', 'режим', 'realtime'],
  widget: ['виджет', 'поверх'],
  appearance: ['тема', 'оформление', 'тёмная', 'светлая'],
  accounts: ['аккаунты', 'учётки', 'цвет'],
  service: ['сервис', 'кэш', 'диагностика', 'лог'],
};

const SECTION_ORDER: Array<{key: string; title: string}> = [
  {key: 'server', title: 'Адрес сервера'},
  {key: 'sync', title: 'Синхронизация'},
  {key: 'background', title: 'Фоновая работа'},
  {key: 'notifications', title: 'Уведомления'},
  {key: 'workmode', title: 'Режим работы'},
  {key: 'widget', title: 'Плавающий виджет'},
  {key: 'appearance', title: 'Оформление'},
  {key: 'accounts', title: 'Аккаунты'},
  {key: 'service', title: 'Сервис'},
];

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

type SectionProps = {
  title: string;
  icon: string;
  summary?: string;
  expanded: boolean;
  onToggle: () => void;
  styles: SettingsStyles;
  colors: ThemeColors;
  children: React.ReactNode;
};

export function SettingsSection({title, icon, summary, expanded, onToggle, styles, colors, children}: SectionProps) {
  return (
    <View style={styles.sectionCard}>
      <PressScale style={styles.sectionHeader} activeOpacity={0.7} scaleTo={0.99} onPress={onToggle}>
        <View style={styles.sectionIconWrap}>
          <Icon name={icon} size={22} color={colors.primary} />
        </View>
        <View style={styles.sectionInfo}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {summary ? <Text style={styles.sectionSummary}>{summary}</Text> : null}
        </View>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.textTertiary} />
      </PressScale>
      <View style={[styles.sectionBody, {display: expanded ? 'flex' : 'none'}]}>{children}</View>
    </View>
  );
}

export default function SettingsScreen({onAddAccount, onProfile, onHealth}: Props) {
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
  const pushMode = useSettingsStore((s) => s.pushMode);
  const floatingWidgetEnabled = useSettingsStore((s) => s.floatingWidgetEnabled);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const saveServerAddress = useSettingsStore((s) => s.saveServerAddress);
  const syncStates = useTasksStore((s) => s.syncStates);

  const [batteryOk, setBatteryOk] = useState<boolean | null>(null);
  const [serverAddressInput, setServerAddressInput] = useState(serverAddress);
  const [serverAddressSaved, setServerAddressSaved] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>('sync');
  const [settingsQuery, setSettingsQuery] = useState('');

  const searchQuery = settingsQuery.trim().toLowerCase();
  const searchActive = searchQuery !== '';

  const matches = (key: string, title: string): boolean => {
    if (!searchActive) {
      return true;
    }
    return (
      title.toLowerCase().includes(searchQuery) ||
      (SECTION_KEYWORDS[key] ?? []).some((k) => k.includes(searchQuery))
    );
  };

  const anySectionVisible = SECTION_ORDER.some((s) => matches(s.key, s.title));

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

      <View style={styles.searchRow}>
        <TextInput
          mode="outlined"
          placeholder="Поиск по настройкам"
          placeholderTextColor={colors.textTertiary}
          value={settingsQuery}
          onChangeText={setSettingsQuery}
          style={styles.searchInput}
          left={<TextInput.Icon icon="magnify" />}
        />
        {settingsQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSettingsQuery('')}>
            <Icon name="close-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {searchActive && !anySectionVisible && (
        <Text style={styles.empty}>Ничего не найдено</Text>
      )}

      {matches('server', 'Адрес сервера') && (
        <SettingsSection
          title="Адрес сервера"
          icon="server-network"
          summary={serverAddress || 'Не указан'}
          expanded={searchActive ? true : openSection === 'server'}
          onToggle={() => setOpenSection(openSection === 'server' ? null : 'server')}
          styles={styles}
          colors={colors}>
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
        </SettingsSection>
      )}

      {matches('sync', 'Синхронизация') && (
        <SettingsSection
          title="Синхронизация"
          icon="sync"
          summary={syncPaused ? 'Опрос приостановлен' : `Интервал ${pollIntervalSec} с`}
          expanded={searchActive ? true : openSection === 'sync'}
          onToggle={() => setOpenSection(openSection === 'sync' ? null : 'sync')}
          styles={styles}
          colors={colors}>
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
        </SettingsSection>
      )}

      {matches('background', 'Фоновая работа') && (
        <SettingsSection
          title="Фоновая работа"
          icon="cellphone-cog"
          summary={backgroundSync ? 'Фоновая синхронизация включена' : 'Только при открытом приложении'}
          expanded={searchActive ? true : openSection === 'background'}
          onToggle={() => setOpenSection(openSection === 'background' ? null : 'background')}
          styles={styles}
          colors={colors}>
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
        </SettingsSection>
      )}

      {matches('notifications', 'Уведомления') && (
        <NotificationsSection
          expanded={settingsQuery.trim() !== '' || openSection === 'notifications'}
          onToggle={() => setOpenSection(openSection === 'notifications' ? null : 'notifications')}
          styles={styles}
          colors={colors}
        />
      )}

      {matches('workmode', 'Режим работы') && (
        <SettingsSection
          title="Режим работы"
          icon="access-point-network"
          summary={pushMode ? 'Пуш-режим' : 'Обычный опрос'}
          expanded={searchActive ? true : openSection === 'workmode'}
          onToggle={() => setOpenSection(openSection === 'workmode' ? null : 'workmode')}
          styles={styles}
          colors={colors}>
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
        </SettingsSection>
      )}

      {matches('widget', 'Плавающий виджет') && (
        <SettingsSection
          title="Плавающий виджет"
          icon="widgets-outline"
          summary={floatingWidgetEnabled ? 'Включён' : 'Выключен'}
          expanded={searchActive ? true : openSection === 'widget'}
          onToggle={() => setOpenSection(openSection === 'widget' ? null : 'widget')}
          styles={styles}
          colors={colors}>
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
        </SettingsSection>
      )}

      {matches('appearance', 'Оформление') && (
        <SettingsSection
          title="Оформление"
          icon="palette-outline"
          summary={themeMode === 'system' ? 'Системная' : themeMode === 'dark' ? 'Тёмная' : 'Светлая'}
          expanded={searchActive ? true : openSection === 'appearance'}
          onToggle={() => setOpenSection(openSection === 'appearance' ? null : 'appearance')}
          styles={styles}
          colors={colors}>
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
        </SettingsSection>
      )}

      {matches('accounts', 'Аккаунты') && (
        <SettingsSection
          title="Аккаунты"
          icon="account-multiple-outline"
          summary={accounts.length === 0 ? 'Нет аккаунтов' : `${accounts.length}`}
          expanded={searchActive ? true : openSection === 'accounts'}
          onToggle={() => setOpenSection(openSection === 'accounts' ? null : 'accounts')}
          styles={styles}
          colors={colors}>
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
        </SettingsSection>
      )}

      {matches('service', 'Сервис') && (
        <SettingsSection
          title="Сервис"
          icon="tools"
          summary="Диагностика и кэш"
          expanded={searchActive ? true : openSection === 'service'}
          onToggle={() => setOpenSection(openSection === 'service' ? null : 'service')}
          styles={styles}
          colors={colors}>
          {onHealth && (
            <Button
              mode="outlined"
              style={styles.btn}
              icon="heart-pulse"
              onPress={onHealth}>
              Здоровье синхронизации
            </Button>
          )}
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
              Отправить лог
            </Button>
          )}
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
        </SettingsSection>
      )}
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
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12},
  searchInput: {flex: 1},
  section: {fontWeight: '600', marginBottom: 12},
  empty: {color: c.textTertiary, marginBottom: 16},
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 0,
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
  quietRow: {flexDirection: 'row', gap: 8, marginBottom: 12},
  quietInput: {flex: 1},
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 0,
  },
  switchInfo: {flex: 1},
  switchLabel: {fontWeight: '600'},
  switchHint: {fontSize: 12, color: c.textTertiary, marginTop: 2},
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    elevation: 0,
  },
  sectionCard: {
    backgroundColor: c.surface,
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  sectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.chipDefault,
  },
  sectionInfo: {flex: 1},
  sectionTitle: {fontWeight: '600', fontSize: 15},
  sectionSummary: {fontSize: 12, color: c.textTertiary, marginTop: 2},
  sectionBody: {paddingHorizontal: 14, paddingBottom: 14},
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

export type SettingsStyles = ReturnType<typeof createStyles>;
