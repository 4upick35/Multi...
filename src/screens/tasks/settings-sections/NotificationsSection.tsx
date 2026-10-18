import React, {useCallback, useEffect, useState} from 'react';
import {Alert, View} from 'react-native';
import {Chip, Switch, Text, TextInput} from 'react-native-paper';
import {useAuthStore} from '../../../store/auth-store';
import {useSettingsStore} from '../../../store/settings-store';
import AccountAvatar from '../../../components/AccountAvatar';
import {requestNotificationPermission} from '../../../utils/permissions';
import {ALERT_SOUND_OPTIONS, ALERT_VOLUME_OPTIONS} from '../../../config/constants';
import {previewAlertSound} from '../../../native/KeepAlive';
import {SettingsSection} from '../SettingsScreen';
import type {SettingsStyles, ThemeColors} from '../SettingsScreen';

const REPEAT_OPTIONS = [1, 2, 3, 5, 10];

type SoundGroupProps = {
  title: string;
  soundId: string;
  volume: number;
  disabled: boolean;
  styles: SettingsStyles;
  onChangeSound: (id: string) => void;
  onChangeVolume: (value: number) => void;
};

function AlertSoundGroup({
  title,
  soundId,
  volume,
  disabled,
  styles,
  onChangeSound,
  onChangeVolume,
}: SoundGroupProps) {
  return (
    <View>
      <Text style={styles.label}>{title}</Text>
      <View style={styles.chipRow}>
        {ALERT_SOUND_OPTIONS.map((option) => {
          const selected = soundId === option.id;
          return (
            <Chip
              key={option.id}
              selected={selected}
              disabled={disabled}
              onPress={() => onChangeSound(option.id)}
              style={[styles.chip, selected && styles.chipActive]}
              textStyle={selected ? styles.chipTextActive : undefined}>
              {option.label}
            </Chip>
          );
        })}
        <Chip icon="play" disabled={disabled} onPress={() => previewAlertSound(soundId, volume)}>
          Прослушать
        </Chip>
      </View>
      <Text style={styles.label}>Громкость: {volume}</Text>
      <View style={styles.chipRow}>
        {ALERT_VOLUME_OPTIONS.map((value) => {
          const selected = volume === value;
          return (
            <Chip
              key={value}
              selected={selected}
              disabled={disabled}
              onPress={() => onChangeVolume(value)}
              style={[styles.chip, selected && styles.chipActive]}
              textStyle={selected ? styles.chipTextActive : undefined}>
              {value}
            </Chip>
          );
        })}
      </View>
    </View>
  );
}

