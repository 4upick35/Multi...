import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useAppTheme} from '../../theme';
import {View, StyleSheet, FlatList, TouchableOpacity, RefreshControl, TextInput, ScrollView, AppState} from 'react-native';
import {Text, Button, Chip} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import CaptchaModal from '../../components/CaptchaModal';
import {useCustomerServiceStore, EMPTY_COLLECTION_ITEMS} from '../../store/customer-service-store';
import {CollectionMeta, CollectionItem, LARGE_COLLECTIONS} from '../../types/customer-service';
import {loadCollection, loadCollectionPage, searchCollection} from '../../services/customer-service';
import {refreshApplicationsNow, isApplicationsSyncRunning, startApplicationsSync, setForegroundAccounts} from '../../services/applications-sync';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useSettingsStore} from '../../store/settings-store';
import {useAcceptApplication, canAccept} from '../../hooks/useAcceptApplication';
import QuantumLoader from '../../components/QuantumLoader';
import type {ElmaAccount} from '../../types/account';
import {buildShortAddress, sortApplicationsByNumberDesc} from '../../utils/collection-fields';
import {contrastText, mixWithWhite} from '../../utils/color';
import {formatTimeHMS} from '../../utils/datetime';
import {logDiag} from '../../diag/accept-log';
import {getRemainingPauseMs} from '../../infrastructure/AccountThrottle';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

type Props = {
  collection: CollectionMeta;
  initialAccountId?: string | null;
  /** Меняется при каждом переходе по уведомлению: заставляет применить фильтр заново. */
  filterSeq?: number;
  onSelectItem: (item: CollectionItem) => void;
  onBack: () => void;
};

