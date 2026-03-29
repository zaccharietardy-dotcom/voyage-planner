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
  const sheetH = screenH * height;
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
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    overflow: 'hidden',
  };

  return (
    <Modal transparent visible={isOpen} animationType="none" onRequestClose={handleClose}>
      <View style={{ flex: 1 }}>
        {/* Backdrop */}
        <Animated.View style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }, backdropStyle]}>
          <Pressable style={{ flex: 1 }} onPress={handleClose} />
        </Animated.View>

        {/* Sheet */}
        <Animated.View style={[sheetContainer, sheetStyle]}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingBottom: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#334155' }} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
