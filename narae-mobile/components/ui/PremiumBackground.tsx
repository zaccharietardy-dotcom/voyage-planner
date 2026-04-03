import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export function PremiumBackground() {
  const { width, height } = useWindowDimensions();
  const anim = useSharedValue(0);

  React.useEffect(() => {
    anim.value = withRepeat(
      withTiming(1, { duration: 20000, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
      -1,
      true
    );
  }, [anim]);

  const blob1Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(anim.value, [0, 1], [-width * 0.08, width * 0.12]) },
      { translateY: interpolate(anim.value, [0, 1], [-height * 0.04, height * 0.06]) },
      { scale: interpolate(anim.value, [0, 1], [1, 1.14]) },
    ],
  }));

  const blob2Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(anim.value, [0, 1], [width * 0.1, -width * 0.08]) },
      { translateY: interpolate(anim.value, [0, 1], [height * 0.06, -height * 0.04]) },
      { scale: interpolate(anim.value, [0, 1], [1.05, 0.92]) },
    ],
  }));

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#020617', '#040b19', '#020617']}
        style={styles.absolute}
      />

      <Animated.View
        style={[
          styles.blob,
          {
            width: width * 1.35,
            height: width * 1.35,
            top: -width * 0.42,
            right: -width * 0.2,
          },
          blob1Style,
        ]}
      >
        <LinearGradient
          colors={['rgba(197,160,89,0.16)', 'rgba(197,160,89,0.02)', 'transparent']}
          style={styles.fill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.blob,
          {
            width: width * 1.3,
            height: width * 1.3,
            bottom: -width * 0.45,
            left: -width * 0.35,
          },
          blob2Style,
        ]}
      >
        <LinearGradient
          colors={['rgba(56,189,248,0.12)', 'rgba(56,189,248,0.02)', 'transparent']}
          style={styles.fill}
        />
      </Animated.View>

      <View style={[styles.absolute, { top: -height * 0.35, left: -width * 0.35 }]}>
        <LinearGradient
          colors={['rgba(255,255,255,0.03)', 'transparent']}
          style={{ width: width * 1.4, height: height * 0.8 }}
        />
      </View>

      <LinearGradient
        colors={['rgba(2,6,23,0.08)', 'rgba(2,6,23,0.58)', 'rgba(2,6,23,0.94)']}
        style={styles.absolute}
      />

      <LinearGradient
        colors={['rgba(255,255,255,0.015)', 'transparent', 'rgba(255,255,255,0.008)']}
        style={styles.absolute}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
    overflow: 'hidden',
  },
  absolute: {
    ...StyleSheet.absoluteFillObject,
  },
  fill: {
    flex: 1,
  },
  blob: {
    position: 'absolute',
    borderRadius: 1000,
    borderCurve: 'continuous',
  },
});
