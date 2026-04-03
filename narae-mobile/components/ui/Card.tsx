import { View, Platform, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { colors, radius } from '@/lib/theme';

interface Props extends ViewProps {
  variant?: 'default' | 'elevated' | 'premium' | 'glass';
  children: ReactNode;
}

export function Card({ variant = 'default', children, style, ...rest }: Props) {
  const variantStyle = VARIANT_STYLES[variant] ?? styles.default;
  const shadowStyle = SHADOW_STYLES[variant] ?? null;

  if (variant === 'glass' && Platform.OS === 'ios') {
    return (
      <View style={[styles.base, variantStyle, shadowStyle, style]} {...rest}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFillObject} />
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.base, variantStyle, shadowStyle, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
  },
  default: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  elevated: {
    backgroundColor: colors.card,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  premium: {
    backgroundColor: 'rgba(10,17,40,0.92)',
    borderColor: colors.goldBorder,
  },
  glass: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  elevatedShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 10,
  },
  premiumShadow: {
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 12,
  },
});

const VARIANT_STYLES: Record<NonNullable<Props['variant']>, ViewStyle> = {
  default: styles.default,
  elevated: styles.elevated,
  premium: styles.premium,
  glass: styles.glass,
};

const SHADOW_STYLES: Partial<Record<NonNullable<Props['variant']>, ViewStyle>> = {
  elevated: styles.elevatedShadow,
  premium: styles.premiumShadow,
};
