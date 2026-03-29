import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { 
  useAnimatedStyle, 
  useSharedValue, 
  withRepeat, 
  withTiming, 
  interpolate,
  Easing
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

export function PremiumBackground() {
  const anim = useSharedValue(0);

  React.useEffect(() => {
    anim.value = withRepeat(
      withTiming(1, { duration: 15000, easing: Easing.linear }),
      -1,
      true
    );
  }, []);

  const blob1Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(anim.value, [0, 1], [-20, 40]) },
      { translateY: interpolate(anim.value, [0, 1], [-10, 30]) },
      { scale: interpolate(anim.value, [0, 1], [1, 1.2]) },
    ],
  }));

  const blob2Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(anim.value, [0, 1], [30, -30]) },
      { translateY: interpolate(anim.value, [0, 1], [20, -20]) },
      { scale: interpolate(anim.value, [0, 1], [1.1, 0.9]) },
    ],
  }));

  return (
    <View style={styles.container}>
      {/* Base Deep Blue */}
      <View style={[styles.absolute, { backgroundColor: '#020617' }]} />

      {/* Animated Blobs */}
      <Animated.View style={[styles.blob, styles.blob1, blob1Style]}>
        <LinearGradient
          colors={['rgba(197,160,89,0.08)', 'transparent']}
          style={styles.fill}
        />
      </Animated.View>

      <Animated.View style={[styles.blob, styles.blob2, blob2Style]}>
        <LinearGradient
          colors={['rgba(59,130,246,0.05)', 'transparent']}
          style={styles.fill}
        />
      </Animated.View>

      {/* Vignette Overlay */}
      <LinearGradient
        colors={['transparent', 'rgba(2,6,23,0.8)', '#020617']}
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
  },
  blob1: {
    width: width * 1.2,
    height: width * 1.2,
    top: -width * 0.4,
    left: -width * 0.2,
  },
  blob2: {
    width: width,
    height: width,
    bottom: -width * 0.2,
    right: -width * 0.1,
  },
});
