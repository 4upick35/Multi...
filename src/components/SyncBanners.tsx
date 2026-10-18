import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import {Text, Button} from 'react-native-paper';
import {useAppTheme} from '../theme';
import type {PendingAction} from '../services/action-queue';

type Props = {
  online: boolean | null;
  actions: PendingAction[];
  onRetry: () => void;
};

export function SyncBanners({online, actions, onRetry}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const offline = online === false;
  const hasPending = actions.length > 0;

  if (!offline && !hasPending) {
    return null;
  }

  const needsAcceptRetry = actions.some(action => action.kind === 'accept-application');

  return (
    <View style={styles.container}>
      {offline ? (
        <View style={[styles.banner, styles.offlineBanner]}>
          <Text style={styles.text}>Нет подключения. Показаны сохранённые данные. Действия будут отправлены автоматически.</Text>
        </View>
      ) : null}
      {hasPending ? (
        <View style={[styles.banner, styles.pendingBanner]}>
          <View style={styles.row}>
            <Text style={styles.text}>Отложенные действия: {actions.length}</Text>
            <Button mode="text" onPress={onRetry} textColor="#fff">
              Повторить
            </Button>
          </View>
          {needsAcceptRetry ? (
            <Text style={styles.hint}>Принятие заявки нужно повторить в её карточке</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (c: ReturnType<typeof useAppTheme>['colors']) =>
  StyleSheet.create({
    container: {marginHorizontal: 12, marginTop: 8, gap: 6},
    banner: {borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12},
    offlineBanner: {backgroundColor: c.error},
    pendingBanner: {backgroundColor: c.warning},
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    text: {color: '#fff', fontSize: 13, flexShrink: 1},
    hint: {color: '#fff', fontSize: 12, marginTop: 4},
  });
