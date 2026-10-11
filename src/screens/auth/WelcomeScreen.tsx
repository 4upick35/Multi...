import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import {Text, Button} from 'react-native-paper';
import {useAppTheme} from '../../theme';

type Props = {onAddAccount: () => void};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function WelcomeScreen({onAddAccount}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text variant="headlineLarge" style={styles.title}>
        multi Elma
      </Text>
      <Text variant="bodyLarge" style={styles.subtitle}>
        Мульти-аккаунт клиент для ELMA365
      </Text>
      <Text variant="bodyMedium" style={styles.desc}>
        Управляйте задачами из нескольких аккаунтов одновременно.
        Мгновенное принятие задач.
      </Text>
      <Button mode="contained" style={styles.btn} onPress={onAddAccount}>
        Добавить аккаунт
      </Button>
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: c.background},
  title: {fontSize: 32, fontWeight: 'bold', marginBottom: 8, color: c.primary},
  subtitle: {fontSize: 16, color: c.textSecondary, marginBottom: 16, textAlign: 'center'},
  desc: {fontSize: 14, color: c.textTertiary, textAlign: 'center', marginBottom: 32, lineHeight: 20},
  btn: {width: '100%', paddingVertical: 6, borderRadius: 12},
});
