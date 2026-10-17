import React, {useRef} from 'react';
import {Animated, TouchableOpacity, TouchableOpacityProps} from 'react-native';

type Props = TouchableOpacityProps & {scaleTo?: number};

/** Карточка с лёгким пружинным сжатием при нажатии. */
export default function PressScale({scaleTo = 0.97, onPressIn, onPressOut, children, ...rest}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => {
    Animated.spring(scale, {toValue, useNativeDriver: true, speed: 40, bounciness: 2}).start();
  };
  return (
    <Animated.View style={{transform: [{scale}]}}>
      <TouchableOpacity
        {...rest}
        activeOpacity={rest.activeOpacity ?? 0.85}
        onPressIn={(e) => { animate(scaleTo); onPressIn?.(e); }}
        onPressOut={(e) => { animate(1); onPressOut?.(e); }}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}
