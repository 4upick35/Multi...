import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleProp, StyleSheet, ViewStyle} from 'react-native';

export type QuantumLoaderProps = {
  size?: number;
  color?: string;
  speed?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// 12 точек: угол поворота луча и фаза (в долях цикла) — из ldrs «Quantum».
const PARTICLES = [
  {angle: 8, phase: 0},
  {angle: 36, phase: 0.4},
  {angle: 72, phase: 0.9},
  {angle: 90, phase: 0.5},
  {angle: 144, phase: 0.3},
  {angle: 180, phase: 0.2},
  {angle: 216, phase: 0.6},
  {angle: 252, phase: 0.7},
  {angle: 300, phase: 0.1},
  {angle: 324, phase: 0.8},
  {angle: 335, phase: 0.2},
  {angle: 290, phase: 0.5},
];

const STEPS = Array.from({length: 21}, (_, i) => i / 20);
const OFFSET = [0.5, 0.4, 0.3, 0.2, 0.1, 0, -0.1, -0.2, -0.3, -0.4, -0.5, -0.4, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];
const SCALE = [0.73684, 0.684208, 0.631576, 0.578944, 0.526312, 0.47368, 0.526312, 0.578944, 0.631576, 0.684208, 0.73684, 0.789472, 0.842104, 0.894736, 0.947368, 1, 0.947368, 0.894736, 0.842104, 0.789472, 0.73684];
const OPACITY = [0.65, 0.58, 0.51, 0.44, 0.37, 0.3, 0.37, 0.44, 0.51, 0.58, 0.65, 0.72, 0.79, 0.86, 0.93, 1, 0.93, 0.86, 0.79, 0.72, 0.65];

/** Сдвигает кадры по фазе точки — эмуляция отрицательного animation-delay. */
function shift(frames: number[], phase: number): number[] {
  const offset = Math.round(phase * (STEPS.length - 1));
  return frames.map((_, i) => frames[(i + offset) % frames.length]);
}

export default function QuantumLoader({
  size = 45,
  color = '#111827',
  speed = 1.75,
  style,
  testID,
}: QuantumLoaderProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const orbit = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: speed * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const spin = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: speed * 4 * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    orbit.start();
    spin.start();
    return () => {
      orbit.stop();
      spin.stop();
    };
  }, [speed, progress, rotation]);

  const dots = useMemo(
    () =>
      PARTICLES.map(({angle, phase}) => {
        const translateX = progress.interpolate({
          inputRange: STEPS,
          outputRange: shift(OFFSET, phase).map(v => v * size),
          extrapolate: 'clamp',
        });
        const scale = progress.interpolate({
          inputRange: STEPS,
          outputRange: shift(SCALE, phase),
          extrapolate: 'clamp',
        });
        const opacity = progress.interpolate({
          inputRange: STEPS,
          outputRange: shift(OPACITY, phase),
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={angle}
            style={[styles.particle, {width: size, height: size, transform: [{rotateZ: `${angle}deg`}]}]}
          >
            <Animated.View
              style={[
                styles.dot,
                {
                  width: size * 0.175,
                  height: size * 0.175,
                  backgroundColor: color,
                  opacity,
                  transform: [{translateX}, {scale}],
                },
              ]}
            />
          </Animated.View>
        );
      }),
    [size, color, progress],
  );

  const spin = rotation.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});

  return (
    <Animated.View
      testID={testID}
      style={[styles.container, {width: size, height: size, transform: [{rotateZ: spin}]}, style]}
    >
      {dots}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    borderRadius: 999,
  },
});
