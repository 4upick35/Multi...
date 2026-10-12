import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {View, TouchableOpacity, Text, StyleSheet, StatusBar, Platform, BackHandler} from 'react-native';
import {PaperProvider, MD3LightTheme, MD3DarkTheme} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {useAuthStore} from './src/store/auth-store';
import {useUiStore} from './src/store/ui-store';
import {useFeedStore} from './src/store/feed-store';
import {useAppTheme} from './src/theme';
import {usePolling} from './src/hooks/usePolling';
import {useNotifications} from './src/hooks/useNotifications';
import {useApplicationAlerts} from './src/hooks/useApplicationAlerts';
import {useApplicationsSync} from './src/hooks/useApplicationsSync';
import {useKeepAlive} from './src/hooks/useKeepAlive';
import {useFloatingWidget} from './src/hooks/useFloatingWidget';
import {requestNotificationPermission} from './src/utils/permissions';
import {isAllowedNavTarget, sanitizeNavAccountId} from './src/utils/nav';
import {pageAccessService} from './src/domain/PageAccessService';
import type {NavigationTarget} from './src/native/KeepAlive';

import WelcomeScreen from './src/screens/auth/WelcomeScreen';
import AccountAddScreen from './src/screens/auth/AccountAddScreen';
import TasksListScreen from './src/screens/tasks/TasksListScreen';
import TaskDetailScreen from './src/screens/tasks/TaskDetailScreen';
import ExecutionScreen from './src/screens/tasks/ExecutionScreen';
import SettingsScreen from './src/screens/tasks/SettingsScreen';
import ProfileScreen from './src/screens/tasks/ProfileScreen';
import CustomerServiceScreen from './src/screens/customer/CustomerServiceScreen';
import CollectionListScreen from './src/screens/customer/CollectionListScreen';
import CollectionDetailScreen from './src/screens/customer/CollectionDetailScreen';
import ApplicationsCalendarScreen from './src/screens/customer/ApplicationsCalendarScreen';
import WorkCalendarScreen from './src/screens/customer/WorkCalendarScreen';
import AppealsDirectoriesScreen from './src/screens/customer/AppealsDirectoriesScreen';
import DocflowScreen from './src/screens/customer/DocflowScreen';
import FeedScreen from './src/screens/feed/FeedScreen';

import {CollectionMeta, CollectionItem, COLLECTIONS} from './src/types/customer-service';

type Screen =
  | 'Welcome'
  | 'AddAccount'
  | 'Tasks'
  | 'Settings'
  | 'CustomerService'
  | 'Profile'
  | 'Feed'
  | 'WorkCalendar'
  | 'AppealsDirectories'
  | 'ApplicationsCalendar'
  | 'Docflow'
  | {screen: 'TaskDetail'; taskId: string; accountId: string}
  | {screen: 'Execution'; taskId: string; accountId: string; taskUuid: string}
  | {screen: 'CollectionList'; collection: CollectionMeta; accountId?: string | null; filterSeq?: number}
  | {screen: 'CollectionDetail'; item: CollectionItem; collection: CollectionMeta};

const TAB_SCREENS: string[] = ['CustomerService', 'Tasks', 'Settings', 'WorkCalendar'];

const TOP_PADDING = Platform.OS === 'android' ? (StatusBar.currentHeight ? Math.min(StatusBar.currentHeight, 28) : 16) : 20;

function getScreenName(s: Screen): string {
  return typeof s === 'string' ? s : s.screen;
}

