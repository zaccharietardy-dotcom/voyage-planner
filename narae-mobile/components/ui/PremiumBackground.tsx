import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { 
  useAnimatedStyle, 
  useSharedValue, 
  withRepeat, 
  withTiming, 
  interpolate,
  Easing
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
      { translateX: interpolate(anim.value, [0, 1], [-width * 0.2, width * 0.3]) },
      { translateY: interpolate(anim.value, [0, 1], [-height * 0.1, height * 0.2]) },
      { scale: interpolate(anim.value, [0, 1], [1, 1.4]) },
      { rotate: `${interpolate(anim.value, [0, 1], [0, 45])}deg` },
    ],
  }));

  const blob2Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(anim.value, [0, 1], [width * 0.4, -width * 0.2]) },
      { translateY: interpolate(anim.value, [0, 1], [height * 0.3, -height * 0.1]) },
      { scale: interpolate(anim.value, [0, 1], [1.2, 0.8]) },
      { rotate: `${interpolate(anim.value, [0, 1], [0, -30])}deg` },
    ],
  }));

  const blob3Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(anim.value, [0, 1], [-width * 0.1, width * 0.1]) },
      { translateY: interpolate(anim.value, [0, 1], [height * 0.6, height * 0.4]) },
      { scale: interpolate(anim.value, [0, 1], [0.8, 1.2]) },
    ],
  }));

  return (
    <View style={styles.container}>
      {/* Base Deep Night Blue */}
      <View style={[styles.absolute, { backgroundColor: '#020617' }]} />

      {/* Animated Blobs for Depth */}
      <Animated.View style={[styles.blob, { width: width * 1.5, height: width * 1.5, top: -width * 0.5, left: -width * 0.3 }, blob1Style]}>
        <LinearGradient
          colors={['rgba(197,160,89,0.12)', 'transparent']}
          style={styles.fill}
        />
      </Animated.View>

      <Animated.View style={[styles.blob, { width: width * 1.2, height: width * 1.2, bottom: -width * 0.3, right: -width * 0.2 }, blob2Style]}>
        <LinearGradient
          colors={['rgba(59,130,246,0.08)', 'transparent']}
          style={styles.fill}
        />
      </Animated.View>

      <Animated.View style={[styles.blob, { width, height: width, bottom: height * 0.1, left: -width * 0.4 }, blob3Style]}>
        <LinearGradient
          colors={['rgba(139,92,246,0.06)', 'transparent']}
          style={styles.fill}
        />
      </Animated.View>

      {/* Surface Glow */}
      <View style={[styles.absolute, { top: -height * 0.5, left: -width * 0.5 }]}>
        <LinearGradient
          colors={['rgba(197,160,89,0.05)', 'transparent']}
          style={{ width: width * 2, height: height }}
        />
      </View>

      {/* Vignette Overlay for Premium Feel */}
      <LinearGradient
        colors={['rgba(2,6,23,0.2)', 'rgba(2,6,23,0.7)', '#020617']}
        style={styles.absolute}
      />
      
      {/* Subtle Noise/Grain (Simulated via very faint pattern or gradient) */}
      <LinearGradient
        colors={['rgba(255,255,255,0.01)', 'transparent']}
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

