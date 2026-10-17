import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {useAppTheme} from '../../theme';
import {View, StyleSheet, FlatList, RefreshControl} from 'react-native';
import {Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  COLLECTIONS, CollectionMeta,
  MASTER_SERVICE_COLLECTIONS,
  MASTER_SERVICE_BUTTONS, ServiceButtons,
} from '../../types/customer-service';
import {loadCollection} from '../../services/customer-service';
import {refreshApplicationsNow, isApplicationsSyncRunning, startApplicationsSync} from '../../services/applications-sync';
import {useCustomerServiceStore} from '../../store/customer-service-store';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useRefresh} from '../../hooks/useRefresh';
import {getRemainingPauseMs} from '../../infrastructure/AccountThrottle';
import AccountSelector from '../../components/AccountSelector';
import {useAuthStore} from '../../store/auth-store';
import {useSettingsStore} from '../../store/settings-store';
import PressScale from '../../components/PressScale';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

type Props = {
  onSelectCollection: (collection: CollectionMeta) => void;
  onFeed?: () => void;
  onWorkCalendar?: () => void;
  onAppealsDirectories?: () => void;
  onDocflow?: () => void;
};

export default function CustomerServiceScreen({onSelectCollection, onFeed, onWorkCalendar, onAppealsDirectories, onDocflow}: Props) {
  const {account: activeAccount, accountId: resolvedAccountId, accounts} = useActiveAccount();
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const modeCollectionKeys = useMemo(() => MASTER_SERVICE_COLLECTIONS, []);

  const modeButtons: ServiceButtons = useMemo(() => MASTER_SERVICE_BUTTONS, []);

  const visibleCollections = useMemo(() => {
    const keySet = new Set(modeCollectionKeys);
    return COLLECTIONS.filter((c) => keySet.has(c.key));
  }, [modeCollectionKeys]);

  // Подписываемся на syncStates, чтобы перерендеривать при изменении статусов
  const syncStates = useCustomerServiceStore((s) => s.syncStates);

  // Фильтруем коллекции с учётом доступа выбранной учётки
  const accessibleCollections = useMemo(() => {
    return visibleCollections.filter((col) => {
      if (resolvedAccountId) {
        const ss = syncStates[resolvedAccountId]?.[col.key];
        const items = useCustomerServiceStore.getState().getItems(resolvedAccountId, col.key);
        if (!ss || ss.status === 'idle' || ss.status === 'loading') {
          return true;
        }
        if (ss.accessDenied === true && items.length === 0) {
          return false;
        }
        return true;
      }
      const allDenied = accounts.length > 0 && accounts.every((acc) => {
        const ss = syncStates[acc.id]?.[col.key];
        const items = useCustomerServiceStore.getState().getItems(acc.id, col.key);
        if (!ss || ss.status === 'idle' || ss.status === 'loading') {
          return false;
        }
        if (ss.accessDenied === true && items.length === 0) {
          return true;
        }
        return ss.accessDenied === true;
      });
      return !allDenied;
    });
  }, [visibleCollections, resolvedAccountId, accounts, syncStates]);

  // Состав учёток (id), а не ссылка на массив: обновление token/cookies меняет
  // ссылку accounts и раньше перезапускало загрузку всех коллекций.
  const accountsKey = useMemo(() => accounts.map(a => a.id).join('|'), [accounts]);

  const loadData = useCallback(async () => {
    const freshAccounts = useAuthStore.getState().accounts;
    if (freshAccounts.length === 0) {
      return;
    }
    if (resolvedAccountId) {
      const account = freshAccounts.find(a => a.id === resolvedAccountId);
      if (account) {
        await Promise.allSettled(
          visibleCollections.map((col) => loadCollection(account, col.key)),
        );
      }
    } else {
      await Promise.allSettled(
        freshAccounts.map((acc) =>
          Promise.allSettled(
            visibleCollections.map((col) => loadCollection(acc, col.key)),
          ),
        ),
      );
    }
  }, [resolvedAccountId, accountsKey, visibleCollections]); // eslint-disable-line react-hooks/exhaustive-deps

  const {refreshing, onRefresh} = useRefresh(loadData);

  const lastScreenRefreshRef = useRef(0);
  useEffect(() => {
    if (resolvedAccountId && !useSettingsStore.getState().syncPaused) {
      const now = Date.now();
      if (now - lastScreenRefreshRef.current >= 5_000) {
        lastScreenRefreshRef.current = now;
        refreshApplicationsNow().catch(() => {});
      }
    }
  }, [resolvedAccountId]);

  // При монтировании/возврате на экран: если sync остановлен — запускаем.
  useEffect(() => {
    if (!isApplicationsSyncRunning() && accounts.length > 0 && !useSettingsStore.getState().syncPaused) {
      startApplicationsSync(accounts);
    }
    // accounts намеренно не в зависимостях: обновление token/cookies меняет ссылку массива
    // и перезапускало бы планировщик без необходимости.
  }, [accountsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();
  }, [loadData]);

  const renderSection = ({item}: {item: CollectionMeta}) => {
    let totalCount = 0;
    let isLoading = false;
    let hasError = false;
    let isThrottled = false;

    if (resolvedAccountId) {
      const syncState = useCustomerServiceStore.getState().getCollectionStatus(resolvedAccountId, item.key);
      const items = useCustomerServiceStore.getState().getItems(resolvedAccountId, item.key);
      totalCount = items.length;
      isLoading = syncState?.status === 'loading';
      hasError = syncState?.status === 'error';
      isThrottled = getRemainingPauseMs(resolvedAccountId) > 0;
    } else {
      for (const acc of accounts) {
        const items = useCustomerServiceStore.getState().getItems(acc.id, item.key);
        totalCount += items.length;
        const syncState = useCustomerServiceStore.getState().getCollectionStatus(acc.id, item.key);
        if (syncState?.status === 'loading') { isLoading = true; }
        if (syncState?.status === 'error') { hasError = true; }
        if (getRemainingPauseMs(acc.id) > 0) { isThrottled = true; }
      }
    }

    return (
      <PressScale
        style={styles.sectionCard}
        activeOpacity={0.7}
        scaleTo={0.985}
        onPress={() => onSelectCollection(item)}>
        <View style={styles.sectionIconWrap}>
          <Icon name={item.icon} size={24} color={colors.primary} />
        </View>
        <View style={styles.sectionInfo}>
          <Text style={styles.sectionLabel}>{item.label}</Text>
          <Text style={styles.sectionCount}>
            {isLoading ? 'Загрузка…' : hasError ? 'Ошибка' : totalCount === 0 ? 'Нет данных' : `${totalCount} элементов`}
            {isThrottled ? ' ⚠' : null}
          </Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.textTertiary} />
      </PressScale>
    );
  };

  if (accounts.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Нет подключённых аккаунтов</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <Text variant="titleLarge" style={styles.header}>
          Клиентский сервис
        </Text>

        <AccountSelector showAll />

        <Text style={styles.accountLabel}>
          Аккаунт: {resolvedAccountId ? activeAccount?.name : 'Все аккаунты'}
        </Text>

        {onFeed && modeButtons.feed && (
          <PressScale style={styles.feedBtn} activeOpacity={0.7} scaleTo={0.97} onPress={onFeed}>
            <View style={styles.feedIconWrap}>
              <Icon name="view-list" size={24} color={colors.primary} />
            </View>
            <View style={styles.feedInfo}>
              <Text style={styles.feedLabel}>Лента</Text>
              <Text style={styles.feedHint}>Активность и события</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.textTertiary} />
          </PressScale>
        )}

        {onWorkCalendar && modeButtons.workCalendar && (
          <PressScale style={styles.feedBtn} activeOpacity={0.7} scaleTo={0.97} onPress={onWorkCalendar}>
            <View style={styles.feedIconWrap}>
              <Icon name="calendar-clock" size={24} color={colors.primary} />
            </View>
            <View style={styles.feedInfo}>
              <Text style={styles.feedLabel}>Рабочий календарь</Text>
              <Text style={styles.feedHint}>График работы и перерывы</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.textTertiary} />
          </PressScale>
        )}

        {onAppealsDirectories && modeButtons.appealsDirectories && (
          <PressScale style={styles.feedBtn} activeOpacity={0.7} scaleTo={0.97} onPress={onAppealsDirectories}>
            <View style={styles.feedIconWrap}>
              <Icon name="folder-tree" size={24} color={colors.primary} />
            </View>
            <View style={styles.feedInfo}>
              <Text style={styles.feedLabel}>Категории обращений</Text>
              <Text style={styles.feedHint}>Иерархический справочник</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.textTertiary} />
          </PressScale>
        )}

        {onDocflow && modeButtons.docflow && (
          <PressScale style={styles.feedBtn} activeOpacity={0.7} scaleTo={0.97} onPress={onDocflow}>
            <View style={styles.feedIconWrap}>
              <Icon name="file-check" size={24} color={colors.primary} />
            </View>
            <View style={styles.feedInfo}>
              <Text style={styles.feedLabel}>Согласования</Text>
              <Text style={styles.feedHint}>Документы на согласование</Text>
            </View>
            <Icon name="chevron-right" size={20} color={colors.textTertiary} />
          </PressScale>
        )}
      </View>

      <FlatList
        data={accessibleCollections}
        keyExtractor={(item) => item.key}
        renderItem={renderSection}
        style={styles.flatList}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#6200EE']} />
        }
      />
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  topSection: {flexShrink: 0},
  flatList: {flex: 1},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  header: {
    fontWeight: 'bold',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  accountLabel: {
    fontSize: 13,
    color: c.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  list: {paddingHorizontal: 12, paddingBottom: 80},
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 14,
    marginVertical: 5,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  sectionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.primaryLight15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sectionInfo: {flex: 1},
  sectionLabel: {fontSize: 15, fontWeight: '600', color: c.textPrimary},
  sectionCount: {fontSize: 12, color: c.textTertiary, marginTop: 2},
  emptyText: {fontSize: 16, color: c.textTertiary},
  feedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.primaryLight10,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: c.primaryBorder30,
  },
  feedIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.primaryLight15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  feedInfo: {flex: 1},
  feedLabel: {fontSize: 15, fontWeight: '600', color: c.primary},
  feedHint: {fontSize: 12, color: c.primaryMuted60, marginTop: 2},
});
