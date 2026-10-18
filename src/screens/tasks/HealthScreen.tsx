import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import {useAppTheme} from '../../theme';
import {useNetworkStatus} from '../../hooks/useNetworkStatus';
import {getSyncDiagnostics} from '../../services/applications-sync';
import {useAuthStore} from '../../store/auth-store';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];
type Diagnostics = Awaited<ReturnType<typeof getSyncDiagnostics>>;

type Props = {onBack: () => void};

const REFRESH_INTERVAL_MS = 2000;

function formatAgo(ts: number): string {
  if (!ts) {
    return '—';
  }
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 1000) {
    return 'только что';
  }
  if (diff < 60000) {
    return `${Math.round(diff / 1000)} с назад`;
  }
  const minutes = Math.floor(diff / 60000);
  return `${minutes} мин назад`;
}

export default function HealthScreen({onBack}: Props) {
  const {colors} = useAppTheme();
  const styles = createStyles(colors);
  const online = useNetworkStatus();
  const accounts = useAuthStore((s) => s.accounts);
  const [data, setData] = useState<Diagnostics | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await getSyncDiagnostics());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = () => {
      getSyncDiagnostics()
        .then((next) => {
          if (mounted) {
            setData(next);
          }
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const accountName = (id: string): string => {
    const account = accounts.find((a) => a.id === id);
    return account?.name || id;
  };

  const onlineText =
    online === null ? 'Проверка…' : online ? 'Онлайн' : 'Нет сети';
  const onlineColor =
    online === null ? colors.textTertiary : online ? colors.success : '#E53935';

  const hosts = data?.queue.hosts || [];
  const idleEntries = Object.entries(data?.idleSteps || {});

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <BackButton onBack={onBack} />
        <View style={styles.headerRow}>
          <Icon name="heart-pulse" size={22} color={colors.primary} />
          <Text variant="titleLarge" style={styles.headerTitle}>
            Здоровье
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Синхронизация</Text>
          <Row label="Состояние" value={data?.running ? 'Работает' : 'Остановлена'} styles={styles} />
          <Row label="Последний тик" value={data ? formatAgo(data.lastTickAt) : '—'} styles={styles} />
          <Row
            label="Общий опрос"
            value={data?.refreshAllStartedAt ? 'Выполняется' : 'Не выполняется'}
            styles={styles}
          />
          <Row label="Аккаунтов" value={String(data?.accounts ?? accounts.length)} styles={styles} />
          <Row label="Сеть" value={onlineText} valueColor={onlineColor} styles={styles} />
          <Row label="Отложенные действия" value={String(data?.pendingActions ?? 0)} styles={styles} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Очередь запросов</Text>
          <Row label="Хосты" value={String(hosts.length)} styles={styles} />
          <Row label="Запросов в полёте (дедуп)" value={String(data?.queue.inflightGets ?? 0)} styles={styles} />
          <Row label="HTTP-клиентов" value={String(data?.queue.instances ?? 0)} styles={styles} />
          {hosts.length === 0 ? (
            <Text style={styles.empty}>Запросов ещё не было</Text>
          ) : (
            hosts.map((host) => (
              <View key={host.origin} style={styles.hostRow}>
                <Text style={styles.hostName} numberOfLines={1}>
                  {host.origin.replace(/^https?:\/\//, '')}
                </Text>
                <Text style={styles.hostStats}>
                  {host.busy} активн. · {host.pending} в ожидании · {formatAgo(host.lastRequestAt)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Интервалы опроса</Text>
          {idleEntries.length === 0 ? (
            <Text style={styles.empty}>Нет данных — опрос ещё не выполнялся</Text>
          ) : (
            idleEntries.map(([id, steps]) => (
              <Row
                key={id}
                label={accountName(id)}
                value={`${steps} тихих циклов`}
                styles={styles}
              />
            ))
          )}
        </View>

        <Button
          mode="outlined"
          style={styles.refreshBtn}
          loading={refreshing}
          onPress={refresh}>
          Обновить
        </Button>
      </ScrollView>
    </View>
  );
}

function Row({
  label,
  value,
  valueColor,
  styles,
}: {
  label: string;
  value: string;
  valueColor?: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? {color: valueColor} : null]}>
        {value}
      </Text>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: c.background},
    header: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4},
    headerRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
    headerTitle: {fontWeight: 'bold'},
    content: {paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40},
    card: {
      backgroundColor: c.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    },
    cardTitle: {fontWeight: '600', fontSize: 15, color: c.textPrimary, marginBottom: 8},
    row: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 12},
    rowLabel: {color: c.textSecondary, fontSize: 13, flexShrink: 1},
    rowValue: {color: c.textPrimary, fontSize: 13, fontWeight: '500'},
    empty: {color: c.textTertiary, fontSize: 13},
    hostRow: {paddingVertical: 6},
    hostName: {color: c.textPrimary, fontSize: 13, fontWeight: '500'},
    hostStats: {color: c.textSecondary, fontSize: 12, marginTop: 2},
    refreshBtn: {borderRadius: 12},
  });
