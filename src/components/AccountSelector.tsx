import React, {useMemo} from 'react';
import {StyleSheet, ScrollView, TouchableOpacity} from 'react-native';
import {Text} from 'react-native-paper';
import {useAuthStore} from '../store/auth-store';
import {useUiStore} from '../store/ui-store';
import {contrastText, mixWithWhite} from '../utils/color';
import {useAppTheme} from '../theme';
import AccountAvatar from './AccountAvatar';

type Props = {
  showAll?: boolean;
};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function AccountSelector({showAll = false}: Props) {
  const accounts = useAuthStore((s) => s.accounts);
  const activeAccountId = useUiStore((s) => s.activeAccountId);
  const setActiveAccountId = useUiStore((s) => s.setActiveAccountId);
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (accounts.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {showAll && (
        <TouchableOpacity
          style={[
            styles.chip,
            !activeAccountId && {backgroundColor: colors.primary},
          ]}
          onPress={() => setActiveAccountId(null)}>
          <Text
            style={[
              styles.chipText,
              !activeAccountId && {color: contrastText(colors.primary)},
            ]}>
            Все
          </Text>
        </TouchableOpacity>
      )}
      {accounts.map((acc) => {
        const active = activeAccountId === acc.id;
        return (
          <TouchableOpacity
            key={acc.id}
            style={[
              styles.chip,
              active
                ? {backgroundColor: acc.color}
                : {backgroundColor: mixWithWhite(acc.color, 0.85)},
            ]}
            onPress={() => setActiveAccountId(acc.id)}>
            <AccountAvatar name={acc.name} color={acc.color} size={20} />
            <Text
              style={[
                styles.chipText,
                active && {color: contrastText(acc.color)},
              ]}>
            {acc.name}
          </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: c.chipDefault,
    height: 32,
    gap: 4,
  },
  chipText: {
    fontSize: 12,
    color: c.muted,
  },
});