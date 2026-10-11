import React, {useMemo} from 'react';
import {View, StyleSheet} from 'react-native';
import {Text} from 'react-native-paper';
import {useAppTheme} from '../theme';

type Props = {name: string; color: string; size?: number};
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

export default function AccountAvatar({name, color, size = 36}: Props) {
  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const initial = name.charAt(0).toUpperCase();
  return (
    <View style={[styles.container, {width: size, height: size, borderRadius: size / 2, backgroundColor: color}]}>
      <Text style={[styles.text, {fontSize: size * 0.45}]}>{initial}</Text>
    </View>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {justifyContent: 'center', alignItems: 'center'},
  text: {color: c.onBackground, fontWeight: 'bold'},
});