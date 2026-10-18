import React, {useMemo, useState, useCallback} from 'react';
import {View, StyleSheet, FlatList, TouchableOpacity, TextInput, RefreshControl, Platform} from 'react-native';
import {Text, Chip, Button} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTasksStore} from '../../store/tasks-store';
import {useAuthStore} from '../../store/auth-store';
import {useUiStore} from '../../store/ui-store';
import {useAppTheme} from '../../theme';
import TaskCard from '../../components/TaskCard';
import SkeletonBlock from '../../components/SkeletonBlock';
import AccountAvatar from '../../components/AccountAvatar';
import {TaskFilter, ElmaTask} from '../../types/task';
import {refreshAccountTasks} from '../../services/task-service';
import {contrastText} from '../../utils/color';
import {useRefresh} from '../../hooks/useRefresh';

type Props = {onTaskPress: (taskId: string, accountId: string) => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

const FILTERS: {key: TaskFilter; label: string}[] = [
  {key: 'all', label: 'Все'},
  {key: 'active', label: 'Активные'},
  {key: 'overdue', label: 'Просроченные'},
  {key: 'completed', label: 'Завершённые'},
];

function getStatusColor(status: string): string {
  switch (status) {
    case 'ok':
      return '#4CAF50';
    case 'syncing':
      return '#FF9800';
    case 'error':
    case 'auth':
      return '#E53935';
    default:
      return '#999';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'syncing':
      return '…';
    case 'error':
      return 'ошибка';
    case 'auth':
      return 'нужен вход';
    default:
      return '';
  }
}

export default function TasksListScreen({onTaskPress}: Props) {
  const accounts = useAuthStore((s) => s.accounts);
  const tasks = useTasksStore((s) => s.filteredTasks);
  const filter = useTasksStore((s) => s.filter);
  const setFilter = useTasksStore((s) => s.setFilter);
  const selectedAccountId = useTasksStore((s) => s.selectedAccountId);
  const setSelectedAccount = useTasksStore((s) => s.setSelectedAccount);
  const syncStates = useTasksStore((s) => s.syncStates);
  const setActiveAccountId = useUiStore((s) => s.setActiveAccountId);
  const [searchQuery, setSearchQuery] = useState('');
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const effectiveSelectedAccountId = useMemo(() => {
    if (!selectedAccountId) {
      return null;
    }
    return accounts.some(a => a.id === selectedAccountId) ? selectedAccountId : null;
  }, [accounts, selectedAccountId]);

  const displayTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return tasks;
    }
    return tasks.filter((t) => {
      const subject = (t.subject || '').toLowerCase();
      const name = (t.name || '').toLowerCase();
      return subject.includes(q) || name.includes(q);
    });
  }, [tasks, searchQuery]);

  const handleAccountPress = (id: string | null) => {
    setSelectedAccount(id);
    if (id !== null) {
      setActiveAccountId(id);
    }
  };

  const hasActiveSyncStates = accounts.some(
    (a) => syncStates[a.id] && syncStates[a.id].status !== 'idle',
  );

  const hasLoadingSyncStates = accounts.some(
    (a) =>
      syncStates[a.id] && ['syncing', 'loading'].includes(syncStates[a.id].status),
  );

  const showTaskSkeletons =
    displayTasks.length === 0 && (hasActiveSyncStates || hasLoadingSyncStates);

  const handleTaskPress = useCallback(
    (taskId: string, accountId: string) => onTaskPress(taskId, accountId),
    [onTaskPress],
  );

  const renderItem = useCallback(
    ({item}: {item: ElmaTask}) => {
      const acc = accounts.find((a) => a.id === item.accountId);
      return (
        <TaskCard
          task={item}
          accountColor={acc?.color || '#999'}
          accountName={acc?.name || '?'}
          onPress={handleTaskPress}
        />
      );
    },
    [accounts, handleTaskPress],
  );

  const refreshData = useCallback(async () => {
    try {
      if (effectiveSelectedAccountId) {
        const acc = accounts.find(a => a.id === effectiveSelectedAccountId);
        if (acc) {
          await refreshAccountTasks(acc);
        }
      } else {
        await Promise.allSettled(
          accounts.map((acc) => refreshAccountTasks(acc)),
        );
      }
    } catch {}
  }, [accounts, effectiveSelectedAccountId]);

  const {refreshing, onRefresh} = useRefresh(refreshData);

  return (
    <View style={styles.container}>
      <Text variant="titleLarge" style={styles.header}>
        Задачи
      </Text>

      {accounts.length > 0 && (
        <View style={styles.accountsRow}>
          <TouchableOpacity
            style={[styles.accountBtn, !effectiveSelectedAccountId && styles.accountBtnActive]}
            onPress={() => handleAccountPress(null)}>
            <Text style={[styles.accountBtnText, !effectiveSelectedAccountId && {color: contrastText(colors.primary)}]}>Все</Text>
          </TouchableOpacity>
          {accounts.map((acc) => (
            <TouchableOpacity
              key={acc.id}
              style={[
                styles.accountBtn,
                effectiveSelectedAccountId === acc.id && {backgroundColor: acc.color},
              ]}
              onPress={() => handleAccountPress(acc.id)}>
              <AccountAvatar name={acc.name} color={acc.color} size={20} />
              <Text style={[styles.accountBtnText, {marginLeft: 6}, effectiveSelectedAccountId === acc.id && {color: contrastText(acc.color)}]}>
                {acc.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            selected={filter === f.key}
            onPress={() => setFilter(f.key)}
            style={[
              styles.filterChip,
              filter === f.key && styles.filterChipActive,
            ]}
            textStyle={filter === f.key ? styles.filterTextActive : undefined}>
            {f.label}
          </Chip>
        ))}
      </View>

      <View style={styles.searchRow}>
        <Icon name="magnify" size={18} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск по теме/названию…"
          placeholderTextColor={colors.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Icon name="close-circle" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.count}>{displayTasks.length} задач</Text>

      {hasActiveSyncStates && (
        <View style={styles.syncStatusRow}>
          {accounts.map((acc) => {
            const st = syncStates[acc.id];
            if (!st || st.status === 'idle') {
              return null;
            }
            return (
              <Text key={acc.id} style={[styles.syncStatus, {color: getStatusColor(st.status)}]}>
                {acc.name}: {getStatusLabel(st.status)}
              </Text>
            );
          })}
        </View>
      )}

      <FlatList
        data={displayTasks}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          showTaskSkeletons ? (
            <View>
              <SkeletonBlock height={84} style={styles.skeletonItem} />
              <SkeletonBlock height={84} style={styles.skeletonItem} />
              <SkeletonBlock height={84} style={styles.skeletonItem} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Нет задач</Text>
              <Button mode="outlined" onPress={onRefresh} style={styles.emptyRefreshBtn}>
                Обновить
              </Button>
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            title="Обновление задач…"
          />
        }
      />
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  header: {
    fontWeight: 'bold',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  accountsRow: {flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 4, gap: 6, flexWrap: 'wrap'},
  accountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: c.chipDefault,
    height: 32,
  },
  accountBtnActive: {backgroundColor: c.primary},
  accountBtnText: {fontSize: 13, color: c.textPrimary},
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 6,
    marginBottom: 4,
  },
  filterChip: {backgroundColor: c.chipDefault},
  filterChipActive: {backgroundColor: c.primary},
  filterTextActive: {color: c.onBackground},
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
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: c.textPrimary,
    marginLeft: 8,
    paddingVertical: 0,
  },
  count: {
    fontSize: 12,
    color: c.textTertiary,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  syncStatusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 6,
  },
  syncStatus: {fontSize: 11},
  list: {paddingBottom: 80},
  empty: {alignItems: 'center', marginTop: 80},
  emptyText: {fontSize: 16, color: c.textTertiary},
  emptyRefreshBtn: {marginTop: 12, borderRadius: 8},
  skeletonItem: {marginHorizontal: 16, marginVertical: 6},
});
