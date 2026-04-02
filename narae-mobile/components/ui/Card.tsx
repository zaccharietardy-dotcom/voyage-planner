import { View, Platform, type ViewStyle, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, radius } from '@/lib/theme';
import type { ReactNode } from 'react';

interface Props extends ViewProps {
  variant?: 'default' | 'elevated' | 'premium' | 'glass';
  children: ReactNode;
}

export function Card({ variant = 'default', children, style, ...rest }: Props) {
  const base: ViewStyle = {
    backgroundColor: variant === 'glass'
      ? 'rgba(255,255,255,0.05)'
      : 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: variant === 'premium'
      ? 'rgba(197,160,89,0.2)'
      : 'rgba(255,255,255,0.1)',
    borderRadius: radius.card,
    padding: 16,
    overflow: 'hidden',
  };

  const shadow: ViewStyle =
    variant === 'elevated'
      ? {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 4,
        }
      : variant === 'premium'
        ? {
            shadowColor: colors.gold,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.05,
            shadowRadius: 12,
            elevation: 4,
          }
        : {};

  // Glass variant: BlurView on iOS, plain semi-transparent bg on Android
  if (variant === 'glass' && Platform.OS === 'ios') {
    return (
      <View style={[base, shadow, style]} {...rest}>
        <BlurView
          intensity={20}
          tint="dark"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
        {children}
      </View>
    );
  }

  return (
    <View style={[base, shadow, style]} {...rest}>
      {children}
    </View>
  );
}