export default function CollectionListScreen({collection, initialAccountId, filterSeq, onSelectItem, onBack}: Props) {
  const {account: activeAccount, accountId: resolvedAccountId, accounts} = useActiveAccount();
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const activeAccountId = resolvedAccountId;
  const currentAccount = activeAccount || (activeAccountId ? accounts.find(a => a.id === activeAccountId) : null);

  const isApplications = collection.key === 'applications';
  const syncPaused = useSettingsStore(s => s.syncPaused);

  // Локальный фильтр учётки: null = Все, string = конкретная учётка.
  const [filterAccountId, setFilterAccountId] = useState<string | null>(activeAccountId ?? null);

  // Фильтр учётки из уведомления: применяем, когда экран открыт по тапу на уведомление.
  useEffect(() => {
    if (initialAccountId) {
      setFilterAccountId(initialAccountId);
    }
  }, [initialAccountId, filterSeq]);

  const acceptFlow = useAcceptApplication(
    useCallback((acc: ElmaAccount) => {
      loadCollection(acc, collection.key);
    }, [collection.key]),
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const listRef = useRef<FlatList<CollectionItem>>(null);
  const isLargeCollection = collection.key in LARGE_COLLECTIONS;

  // Стабильные селекторы стора (без условий — не пересоздаются на каждом рендере).
  const itemsByAccount = useCustomerServiceStore((s) => s.itemsByAccount);
  const syncStatesByAccount = useCustomerServiceStore((s) => s.syncStates);

  const accountIds = useMemo(() => accounts.map(a => a.id), [accounts]);

  const lastRefreshAt = useCustomerServiceStore(s => s.lastRefreshAt);

  // Собираем итоговый список items через useMemo (не внутри селектора).
  const items = useMemo(() => {
    if (filterAccountId) {
      return itemsByAccount[filterAccountId]?.[collection.key] ?? EMPTY_COLLECTION_ITEMS;
    }
    const allItems: CollectionItem[] = [];
    for (const id of accountIds) {
      const accItems = itemsByAccount[id]?.[collection.key];
      if (accItems && accItems.length > 0) {
        allItems.push(...accItems);
      }
    }
    return allItems;
  }, [itemsByAccount, filterAccountId, accountIds, collection.key]);

  const syncState = useMemo(() => {
    if (filterAccountId) {
      return syncStatesByAccount[filterAccountId]?.[collection.key];
    }
    for (const id of accountIds) {
      const st = syncStatesByAccount[id]?.[collection.key];
      if (st?.status === 'loading') { return st; }
      if (st?.status === 'ok') { return st; }
    }
    return undefined;
  }, [syncStatesByAccount, filterAccountId, accountIds, collection.key]);

  const itemsList = items ?? EMPTY_COLLECTION_ITEMS;
  const isLoading = syncState?.status === 'loading';
  const hasError = syncState?.status === 'error';
  const errorMsg = syncState?.error;
  const total = syncState?.total ?? 0;
  const hasMore = syncState?.hasMore ?? false;

  const filteredItems = useMemo(() => {
    let result = itemsList;

    // Для больших коллекций поиск идёт через сервер (tf-фильтр)
    if (isLargeCollection) {
      return result;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return result;
    }
    return result.filter((item) => {
      const raw = item.raw || {};
      const name = String(item.name || '').toLowerCase();
      const userName = String(raw.userName || raw.UserName || raw.username || '').toLowerCase();
      const email = String(raw.email || raw.Email || raw.mail || '').toLowerCase();
      return name.includes(q) || userName.includes(q) || email.includes(q);
    });
  }, [itemsList, searchQuery, isLargeCollection]);

  const statusOptions = useMemo(() => {
    if (!isApplications) {
      return [];
    }
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of itemsList) {
      const s = item.status;
      if (s && !seen.has(s)) {
        seen.add(s);
        list.push(s);
      }
    }
    return list.slice(0, 12);
  }, [itemsList, isApplications]);

  useEffect(() => {
    if (statusFilter && !statusOptions.includes(statusFilter)) {
      setStatusFilter(null);
    }
  }, [statusFilter, statusOptions]);

  // При монтировании/возврате на экран заявок: если sync остановлен — запускаем.
  useEffect(() => {
    if (!isApplicationsSyncRunning() && accounts.length > 0 && !syncPaused) {
      startApplicationsSync(accounts);
    }
    // accounts намеренно не в зависимостях: обновление token/cookies меняет ссылку массива
    // и перезапускало бы планировщик без необходимости.
  }, [isApplications, accounts.length, syncPaused]); // eslint-disable-line react-hooks/exhaustive-deps

  // Возврат на экран заявок: обновляем выбранную учётку, но не чаще 1 раза в 5 с.
  const lastScreenRefreshRef = useRef(0);
  useEffect(() => {
    if (isApplications && !syncPaused) {
      const now = Date.now();
      if (now - lastScreenRefreshRef.current >= 5_000) {
        lastScreenRefreshRef.current = now;
        refreshApplicationsNow().catch(() => {});
      }
    }
  }, [isApplications, syncPaused]);

  const statusFilteredItems = useMemo(() => {
    if (!isApplications || !statusFilter) {
      return filteredItems;
    }
    return filteredItems.filter((item) => item.status === statusFilter);
  }, [filteredItems, isApplications, statusFilter]);

  const displayItems: CollectionItem[] = useMemo(() => {
    if (!isApplications) {
      return statusFilteredItems;
    }
    const acceptItems: CollectionItem[] = [];
    const rest: CollectionItem[] = [];
    for (const item of statusFilteredItems) {
      if (canAccept(item.raw || {})) {
        acceptItems.push(item);
      } else {
        rest.push(item);
      }
    }
    if (acceptItems.length === 0) {
      return sortApplicationsByNumberDesc(statusFilteredItems);
    }
    return [...sortApplicationsByNumberDesc(acceptItems), ...sortApplicationsByNumberDesc(rest)];
  }, [statusFilteredItems, isApplications]);

  useEffect(() => {
    // При смене аккаунта список должен начинаться с начала,
    // иначе кажется, что в списке остались данные предыдущего аккаунта.
    listRef.current?.scrollToOffset({offset: 0, animated: false});
  }, [filterAccountId]);

  useEffect(() => {
    logDiag(
      'list',
      'collection=' + collection.key +
        ' mode=' + (filterAccountId ? 'one' : 'all') +
        ' stored=' + itemsList.length +
        ' shown=' + displayItems.length,
    );
  }, [collection.key, filterAccountId, itemsList.length, displayItems.length]);

  // ---------- Загрузка данных ----------

  const pollIntervalSec = useSettingsStore(s => s.pollIntervalSec);
  const pollJitterMs = Math.round(pollIntervalSec * 1000 * 0.5);

  // Индикатор: для applications — статус из стора; для остальных — только ручной свайп
  const visibleAccountId = filterAccountId ?? accountIds[0] ?? '';
  const remainingPauseMs = getRemainingPauseMs(visibleAccountId);
  const isThrottled = remainingPauseMs > 0;
  const throttleMinutes = Math.ceil(remainingPauseMs / 60_000);
  const visibleSyncState = useCustomerServiceStore(
    visibleAccountId
      ? (s) => s.syncStates[visibleAccountId]?.applications
      : () => undefined,
  );
  const appRefreshing = isApplications ? (visibleSyncState?.status === 'loading') : false;
  const [manualInFlight, setManualInFlight] = useState(false);
  const refreshing = appRefreshing || manualInFlight;

  // Состояние приложения: ускоренный опрос только на переднем плане.
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  // Ускоренный опрос видимых учёток, пока открыт список заявок.
  // В режиме «все аккаунты» — все учётки, при активном фильтре — только выбранная.
  useEffect(() => {
    if (isApplications && appState === 'active' && !syncPaused) {
      setForegroundAccounts(filterAccountId ? [filterAccountId] : accountIds);
    } else {
      setForegroundAccounts([]);
    }
    return () => {
      setForegroundAccounts([]);
    };
  }, [isApplications, appState, syncPaused, filterAccountId, accountIds]);

  // Ручной свайп
  const onRefresh = useCallback(async () => {
    setManualInFlight(true);
    try {
      if (isApplications) {
        await refreshApplicationsNow();
      } else {
        await Promise.all(accounts.map((acc) => loadCollection(acc, collection.key)));
      }
    } finally {
      setManualInFlight(false);
    }
  }, [isApplications, accounts, collection.key]);

  // Первичная загрузка для коллекций кроме applications (при монтировании/смене коллекции)
  const initialLoadDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isApplications || accounts.length === 0) {
      return;
    }
    if (initialLoadDoneRef.current.has(collection.key)) {
      return;
    }
    initialLoadDoneRef.current.add(collection.key);

    (async () => {
      for (let i = 0; i < accounts.length; i++) {
        await loadCollection(accounts[i], collection.key);
        if (i < accounts.length - 1) {
          await new Promise(r => setTimeout(r, Math.floor(Math.random() * pollJitterMs)));
        }
      }
    })();
  }, [isApplications, accounts, collection.key, pollJitterMs]);

  // ---------- Пагинация ----------

  const onLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !filterAccountId) {
      return;
    }
    const acc = accounts.find(a => a.id === filterAccountId);
    if (!acc) {
      return;
    }
    setIsLoadingMore(true);
    const currentItems = useCustomerServiceStore.getState().getItems(filterAccountId, collection.key);
    await loadCollectionPage(acc, collection.key, currentItems.length);
    setIsLoadingMore(false);
  }, [isLoadingMore, hasMore, filterAccountId, accounts, collection.key]);

  // ---------- Серверный поиск ----------

  const onServerSearch = useCallback(async (text: string) => {
    setSearchQuery(text);
    if (!isLargeCollection || !filterAccountId) {
      return;
    }
    const acc = accounts.find(a => a.id === filterAccountId);
    if (!acc) {
      return;
    }
    if (text.trim().length === 0) {
      await loadCollection(acc, collection.key);
      return;
    }
    await searchCollection(acc, collection.key, text);
  }, [isLargeCollection, filterAccountId, accounts, collection.key]);

  // ---------- Рендер ----------

  const renderItem = ({item}: {item: CollectionItem}) => {
    const itemAccount = item.accountId ? (accounts.find(a => a.id === item.accountId) ?? null) : null;
    const address = isApplications ? buildShortAddress(item.raw) : '';

    const showAcceptButton = isApplications && itemAccount != null && canAccept(item.raw);
    const isProcessing = acceptFlow.flowState !== 'idle' && acceptFlow.flowState !== 'done' && acceptFlow.flowState !== 'error';

    return (
      <View>
        <TouchableOpacity
          style={styles.itemCard}
          activeOpacity={0.7}
          onPress={() => onSelectItem(item)}>
          <View style={styles.itemContent}>
            {filterAccountId === null && itemAccount && (
              <View style={[styles.itemAccountBadge, {backgroundColor: itemAccount.color}]}>
                <Text style={[styles.itemAccountBadgeText, {color: contrastText(itemAccount.color)}]}>
                  {item.name || '?'}
                </Text>
              </View>
            )}
            {!(filterAccountId === null && itemAccount) && (
              <Text style={styles.itemName} numberOfLines={2}>
                {item.name || '(без названия)'}
              </Text>
            )}
            {address ? (
              <Text style={styles.itemAddress} numberOfLines={2}>
                {address}
              </Text>
            ) : null}
            {item.status ? (
              <Chip compact style={[styles.statusChip, item.statusColor ? {backgroundColor: item.statusColor + '20'} : undefined]} textStyle={[styles.statusText, item.statusColor ? {color: item.statusColor} : undefined]}>
                {item.status}
              </Chip>
            ) : null}
          </View>
          {item.createdAt ? (
            <Text style={styles.itemDate}>
              {new Date(item.createdAt).toLocaleDateString('ru')}
            </Text>
          ) : null}
          <Icon name="chevron-right" size={18} color={colors.muted} />
        </TouchableOpacity>
        {showAcceptButton && (
          <TouchableOpacity
            style={styles.acceptBtn}
            disabled={isProcessing}
            onPress={() => {
              if (itemAccount) {
                acceptFlow.accept(item.id, itemAccount);
              }
            }}>
            {isProcessing ? (
              <QuantumLoader size={20} color="#fff" />
            ) : (
              <Icon name="check-circle-outline" size={16} color="#fff" />
            )}
            <Text style={styles.acceptBtnText}>
              {isProcessing ? 'Выполняется…' : 'Принять'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderFooter = () => {
    if (!hasMore && itemsList.length > 0) {
      return (
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            {total > 0 ? `Показано ${itemsList.length} из ${total}` : `Всего: ${itemsList.length}`}
          </Text>
        </View>
      );
    }
    if (isLoadingMore) {
      return (
        <View style={styles.footer}>
          <QuantumLoader size={20} color={colors.primary} />
          <Text style={styles.footerText}>Загрузка ещё…</Text>
        </View>
      );
    }
    if (hasMore && itemsList.length > 0) {
      return (
        <TouchableOpacity style={styles.loadMoreBtn} onPress={onLoadMore}>
          <Text style={styles.loadMoreText}>Загрузить ещё</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <BackButton onBack={onBack} />
        <Icon name={collection.icon} size={20} color={colors.primary} />
        <Text variant="titleMedium" style={styles.headerTitle}>
          {collection.label}
        </Text>
        {isApplications && (
          <TouchableOpacity
            style={[
              styles.pauseButtonDefault,
              syncPaused ? styles.pauseButtonPaused : styles.pauseButtonRunning,
            ]}
            onPress={() => useSettingsStore.getState().updateSettings({syncPaused: !syncPaused})}
          >
            <Icon
              name={syncPaused ? 'play' : 'pause'}
              size={20}
              color={syncPaused ? contrastText(colors.warning) : colors.primary}
            />
          </TouchableOpacity>
        )}
      </View>

      {currentAccount && (
        <CaptchaModal
          visible={acceptFlow.captchaVisible}
          siteKey={acceptFlow.captchaSiteKey}
          baseUrl={currentAccount.baseUrl}
          onSuccess={acceptFlow.onCaptchaSuccess}
          onExpired={acceptFlow.onCaptchaExpired}
          onError={acceptFlow.onCaptchaError}
          onCancel={acceptFlow.onCaptchaCancel}
        />
      )}

      {filterAccountId && accounts.find(a => a.id === filterAccountId) ? (
        <Text style={styles.accountLabel}>
          Аккаунт: {accounts.find(a => a.id === filterAccountId)?.name}
        </Text>
      ) : (
        <Text style={styles.accountLabel}>Аккаунт: Все аккаунты</Text>
      )}

      {accounts.length <= 1 && currentAccount && lastRefreshAt[currentAccount.id] && (
        <Text style={[styles.lastUpdatedLabel, {color: currentAccount.color}]}>
          Обновлено: {formatTimeHMS(new Date(lastRefreshAt[currentAccount.id]))}
        </Text>
      )}

      {accounts.length > 1 && (
        <View style={styles.accountChipsWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.accountChipsRow}>
            <TouchableOpacity
              style={[styles.accountFilterChip, !filterAccountId && styles.accountFilterChipAll]}
              onPress={() => setFilterAccountId(null)}>
              <Text style={[styles.accountFilterChipText, !filterAccountId && styles.accountFilterChipTextActive]}>
                Все
              </Text>
            </TouchableOpacity>
            {accounts.map((acc) => {
              const active = filterAccountId === acc.id;
              const accTs = lastRefreshAt[acc.id];
              return (
                <TouchableOpacity
                  key={acc.id}
                  style={[
                    styles.accountFilterChip,
                    active
                      ? {backgroundColor: acc.color}
                      : {backgroundColor: mixWithWhite(acc.color, 0.7)},
                  ]}
                  onPress={() => setFilterAccountId(active ? null : acc.id)}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.accountFilterChipText,
                      {color: active ? contrastText(acc.color) : colors.textPrimary},
                    ]}>
                    {acc.name}
                  </Text>
                  {accTs ? (
                    <Text
                      style={[
                        styles.accountFilterChipTime,
                        {color: active ? contrastText(acc.color) : acc.color},
                      ]}>
                      {formatTimeHMS(new Date(accTs))}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {hasError ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{errorMsg || 'Ошибка загрузки'}</Text>
          <Button mode="outlined" onPress={onRefresh} style={styles.retryBtn} compact>
            Повторить
          </Button>
        </View>
      ) : null}

      {isThrottled ? (
        <View style={styles.throttleBlock}>
          <Text style={styles.throttleText}>
            Сервер временно ограничил запросы, повтор через {throttleMinutes} мин
          </Text>
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <Icon name="magnify" size={18} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder={isLargeCollection ? 'Поиск по серверу…' : 'Поиск по имени, логину, email…'}
          placeholderTextColor={colors.textTertiary}
          value={searchQuery}
          onChangeText={onServerSearch}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => onServerSearch('')}>
            <Icon name="close-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {isApplications && statusOptions.length > 1 && (
        <View style={styles.statusFilterWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.statusFilterRow}>
            <TouchableOpacity
              style={[styles.statusFilterChip, statusFilter === null && styles.statusFilterChipActive]}
              onPress={() => setStatusFilter(null)}>
              <Text style={[styles.statusFilterChipText, statusFilter === null && styles.statusFilterChipTextActive]}>
                Все
              </Text>
            </TouchableOpacity>
            {statusOptions.map((s) => {
              const active = statusFilter === s;
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusFilterChip, active && styles.statusFilterChipActive]}
                  onPress={() => setStatusFilter(active ? null : s)}>
                  <Text
                    numberOfLines={1}
                    style={[styles.statusFilterChipText, active && styles.statusFilterChipTextActive]}>
                    {s}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <FlatList
        key={'applications-list:' + (filterAccountId ?? 'all')}
        ref={listRef}
        extraData={filterAccountId}
        style={styles.flatList}
        data={displayItems}
        keyExtractor={(item) => String(item.accountId || '') + ':' + item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            progressBackgroundColor={colors.surface}
            progressViewOffset={8}
          />
        }
        ListFooterComponent={renderFooter()}
        ListEmptyComponent={
          !refreshing && !isLoading && !hasError ? (
            <View style={styles.empty}>
              <Icon name="file-document-outline" size={48} color={colors.muted} />
              <Text style={styles.emptyText}>Нет данных</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    gap: 6,
    flexShrink: 0,
  },
  headerTitle: {fontWeight: '600', flex: 1},
  accountLabel: {
    fontSize: 13,
    color: c.textSecondary,
    paddingHorizontal: 16,
    marginBottom: 4,
    flexShrink: 0,
  },
  lastUpdatedLabel: {
    fontSize: 12,
    color: c.textTertiary,
    paddingHorizontal: 16,
    marginBottom: 4,
    flexShrink: 0,
  },
  list: {paddingHorizontal: 12, paddingBottom: 80},
  flatList: {flex: 1},
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 10,
    padding: 14,
    marginVertical: 4,
    elevation: 1,
  },
  itemContent: {flex: 1},
  itemAccountBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 4,
  },
  itemAccountBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  itemName: {fontSize: 14, fontWeight: '500', color: c.textPrimary},
  itemAddress: {fontSize: 12, color: c.muted, marginTop: 2},
  statusChip: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: c.chipDefault,
    flexShrink: 1,
  },
  statusText: {fontSize: 11},
  itemDate: {fontSize: 12, color: c.textTertiary, marginRight: 8},
  errorBlock: {
    alignItems: 'center',
    padding: 16,
    flexShrink: 0,
  },
  throttleBlock: {
    alignItems: 'center',
    padding: 10,
    flexShrink: 0,
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  throttleText: {fontSize: 13, color: '#856404', textAlign: 'center'},
  errorText: {fontSize: 14, color: c.error, marginBottom: 8, textAlign: 'center'},
  retryBtn: {borderRadius: 8},
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    height: 40,
    elevation: 1,
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: c.textPrimary,
    marginLeft: 8,
    paddingVertical: 0,
  },
  empty: {alignItems: 'center', marginTop: 80},
  emptyText: {fontSize: 16, color: c.textTertiary, marginTop: 8},
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  footerText: {fontSize: 12, color: c.textTertiary},
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginHorizontal: 12,
    marginVertical: 8,
    backgroundColor: c.primaryLight15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.primaryBorder30,
  },
  loadMoreText: {fontSize: 14, color: c.primary, fontWeight: '500'},
  acceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.acceptedBg,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    marginHorizontal: 4,
    gap: 6,
  },
  acceptBtnText: {
    color: c.onBackground,
    fontSize: 13,
    fontWeight: '600',
  },
  accountChipsWrap: {
    height: 56,
    overflow: 'hidden',
    flexShrink: 0,
  },
  accountChipsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    alignItems: 'center',
  },
  accountFilterChip: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: c.chipDefault,
    minHeight: 32,
  },
  accountFilterChipAll: {
    backgroundColor: c.primary,
  },
  accountFilterChipText: {
    fontSize: 12,
    color: c.textPrimary,
  },
  accountFilterChipTextActive: {
    color: c.onBackground,
  },
  accountFilterChipTime: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  pauseButtonDefault: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseButtonPaused: {
    backgroundColor: c.warning,
  },
  pauseButtonRunning: {
    backgroundColor: 'transparent',
  },
  statusFilterWrap: {flexShrink: 0, marginBottom: 4},
  statusFilterRow: {paddingHorizontal: 12, gap: 6, alignItems: 'center'},
  statusFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: c.chipDefault,
  },
  statusFilterChipActive: {backgroundColor: c.primary},
  statusFilterChipText: {fontSize: 12, color: c.textPrimary},
  statusFilterChipTextActive: {color: contrastText(c.primary), fontWeight: '600'},
});
