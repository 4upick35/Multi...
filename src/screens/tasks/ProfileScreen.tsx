import React, {useCallback, useEffect, useState, useMemo} from 'react';
import {View, StyleSheet, ScrollView, RefreshControl} from 'react-native';
import {Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BackButton from '../../components/BackButton';
import {useActiveAccount} from '../../hooks/useActiveAccount';
import {useRefresh} from '../../hooks/useRefresh';
import {fetchUserProfile} from '../../services/elma-api';
import {ElmaRequestError} from '../../types/errors';
import {UserProfile} from '../../types/profile';
import {extractField} from '../../utils/extract-field';
import {useAuthStore} from '../../store/auth-store';
import AccountSelector from '../../components/AccountSelector';
import {useAppTheme} from '../../theme';

type Props = {onBack: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function ProfileScreen({onBack}: Props) {
  const {account: activeAccount} = useActiveAccount();
  const updateAccount = useAuthStore((s) => s.updateAccount);
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!activeAccount) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const {profile: data, updatedAccount} = await fetchUserProfile(activeAccount);
      if (updatedAccount) {
        updateAccount(activeAccount.id, updatedAccount);
      }
      if (data) {
        setProfile({
          id: extractField(data, ['id', 'Id', '__id', 'userId', 'UserId', '__userId']),
          userName: extractField(data, ['userName', 'UserName', 'name', 'Name', 'displayName']),
          email: extractField(data, ['email', 'Email']),
          firstName: extractField(data, ['firstName', 'FirstName']),
          lastName: extractField(data, ['lastName', 'LastName']),
          name: extractField(data, ['name', 'Name', 'fullName', 'FullName']),
          phone: extractField(data, ['phone', 'Phone', 'phoneNumber']),
          raw: data,
        });
      } else {
        setProfile(null);
      }
    } catch (e: unknown) {
      const msg = e instanceof ElmaRequestError ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [activeAccount, updateAccount]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const {refreshing, onRefresh} = useRefresh(loadProfile);

  if (!activeAccount) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Нет подключённых аккаунтов</Text>
        <BackButton onBack={onBack} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
      }>
      <BackButton onBack={onBack} />

      <View style={styles.headerRow}>
        <Icon name="account-circle" size={28} color={colors.primary} />
        <Text variant="titleLarge" style={styles.headerTitle}>
          Профиль
        </Text>
      </View>

      <AccountSelector />

      <Text style={styles.accountLabel}>Аккаунт: {activeAccount.name}</Text>

      {loading && !refreshing && (
        <Text style={styles.loadingText}>Загрузка…</Text>
      )}

      {error && (
        <Text style={styles.errorText}>Ошибка: {error}</Text>
      )}

      {!loading && !error && !profile && (
        <Text style={styles.emptyText}>Нет данных</Text>
      )}

      {profile && (
        <View style={styles.card}>
          {profile.name ? (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Имя:</Text>
              <Text style={styles.fieldValue}>{profile.name}</Text>
            </View>
          ) : null}

          {profile.userName ? (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>UserName:</Text>
              <Text style={styles.fieldValue}>{profile.userName}</Text>
            </View>
          ) : null}

          {profile.email ? (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Email:</Text>
              <Text style={styles.fieldValue}>{profile.email}</Text>
            </View>
          ) : null}

          {profile.firstName ? (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Имя ( first):</Text>
              <Text style={styles.fieldValue}>{profile.firstName}</Text>
            </View>
          ) : null}

          {profile.lastName ? (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Фамилия:</Text>
              <Text style={styles.fieldValue}>{profile.lastName}</Text>
            </View>
          ) : null}

          {profile.phone ? (
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Телефон:</Text>
              <Text style={styles.fieldValue}>{profile.phone}</Text>
            </View>
          ) : null}

          <View style={styles.fieldRow}>
            <Text style={styles.label}>ID:</Text>
            <Text style={styles.fieldValue}>{profile.id || activeAccount.userId || '—'}</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  content: {paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20},
  headerRow: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8},
  headerTitle: {fontWeight: 'bold'},
  accountLabel: {fontSize: 13, color: c.textSecondary, marginBottom: 16},
  card: {
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 16,
    elevation: 1,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
  },
  label: {fontWeight: '600', minWidth: 100, color: c.textSubtle},
  fieldValue: {flex: 1, color: c.textSubtle},
  loadingText: {color: c.textTertiary, marginBottom: 16},
  errorText: {color: c.error, marginBottom: 16},
  emptyText: {color: c.textTertiary, fontSize: 16, marginBottom: 16},
});
