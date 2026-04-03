import { useEffect, useCallback } from 'react';
import { View, Pressable, Modal, useWindowDimensions, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius } from '@/lib/theme';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Height as percentage of screen height (0-1). Default 0.5 */
  height?: number;
}

const SPRING = { damping: 20, stiffness: 200, mass: 0.8 };

export function BottomSheet({ isOpen, onClose, children, height = 0.5 }: Props) {
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetH = Math.min(screenH * height, screenH - insets.top - 20);
  const translateY = useSharedValue(sheetH);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (isOpen) {
      translateY.value = withSpring(0, SPRING);
      backdropOpacity.value = withTiming(1, { duration: 200 });
    } else {
      translateY.value = withSpring(sheetH, SPRING);
      backdropOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [isOpen, sheetH, translateY, backdropOpacity]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const handleClose = useCallback(() => {
    translateY.value = withSpring(sheetH, SPRING, (finished) => {
      if (finished) runOnJS(onClose)();
    });
    backdropOpacity.value = withTiming(0, { duration: 200 });
  }, [sheetH, translateY, backdropOpacity, onClose]);

  if (!isOpen) return null;

  const sheetContainer: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: sheetH,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius['3xl'],
    borderTopRightRadius: radius['3xl'],
    paddingTop: 8,
    paddingBottom: insets.bottom,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  };

  return (
    <Modal transparent visible={isOpen} animationType="none" onRequestClose={handleClose}>
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={[{ flex: 1, backgroundColor: 'rgba(2,6,23,0.74)' }, backdropStyle]}>
          <Pressable style={{ flex: 1 }} onPress={handleClose} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View style={[sheetContainer, sheetStyle]}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingBottom: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(148,163,184,0.45)' }} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
