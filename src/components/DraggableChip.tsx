import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef} from 'react';
import {Animated, StyleSheet, TouchableOpacity} from 'react-native';
import type {LayoutChangeEvent, StyleProp, ViewStyle} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {hapticFeedback} from '../native/KeepAlive';

type ChipLayout = {x: number; width: number};

type Props = {
  index: number;
  active?: boolean;
  disabled?: boolean;
  shiftPx?: number;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
  onDragStart: (index: number) => void;
  onDragMove: (index: number, dx: number, dy: number) => void;
  onDragEnd: (index: number, dx: number, dy: number) => void;
  onDragCancel: (index: number) => void;
  registerLayout: (index: number, layout: ChipLayout) => void;
  children: React.ReactNode;
};

const PICKUP_MS = 250;
const SHIFT_MS = 150;
const DROP_MS = 100;
const SPRING = {friction: 7, tension: 120};

export default function DraggableChip({
  index,
  active,
  disabled,
  shiftPx = 0,
  style,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  registerLayout,
  children,
}: Props) {
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      shiftX.stopAnimation();
      shiftX.setValue(0);
      return;
    }
    Animated.timing(shiftX, {
      toValue: shiftPx,
      duration: SHIFT_MS,
      useNativeDriver: false,
    }).start();
  }, [active, shiftPx, shiftX]);

  // После перестановки индексов сбрасываем смещение до отрисовки кадра,
  // чтобы чип оказался точно в новой ячейке.
  useLayoutEffect(() => {
    dragX.stopAnimation();
    dragY.stopAnimation();
    dragX.setValue(0);
    dragY.setValue(0);
  }, [dragX, dragY, index]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const {x, width} = event.nativeEvent.layout;
      registerLayout(index, {x, width});
    },
    [index, registerLayout],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(PICKUP_MS)
        .onStart(() => {
          Animated.spring(lift, {
            toValue: 1,
            ...SPRING,
            useNativeDriver: false,
          }).start();
          hapticFeedback('light');
          onDragStart(index);
        })
        .onUpdate(event => {
          dragX.setValue(event.translationX);
          dragY.setValue(event.translationY);
          onDragMove(index, event.translationX, event.translationY);
        })
        .onEnd(event => {
          onDragEnd(index, event.translationX, event.translationY);
        })
        .onFinalize((_event, success) => {
          Animated.spring(lift, {
            toValue: 0,
            ...SPRING,
            useNativeDriver: false,
          }).start();
          Animated.timing(dragX, {
            toValue: 0,
            duration: DROP_MS,
            useNativeDriver: false,
          }).start();
          Animated.timing(dragY, {
            toValue: 0,
            duration: DROP_MS,
            useNativeDriver: false,
          }).start();
          if (!success) {
            onDragCancel(index);
          }
        }),
    [dragX, dragY, index, lift, onDragCancel, onDragEnd, onDragMove, onDragStart],
  );

  const scale = lift.interpolate({inputRange: [0, 1], outputRange: [1, 1.08]});
  const transform = [
    {translateX: Animated.add(dragX, shiftX)},
    {translateY: dragY},
    {scale},
  ];

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        onLayout={handleLayout}
        style={[styles.wrapper, active ? styles.lifted : null, {transform}]}>
        <TouchableOpacity
          style={style}
          disabled={disabled}
          onPress={onPress}
          activeOpacity={0.9}>
          {children}
        </TouchableOpacity>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrapper: {flexShrink: 1},
  lifted: {zIndex: 10},
});
