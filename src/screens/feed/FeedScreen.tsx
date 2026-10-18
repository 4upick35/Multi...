import React, {useCallback, useEffect, useRef, useState, useMemo} from 'react';
import {View, StyleSheet, FlatList, RefreshControl, Platform} from 'react-native';
import {Text, Button} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import CaptchaModal from '../../components/CaptchaModal';
import {useFeedStore, EMPTY_FEED_MESSAGES} from '../../store/feed-store';
import {loadFeedMessages} from '../../services/feed-service';
import {FeedMessage} from '../../types/feed';
import AccountSelector from '../../components/AccountSelector';
import {stripHtml} from '../../utils/strip-html';
import {useAppTheme} from '../../theme';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useRefresh} from '../../hooks/useRefresh';
import {useFeedPolling} from '../../hooks/useFeedPolling';
import {isNewApplicationMessage, extractApplicationNumber} from '../../utils/feed-helpers';
import {searchApplicationByNumber} from '../../services/elma-api';
import {useAcceptApplication, canAccept} from '../../hooks/useAcceptApplication';
import type {ElmaAccount} from '../../types/account';

type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

type Props = {onBack: () => void};

// ---------------------------------------------------------------------------
// Карточка сообщения ленты с кнопкой «Принять» для новых заявок
// ---------------------------------------------------------------------------

type CardProps = {
  message: FeedMessage;
  account: ElmaAccount;
  onAccepted: () => void;
  styles: ReturnType<typeof createStyles>;
};

