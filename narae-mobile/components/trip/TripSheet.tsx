import { useRef } from 'react';
import { View, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

const SPRING = { damping: 25, stiffness: 180, mass: 0.8 };

/**
 * Non-modal bottom sheet with 2 snap points + drag with finger.
 * Uses PanResponder (built-in) instead of react-native-gesture-handler.
 */
export function TripSheet({ children }: Props) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const snapOpen = screenH * 0.08 + insets.top;
  const snapClosed = screenH * 0.50;

  const translateY = useSharedValue(snapClosed);
  const startY = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 5,
      onPanResponderGrant: () => {
        startY.current = translateY.value;
      },
      onPanResponderMove: (_, gestureState) => {
        const next = startY.current + gestureState.dy;
        translateY.value = Math.max(snapOpen, Math.min(snapClosed + 50, next));
      },
      onPanResponderRelease: (_, gestureState) => {
        const mid = (snapOpen + snapClosed) / 2;
        if (gestureState.vy < -0.5 || translateY.value < mid) {
          translateY.value = withSpring(snapOpen, SPRING);
        } else {
          translateY.value = withSpring(snapClosed, SPRING);
        }
      },
    })
  ).current;

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.sheet, { height: screenH }, sheetStyle]}>
      {/* Drag handle */}
      <View {...panResponder.panHandlers} style={styles.handleWrap}>
        <View style={styles.handle} />
      </View>
      {/* Content */}
      <View style={[styles.content, { paddingBottom: insets.bottom }]}>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: '#0A1628',
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    borderCurve: 'continuous',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.5,
    shadowRadius: 40,
    elevation: 20,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
  },
  handle: {
    width: 48,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  content: {
    flex: 1,
  },
});
