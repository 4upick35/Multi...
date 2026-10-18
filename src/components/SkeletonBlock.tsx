import React, {useEffect, useRef} from 'react';
import {Animated} from 'react-native';
import type {DimensionValue, StyleProp, ViewStyle} from 'react-native';
import {useAppTheme} from '../theme';

type Props = {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

export default function SkeletonBlock({width = '100%', height = 84, style}: Props) {
  const {colors} = useAppTheme();
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {toValue: 0.75, duration: 650, useNativeDriver: true}),
        Animated.timing(opacity, {toValue: 0.35, duration: 650, useNativeDriver: true}),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {width: width as DimensionValue, height, borderRadius: 8, backgroundColor: colors.surface, opacity},
        style,
      ]}
    />
  );
}