export default function App() {
  const {colors, mode} = useAppTheme();
  const accounts = useAuthStore((s) => s.accounts);
  const loadAccounts = useAuthStore((s) => s.loadAccounts);
  const activeAccountId = useUiStore((s) => s.activeAccountId);
  const setActiveAccountId = useUiStore((s) => s.setActiveAccountId);

  const [history, setHistory] = useState<Screen[]>(['Welcome']);

  const screen = history[history.length - 1];
  const screenName = getScreenName(screen);

  usePolling();
  useNotifications();
  useApplicationAlerts();
  useApplicationsSync();
  useKeepAlive();

  const push = useCallback((next: Screen) => {
    setHistory((prev) => [...prev, next]);
  }, []);

  const replaceTab = useCallback((next: Screen) => {
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      const lastName = getScreenName(last);
      const nextName = getScreenName(next);
      if (TAB_SCREENS.includes(lastName) && lastName !== nextName) {
        return [...prev.slice(0, -1), next];
      }
      if (lastName === nextName) {
        return prev;
      }
      return [next];
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length <= 1) {
        return prev;
      }
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Auto-request POST_NOTIFICATIONS on startup (once) when accounts exist
  useEffect(() => {
    if (accounts.length > 0) {
      const NOTIF_ASKED_KEY = '@multi_ma_notif_asked';
      AsyncStorage.getItem(NOTIF_ASKED_KEY).then((asked) => {
        if (!asked) {
          requestNotificationPermission().then(() => {
            AsyncStorage.setItem(NOTIF_ASKED_KEY, '1').catch(() => {});
          });
        }
      });
    }
  }, [accounts.length]);

  const canShowFeed = pageAccessService.hasPageAccess(accounts, activeAccountId, 'feed');
  // Сервис доступен всем ролям при наличии аккаунтов
  const canShowService = accounts.length > 0;

  // Счётчик переходов по уведомлению: меняется при каждом тапе, чтобы экран заявок
  // применил фильтр учётки заново, даже если он уже был выставлен на неё.
  const accountFilterSeqRef = useRef(0);
  // Переход по уведомлению. На холодном старте он приходит раньше, чем загружены
  // учётки, поэтому применяем его не сразу, а когда приложение выбрало стартовый экран.
  const pendingNavRef = useRef<NavigationTarget | null>(null);

  const applyPendingNavigation = useCallback(() => {
    const nav = pendingNavRef.current;
    if (nav === null || !isAllowedNavTarget(nav.target)) {
      return;
    }
    const appsMeta = COLLECTIONS.find(c => c.key === 'applications');
    if (!appsMeta || !canShowService) {
      return;
    }
    pendingNavRef.current = null;
    accountFilterSeqRef.current += 1;
    setHistory([{
      screen: 'CollectionList',
      collection: appsMeta,
      accountId: sanitizeNavAccountId(nav.accountId, accounts.map((a) => a.id)),
      filterSeq: accountFilterSeqRef.current,
    }]);
  }, [canShowService, accounts]);

  const handleOverlayNavigation = useCallback((nav: NavigationTarget) => {
    pendingNavRef.current = nav;
    applyPendingNavigation();
  }, [applyPendingNavigation]);

  useFloatingWidget(handleOverlayNavigation);

  // Отложенный переход применяем, когда стартовый экран уже выбран (учётки загружены).
  useEffect(() => {
    if (screenName === 'Welcome') {
      return;
    }
    applyPendingNavigation();
  }, [screenName, applyPendingNavigation]);

  // При изменении списка аккаунтов: сбросить activeAccountId если не в списке, переключить экран
  useEffect(() => {
    if (accounts.length === 0) {
      if (activeAccountId !== null) {
        setActiveAccountId(null);
      }
      return;
    }

    if (activeAccountId && !accounts.some(a => a.id === activeAccountId)) {
      setActiveAccountId(accounts[0].id);
    } else if (!activeAccountId && accounts.length > 0) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId, setActiveAccountId]);

  useEffect(() => {
    if (accounts.length > 0 && screenName === 'Welcome') {
      const appsMeta = COLLECTIONS.find(c => c.key === 'applications');
      const firstScreen: Screen = canShowService && appsMeta
        ? {screen: 'CollectionList', collection: appsMeta}
        : canShowFeed ? 'Feed' : 'Settings';
      setHistory([firstScreen]);
      if (!activeAccountId && accounts.length > 0) {
        setActiveAccountId(accounts[0].id);
      }
    }
  }, [accounts.length, screenName, activeAccountId, setActiveAccountId, accounts, canShowService, canShowFeed]);

  useEffect(() => {
    if (accounts.length > 0 && !activeAccountId && accounts.length > 0) {
      setActiveAccountId(accounts[0].id);
    }
  }, [accounts, activeAccountId, setActiveAccountId]);

  // Очистка данных ленты для удалённых аккаунтов
  useEffect(() => {
    const visibleIds = new Set(accounts.map(a => a.id));
    const allAccountIds = Object.keys(useFeedStore.getState().messagesByAccount);
    for (const accountId of allAccountIds) {
      if (!visibleIds.has(accountId)) {
        useFeedStore.getState().clearAccount(accountId);
      }
    }
  }, [accounts]);

  // Если текущий экран — скрытая вкладка, переключаем на доступную
  useEffect(() => {
    if (accounts.length === 0) {
      return;
    }
    if (screenName === 'CustomerService' && !canShowService) {
      replaceTab(canShowFeed ? 'Feed' : 'Settings');
    } else if (screenName === 'Feed' && !canShowFeed) {
      replaceTab(canShowService ? 'CustomerService' : 'Settings');
    }
  }, [screenName, canShowService, canShowFeed, accounts.length, replaceTab]);

  // Открыт ли список заявок (используется в BackHandler и таб-баре)
  const isApplicationsList = typeof screen === 'object' && screen.screen === 'CollectionList' && screen.collection.key === 'applications';

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (history.length > 1) {
        goBack();
        return true;
      }
      const appsMeta = COLLECTIONS.find(c => c.key === 'applications');
      const firstAvailableTab: Screen = canShowService && appsMeta
        ? {screen: 'CollectionList', collection: appsMeta}
        : 'Tasks';
      const currentTabName = getScreenName(firstAvailableTab);
      if (screenName !== currentTabName && !(isApplicationsList && currentTabName === 'CollectionList')) {
        replaceTab(firstAvailableTab);
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, [history.length, goBack, replaceTab, screenName, canShowService, canShowFeed, isApplicationsList]);

  const showTabs =
    accounts.length > 0 &&
    (TAB_SCREENS.includes(screenName) || isApplicationsList);

  // Активная вкладка: для списка заявок — подсвечиваем "Заявки" через isApplicationsList
  const activeTabName = screenName;

  let content;
  if (accounts.length === 0 && screenName !== 'AddAccount') {
    content = <WelcomeScreen onAddAccount={() => push('AddAccount')} />;
  } else if (screenName === 'AddAccount') {
    content = <AccountAddScreen onDone={() => {
      const freshAccounts = useAuthStore.getState().accounts;
      const lastAccount = freshAccounts[freshAccounts.length - 1];
      if (lastAccount) {
        setActiveAccountId(lastAccount.id);
        const canShowFeedAfter = pageAccessService.hasPageAccess(freshAccounts, lastAccount.id, 'feed');
        const canShowServiceAfter = freshAccounts.length > 0;
        const appsMeta = COLLECTIONS.find(c => c.key === 'applications');
        const firstScreen: Screen = canShowServiceAfter && appsMeta
          ? {screen: 'CollectionList', collection: appsMeta}
          : canShowFeedAfter ? 'Feed' : 'Settings';
        setHistory([firstScreen]);
      } else {
        setHistory(['Welcome']);
      }
    }} />;
  } else if (screenName === 'Tasks') {
    content = (
      <TasksListScreen
        onTaskPress={(taskId: string, accountId: string) =>
          push({screen: 'TaskDetail', taskId, accountId})
        }
      />
    );
  } else if (screenName === 'Settings') {
    content = (
      <SettingsScreen
        onAddAccount={() => push('AddAccount')}
        onProfile={() => push('Profile')}
      />
    );
  } else if (screenName === 'Profile') {
    content = <ProfileScreen onBack={goBack} />;
  } else if (screenName === 'Feed') {
    content = <FeedScreen onBack={goBack} />;
  } else if (screenName === 'WorkCalendar') {
    content = <WorkCalendarScreen onBack={goBack} />;
  } else if (screenName === 'ApplicationsCalendar') {
    content = (
      <ApplicationsCalendarScreen
        onBack={goBack}
        onSelectItem={(item: CollectionItem) => {
          const appsMeta = COLLECTIONS.find(c => c.key === 'applications');
          if (appsMeta) {
            push({screen: 'CollectionDetail', item, collection: appsMeta});
          }
        }}
      />
    );
  } else if (screenName === 'AppealsDirectories') {
    content = <AppealsDirectoriesScreen onBack={goBack} />;
  } else if (screenName === 'Docflow') {
    content = <DocflowScreen onBack={goBack} />;
  } else if (screenName === 'CustomerService') {
    content = (
      <CustomerServiceScreen
        onSelectCollection={(col: CollectionMeta) =>
          push({screen: 'CollectionList', collection: col})
        }
        onFeed={() => push('Feed')}
        onWorkCalendar={() => push('WorkCalendar')}
        onAppealsDirectories={() => push('AppealsDirectories')}
        onDocflow={() => push('Docflow')}
      />
    );
  } else if (typeof screen === 'object' && screen.screen === 'TaskDetail') {
    content = (
      <TaskDetailScreen
        taskId={screen.taskId}
        accountId={screen.accountId}
        onBack={goBack}
        onExecution={() => push({screen: 'Execution', taskId: screen.taskId, accountId: screen.accountId, taskUuid: screen.taskId})}
      />
    );
  } else if (typeof screen === 'object' && screen.screen === 'Execution') {
    content = (
      <ExecutionScreen
        taskId={screen.taskId}
        accountId={screen.accountId}
        taskUuid={screen.taskUuid}
        onBack={goBack}
      />
    );
  } else if (typeof screen === 'object' && screen.screen === 'CollectionList') {
    content = (
      <CollectionListScreen
        collection={screen.collection}
        initialAccountId={screen.accountId}
        filterSeq={screen.filterSeq}
        onSelectItem={(item: CollectionItem) =>
          push({screen: 'CollectionDetail', item, collection: screen.collection})
        }
        onBack={goBack}
        onOpenCalendar={screen.collection.key === 'applications' ? () => push('ApplicationsCalendar') : undefined}
      />
    );
  } else if (typeof screen === 'object' && screen.screen === 'CollectionDetail') {
    content = (
      <CollectionDetailScreen
        item={screen.item}
        collection={screen.collection}
        onBack={goBack}
        onOpenTask={(taskId, accountId) => push({screen: 'TaskDetail', taskId, accountId})}
      />
    );
  } else {
    content = <WelcomeScreen onAddAccount={() => push('AddAccount')} />;
  }

  const handleTabPress = (tab: Screen) => {
    replaceTab(tab);
  };

  const tabTextActiveColor = colors.primary;
  const tabBarBackground = colors.surface;
  const tabBorderColor = colors.separator;

  const appStyles = useMemo(() => StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: TOP_PADDING,
    },
    content: {flex: 1},
    tabBar: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: tabBorderColor,
      backgroundColor: tabBarBackground,
      paddingBottom: 20,
      paddingTop: 8,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 4,
    },
    tabText: {fontSize: 12, color: colors.textTertiary, marginTop: 2},
    tabTextActive: {color: tabTextActiveColor, fontWeight: '600'},
  }), [colors, tabBarBackground, tabBorderColor, tabTextActiveColor]);

  return (
    <PaperProvider theme={mode === 'dark' ? MD3DarkTheme : MD3LightTheme}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.surface} />
      <View style={appStyles.root}>
        <View style={appStyles.content}>
          {content}
        </View>
        {showTabs && (
          <View style={appStyles.tabBar}>
            {canShowService && (
              <TouchableOpacity
                style={appStyles.tab}
                activeOpacity={0.6}
                onPress={() => {
                  const appsMeta = COLLECTIONS.find(c => c.key === 'applications');
                  if (appsMeta) {
                    handleTabPress({screen: 'CollectionList', collection: appsMeta});
                  }
                }}>
                <Icon name="file-document" size={22} color={isApplicationsList ? colors.primary : colors.textTertiary} />
                <Text style={[appStyles.tabText, isApplicationsList && appStyles.tabTextActive]}>Заявки</Text>
              </TouchableOpacity>
            )}
            {canShowService && (
              <TouchableOpacity
                style={appStyles.tab}
                activeOpacity={0.6}
                onPress={() => handleTabPress('CustomerService')}>
                <Icon name="wrench" size={22} color={activeTabName === 'CustomerService' && !isApplicationsList ? colors.primary : colors.textTertiary} />
                <Text style={[appStyles.tabText, activeTabName === 'CustomerService' && !isApplicationsList && appStyles.tabTextActive]}>Сервис</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={appStyles.tab}
              activeOpacity={0.6}
              onPress={() => handleTabPress('Tasks')}>
              <Icon name="checkbox-marked-outline" size={22} color={activeTabName === 'Tasks' ? colors.primary : colors.textTertiary} />
              <Text style={[appStyles.tabText, activeTabName === 'Tasks' && appStyles.tabTextActive]}>Задачи</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={appStyles.tab}
              activeOpacity={0.6}
              onPress={() => handleTabPress('Settings')}>
              <Icon name="cog" size={22} color={activeTabName === 'Settings' ? colors.primary : colors.textTertiary} />
              <Text style={[appStyles.tabText, activeTabName === 'Settings' && appStyles.tabTextActive]}>Настройки</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </PaperProvider>
  );
}