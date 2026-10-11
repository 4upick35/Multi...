import React, {useMemo} from 'react';
import {StyleSheet, TouchableOpacity} from 'react-native';
import {Text} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useAppTheme} from '../theme';

type Props = {
  onBack: () => void;
  style?: object;
};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function BackButton({onBack, style}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      activeOpacity={0.6}
      onPress={onBack}>
      <Icon name="arrow-left" size={18} color={colors.primary} />
      <Text style={styles.text}>Назад</Text>
    </TouchableOpacity>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 2,
  },
  text: {
    fontSize: 14,
    color: c.primary,
  },
});