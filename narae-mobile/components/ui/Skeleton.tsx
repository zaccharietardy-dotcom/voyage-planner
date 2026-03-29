import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface Props {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, radius = 8, style }: Props) {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.7, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius: radius,
          backgroundColor: '#1e293b',
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Pre-built skeleton for a TripCard placeholder */
export function TripCardSkeleton() {
  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
      <Skeleton height={180} radius={16} />
      <View style={{ padding: 14, gap: 8 }}>
        <Skeleton width={180} height={18} />
        <Skeleton width={120} height={14} />
      </View>
    </View>
  );
}