function FeedMessageCard({message, account, onAccepted, styles}: CardProps) {
  const isAppMsg = isNewApplicationMessage(message.text);
  const appNumber = isAppMsg ? extractApplicationNumber(message.text) : null;

  const [searching, setSearching] = useState(false);
  const [foundItem, setFoundItem] = useState<Record<string, unknown> | null>(null);
  const [searched, setSearched] = useState(false);
  const searchedRef = useRef(false);

  const acceptFlow = useAcceptApplication(
    useCallback((_acc: ElmaAccount) => {
      onAccepted();
      setFoundItem(null);
      setSearched(false);
      searchedRef.current = false;
    }, [onAccepted]),
  );

  // Автопоиск заявки при монтировании (один раз)
  useEffect(() => {
    if (!appNumber || searchedRef.current) {
      return;
    }
    searchedRef.current = true;
    setSearching(true);
    searchApplicationByNumber(account, appNumber)
      .then((result) => {
        if (result.item) {
          setFoundItem(result.item);
        }
        setSearched(true);
      })
      .catch(() => {
        setSearched(true);
      })
      .finally(() => {
        setSearching(false);
      });
  }, [appNumber, account]);

  const handleAccept = useCallback(() => {
    if (!foundItem || !account) {
      return;
    }
    const itemId = String(foundItem.__id || foundItem.id || '');
    if (!itemId) {
      return;
    }
    acceptFlow.accept(itemId, account);
  }, [foundItem, acceptFlow, account]);

  const canShowButton = isAppMsg && appNumber && searched && !searching;
  const canAcceptItem = foundItem ? canAccept(foundItem) : false;
  const isLoading = acceptFlow.flowState !== 'idle' && acceptFlow.flowState !== 'done' && acceptFlow.flowState !== 'error';

  return (
    <>
      {account && (
        <CaptchaModal
          visible={acceptFlow.captchaVisible}
          siteKey={acceptFlow.captchaSiteKey}
          baseUrl={account.baseUrl}
          onSuccess={acceptFlow.onCaptchaSuccess}
          onExpired={acceptFlow.onCaptchaExpired}
          onError={acceptFlow.onCaptchaError}
          onCancel={acceptFlow.onCaptchaCancel}
        />
      )}
      <View style={styles.messageCard}>
        {message.title ? (
          <Text style={styles.messageTitle}>{stripHtml(message.title)}</Text>
        ) : null}
        {message.text ? (
          <Text style={styles.messageText}>{stripHtml(message.text)}</Text>
        ) : null}
        <View style={styles.messageMeta}>
          {message.author ? (
            <Text style={styles.messageAuthor}>{message.author}</Text>
          ) : null}
          {message.createdAt ? (
            <Text style={styles.messageDate}>
              {new Date(message.createdAt).toLocaleString('ru')}
            </Text>
          ) : null}
        </View>
{canShowButton && canAcceptItem && (
          <Button
            mode="contained"
            onPress={handleAccept}
            disabled={isLoading}
            loading={isLoading}
            style={styles.acceptBtn}>
            Принять
          </Button>
        )}
        {canShowButton && !canAcceptItem && foundItem === null && searched && appNumber && (
          <Text style={styles.notFoundText}>Заявка {appNumber} не найдена</Text>
        )}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------
// FeedScreen
// ---------------------------------------------------------------------------

export default function FeedScreen({onBack}: Props) {
  const {account: activeAccount, accountId: resolvedAccountId} = useActiveAccount();

  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useFeedPolling();

  const messages = useFeedStore((s) =>
    resolvedAccountId ? s.messagesByAccount[resolvedAccountId] : undefined,
  );
  const loading = useFeedStore((s) =>
    resolvedAccountId ? s.loadingByAccount[resolvedAccountId] ?? false : false,
  );
  const error = useFeedStore((s) =>
    resolvedAccountId ? s.errorByAccount[resolvedAccountId] ?? null : null,
  );
  const hasMore = useFeedStore((s) =>
    resolvedAccountId ? s.hasMoreByAccount[resolvedAccountId] ?? true : false,
  );
  const offset = useFeedStore((s) =>
    resolvedAccountId ? s.offsetByAccount[resolvedAccountId] ?? 0 : 0,
  );

  const messagesList = messages ?? EMPTY_FEED_MESSAGES;

  const loadingRef = useRef(false);

  const loadInitial = useCallback(async () => {
    if (!activeAccount) {
      return;
    }
    await loadFeedMessages(activeAccount, 0);
  }, [activeAccount]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const {refreshing, onRefresh} = useRefresh(async () => {
    if (!activeAccount) {
      return;
    }
    await loadFeedMessages(activeAccount, 0);
  });

  const handleLoadMore = useCallback(async () => {
    if (!activeAccount || loading || loadingRef.current || !hasMore || !resolvedAccountId) {
      return;
    }
    loadingRef.current = true;
    await loadFeedMessages(activeAccount, offset);
    loadingRef.current = false;
  }, [activeAccount, loading, hasMore, offset, resolvedAccountId]);

  const handleAccepted = useCallback(() => {
    if (activeAccount) {
      loadFeedMessages(activeAccount, 0);
    }
  }, [activeAccount]);

  const renderItem = useCallback(
    ({item}: {item: FeedMessage}) => {
      if (!activeAccount) {
        return (
          <View style={styles.messageCard}>
            {item.title ? (
              <Text style={styles.messageTitle}>{stripHtml(item.title)}</Text>
            ) : null}
            {item.text ? (
              <Text style={styles.messageText}>{stripHtml(item.text)}</Text>
            ) : null}
          </View>
        );
      }
      return (
        <FeedMessageCard
          message={item}
          account={activeAccount}
          onAccepted={handleAccepted}
          styles={styles}
        />
      );
    },
    [activeAccount, handleAccepted, styles],
  );

  if (!activeAccount) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Нет подключённых аккаунтов</Text>
        <BackButton onBack={onBack} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <View style={styles.header}>
          <BackButton onBack={onBack} />
          <View style={styles.headerRow}>
            <Icon name="view-list" size={22} color={colors.primary} />
            <Text variant="titleLarge" style={styles.headerTitle}>
              Лента
            </Text>
          </View>
        </View>

        <AccountSelector />
      </View>

      {error && !loading && messagesList.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>Ошибка: {error}</Text>
          <Button onPress={onRefresh} mode="outlined" style={styles.retryBtn}>
            Повторить
          </Button>
        </View>
      ) : (
        <FlatList
          data={messagesList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          style={styles.flatList}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.center}>
                <Text style={styles.emptyText}>Нет сообщений</Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            loading && messagesList.length > 0 ? (
              <Text style={styles.loadingMore}>Загрузка…</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  topSection: {flexShrink: 0},
  flatList: {flex: 1},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20},
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  headerTitle: {fontWeight: 'bold'},
  list: {paddingHorizontal: 12, paddingBottom: 80, paddingTop: 8},
  messageCard: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 14,
    marginVertical: 5,
    elevation: 1,
  },
  messageTitle: {fontWeight: '600', fontSize: 15, marginBottom: 4, color: c.textPrimary},
  messageText: {fontSize: 13, color: c.textSecondary, marginBottom: 8},
  messageMeta: {flexDirection: 'row', justifyContent: 'space-between'},
  messageAuthor: {fontSize: 12, color: c.primary, fontWeight: '500'},
  messageDate: {fontSize: 12, color: c.textTertiary},
  emptyText: {color: c.textTertiary, fontSize: 16},
  errorText: {color: c.error, fontSize: 14, marginBottom: 12, textAlign: 'center'},
  retryBtn: {borderRadius: 12},
  loadingMore: {textAlign: 'center', color: c.textTertiary, paddingVertical: 12},
  acceptBtn: {borderRadius: 8, marginTop: 8},
  notFoundText: {fontSize: 12, color: c.textTertiary, marginTop: 8, fontStyle: 'italic'},
});
