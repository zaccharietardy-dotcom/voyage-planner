import { View, type ViewStyle, type ViewProps } from 'react-native';
import { colors, radius } from '@/lib/theme';
import type { ReactNode } from 'react';

interface Props extends ViewProps {
  variant?: 'default' | 'elevated' | 'premium';
  children: ReactNode;
}

export function Card({ variant = 'default', children, style, ...rest }: Props) {
  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: variant === 'premium' ? colors.goldBorder : colors.borderSubtle,
    borderRadius: radius['3xl'],
    padding: 16,
  };

  const elevated: ViewStyle = variant === 'elevated' || variant === 'premium'
    ? {
        shadowColor: variant === 'premium' ? colors.gold : '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: variant === 'premium' ? 0.15 : 0.2,
        shadowRadius: 12,
        elevation: 6,
      }
    : {};

  return (
    <View style={[base, elevated, style]} {...rest}>
      {children}
    </View>
  );
}