export default function NotificationsSection({
  expanded,
  onToggle,
  styles,
  colors,
}: {
  expanded: boolean;
  onToggle: () => void;
  styles: SettingsStyles;
  colors: ThemeColors;
}) {
  const accounts = useAuthStore((s) => s.accounts);
  const hydrated = useSettingsStore((s) => s.hydrated);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const notifyNewTasks = useSettingsStore((s) => s.notifyNewTasks);
  const notifyNewApplications = useSettingsStore((s) => s.notifyNewApplications);
  const notifyStatusChangesApplications = useSettingsStore(
    (s) => s.notifyStatusChangesApplications,
  );
  const notifyStatusChangesTasks = useSettingsStore((s) => s.notifyStatusChangesTasks);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const vibrationEnabled = useSettingsStore((s) => s.vibrationEnabled);
  const alertRepeatCount = useSettingsStore((s) => s.alertRepeatCount);
  const newApplicationSoundId = useSettingsStore((s) => s.newApplicationSoundId);
  const newApplicationVolume = useSettingsStore((s) => s.newApplicationVolume);
  const otherSoundId = useSettingsStore((s) => s.otherSoundId);
  const otherVolume = useSettingsStore((s) => s.otherVolume);
  const quietHoursEnabled = useSettingsStore((s) => s.quietHoursEnabled);
  const quietHoursFrom = useSettingsStore((s) => s.quietHoursFrom);
  const quietHoursTo = useSettingsStore((s) => s.quietHoursTo);
  const notificationDisabledAccountIds = useSettingsStore(
    (s) => s.notificationDisabledAccountIds,
  );
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [quietFromInput, setQuietFromInput] = useState(quietHoursFrom);
  const [quietToInput, setQuietToInput] = useState(quietHoursTo);

  useEffect(() => {
    setQuietFromInput(quietHoursFrom);
  }, [quietHoursFrom]);

  useEffect(() => {
    setQuietToInput(quietHoursTo);
  }, [quietHoursTo]);

  // Коммит времени тихих часов по onBlur: неполный ввод («2», «22:») откатывается
  // к сохранённому значению — в стор попадает только HH:MM по регулярке.
  const commitQuietTime = useCallback(
    (kind: 'from' | 'to') => {
      const value = (kind === 'from' ? quietFromInput : quietToInput).trim();
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        updateSettings(kind === 'from' ? {quietHoursFrom: value} : {quietHoursTo: value});
        return;
      }
      if (kind === 'from') {
        setQuietFromInput(quietHoursFrom);
      } else {
        setQuietToInput(quietHoursTo);
      }
    },
    [quietFromInput, quietToInput, quietHoursFrom, quietHoursTo, updateSettings],
  );

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

  const handleToggleAccountNotifications = useCallback(
    (accId: string, checked: boolean) => {
      const next = checked
        ? notificationDisabledAccountIds.filter((id) => id !== accId)
        : [...notificationDisabledAccountIds, accId];
      updateSettings({notificationDisabledAccountIds: next});
    },
    [notificationDisabledAccountIds, updateSettings],
  );

  return (
    <SettingsSection
      title="Уведомления"
      icon="bell-ring-outline"
      summary={notificationsEnabled ? 'Включены' : 'Выключены'}
      expanded={expanded}
      onToggle={onToggle}
      styles={styles}
      colors={colors}>
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
      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text style={styles.switchLabel}>Тихие часы</Text>
          <Text style={styles.switchHint}>
            Без звука и вибрации в указанный период (уведомления показываются тихо)
          </Text>
        </View>
        <Switch
          value={hydrated && quietHoursEnabled}
          onValueChange={(val) => updateSettings({quietHoursEnabled: val})}
          disabled={!notificationsEnabled}
        />
      </View>
      <View style={styles.quietRow}>
        <TextInput
          label="С"
          value={quietFromInput}
          onChangeText={setQuietFromInput}
          onBlur={() => commitQuietTime('from')}
          mode="outlined"
          style={styles.quietInput}
          keyboardType="numbers-and-punctuation"
          disabled={!notificationsEnabled || !quietHoursEnabled}
        />
        <TextInput
          label="До"
          value={quietToInput}
          onChangeText={setQuietToInput}
          onBlur={() => commitQuietTime('to')}
          mode="outlined"
          style={styles.quietInput}
          keyboardType="numbers-and-punctuation"
          disabled={!notificationsEnabled || !quietHoursEnabled}
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

      <Text style={styles.label}>Звук по группам уведомлений</Text>
      <AlertSoundGroup
        title="Поступила новая заявка"
        soundId={newApplicationSoundId}
        volume={newApplicationVolume}
        disabled={!notificationsEnabled || !soundEnabled}
        styles={styles}
        onChangeSound={(id) => updateSettings({newApplicationSoundId: id})}
        onChangeVolume={(value) => updateSettings({newApplicationVolume: value})}
      />
      <AlertSoundGroup
        title="Остальные уведомления"
        soundId={otherSoundId}
        volume={otherVolume}
        disabled={!notificationsEnabled || !soundEnabled}
        styles={styles}
        onChangeSound={(id) => updateSettings({otherSoundId: id})}
        onChangeVolume={(value) => updateSettings({otherVolume: value})}
      />
      {accounts.length > 0 && (
        <View style={styles.priorityBlock}>
          <Text style={styles.label}>Уведомления по учёткам</Text>
          <Text style={styles.switchHint}>
            Выключенные учётки не показывают уведомления
          </Text>
          {accounts.map((acc) => {
            const checked = !notificationDisabledAccountIds.includes(acc.id);
            return (
              <View key={acc.id} style={styles.priorityRow}>
                <AccountAvatar name={acc.name} color={acc.color} size={20} />
                <Text style={styles.syncText}>{acc.name}</Text>
                <Switch
                  testID={'notify-account-' + acc.id}
                  value={checked}
                  onValueChange={(val) => handleToggleAccountNotifications(acc.id, val)}
                  disabled={!notificationsEnabled}
                />
              </View>
            );
          })}
        </View>
      )}
    </SettingsSection>
  );
}
