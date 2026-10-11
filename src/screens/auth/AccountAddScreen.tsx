import React, {useState, useMemo} from 'react';
import {useAppTheme} from '../../theme';
import {StyleSheet, ScrollView, Alert} from 'react-native';
import {Text, TextInput, Button, Chip} from 'react-native-paper';
import QuantumLoader from '../../components/QuantumLoader';
import {useAuthStore, accountRegistry} from '../../store/auth-store';
import {useSettingsStore} from '../../store/settings-store';
import {SessionManager} from '../../infrastructure/SessionManager';
import {fetchPagesAccess} from '../../services/elma-api';
import {normalizeBaseUrl, isSecureBaseUrl} from '../../utils/url';
import {ACCOUNT_COLORS} from '../../config/constants';

// Singleton-экземпляр SessionManager ( используется только здесь )
const sessionManager = new SessionManager();

type Props = {onDone: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function AccountAddScreen({onDone}: Props) {
  const addAccount = useAuthStore((s) => s.addAccount);
  const accounts = useAuthStore((s) => s.accounts);
  const serverAddress = useSettingsStore((s) => s.serverAddress);
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const existingUrls = useMemo(
    () => [...new Set(accounts.map((a) => a.baseUrl))].filter(Boolean),
    [accounts],
  );

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState(
    accounts.length > 0 ? accounts[0].baseUrl : serverAddress || '',
  );
  const [portal, setPortal] = useState('customer_service');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!name.trim() || !email.trim() || !password.trim()) {
      Alert.alert('Ошибка', 'Заполните имя, почту и пароль');
      return;
    }
    // Адрес приводим к origin: если вставить URL страницы портала целиком,
    // запросы уйдут по пути портала и сервер ответит 405 на login.
    const normalizedUrl = normalizeBaseUrl(baseUrl);
    if (!normalizedUrl) {
      Alert.alert('Ошибка', 'Укажите корректный адрес сервера, например https://elma.example.ru');
      return;
    }
    if (!isSecureBaseUrl(normalizedUrl) && !__DEV__) {
      Alert.alert('Ошибка', 'Адрес сервера должен начинаться с https://');
      return;
    }
    setBaseUrl(normalizedUrl);
    setLoading(true);
    const result = await sessionManager.login(normalizedUrl, portal, email.trim(), password);
    setLoading(false);
    if (!result.ok || !result.token) {
      Alert.alert('Ошибка', result.error || 'Неверная почта или пароль');
      return;
    }
    // Проверка дубликата через AccountRegistry
    const duplicate = accountRegistry.findDuplicate(normalizedUrl, email.trim());
    if (duplicate) {
      Alert.alert(
        'Аккаунт уже добавлен',
        'Аккаунт с таким сервером и почтой уже существует.',
      );
      return;
    }
    // Учётные записи магазинов (userKind === 'default') больше не поддерживаются
    if (result.userKind === 'default') {
      Alert.alert(
        'Учётные записи магазинов больше не поддерживаются',
        'Пожалуйста, используйте учётную запись мастера (портал).',
      );
      return;
    }
    const account = {
      id: Date.now().toString(),
      name: name.trim(),
      baseUrl: normalizedUrl,
      portal,
      token: result.token,
      userId: result.userId || '',
      cookies: result.cookies,
      email: email.trim(),
      color: accountRegistry.pickColor(ACCOUNT_COLORS),
      isActive: true,
      userKind: result.userKind,
      privileges: result.privileges,
      isPortal: result.isPortal,
    };
    await addAccount(account);

    // Загружаем доступ к страницам портала (асинхронно, не блокируя навигацию)
    fetchPagesAccess(account).then(({pagesAccess, updatedAccount}) => {
      if (pagesAccess.length > 0) {
        useAuthStore.getState().updateAccount(account.id, {pagesAccess});
      }
      if (updatedAccount?.token) {
        useAuthStore.getState().updateAccount(account.id, {token: updatedAccount.token});
      }
      if (updatedAccount?.cookies) {
        useAuthStore.getState().updateAccount(account.id, {cookies: updatedAccount.cookies});
      }
    }).catch(() => {});

    onDone();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text variant="headlineSmall" style={styles.title}>
        Новый аккаунт
      </Text>
      <TextInput
        label="Название (напр. Основной)"
        value={name}
        onChangeText={setName}
        mode="outlined"
        style={styles.input}
      />
      <TextInput
        label="URL сервера"
        value={baseUrl}
        onChangeText={setBaseUrl}
        mode="outlined"
        style={styles.input}
        placeholder="https://elma.example.ru"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {existingUrls.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chipContainer}>
          {existingUrls.map((url) => (
            <Chip
              key={url}
              style={[styles.chip, baseUrl === url && styles.chipActive]}
              onPress={() => setBaseUrl(url)}
              textStyle={baseUrl === url ? styles.chipTextActive : undefined}>
              {url}
            </Chip>
          ))}
        </ScrollView>
      )}
      <TextInput
        label="Портал"
        value={portal}
        onChangeText={setPortal}
        mode="outlined"
        style={styles.input}
      />
      <TextInput
        label="Почта"
        value={email}
        onChangeText={setEmail}
        mode="outlined"
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        label="Пароль"
        value={password}
        onChangeText={setPassword}
        mode="outlined"
        style={styles.input}
        secureTextEntry
      />
      <Button
        mode="contained"
        style={styles.btn}
        onPress={handleAdd}
        disabled={loading}>
        {loading ? <QuantumLoader size={20} color={colors.textSubtle} /> : 'Войти'}
      </Button>
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.background},
  content: {padding: 24},
  title: {marginBottom: 24, fontWeight: 'bold'},
  input: {marginBottom: 16},
  chipScroll: {marginTop: -8, marginBottom: 16},
  chipContainer: {gap: 8},
  chip: {backgroundColor: c.chipDefault},
  chipActive: {backgroundColor: c.primary},
  chipTextActive: {color: c.onBackground},
  btn: {marginTop: 8, paddingVertical: 4, borderRadius: 12},
});
