import { Pressable, Text, ActivityIndicator, Animated, StyleSheet, ViewStyle, TextStyle, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { goldGradient, colors, radius, fonts } from '@/lib/theme';
import * as Haptics from 'expo-haptics';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  children: string;
  onPress: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

const HEIGHT: Record<Size, number> = { sm: 36, md: 48, lg: 56 };
const FONT_SIZE: Record<Size, number> = { sm: 13, md: 15, lg: 16 };
const PADDING_H: Record<Size, number> = { sm: 16, md: 24, lg: 32 };

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading,
  disabled,
  icon: Icon,
  iconPosition = 'left',
  children,
  onPress,
  style: styleProp,
  textStyle: textStyleProp,
}: Props) {
  const isDisabled = disabled || isLoading;
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (isDisabled) return;
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
    }).start();
  };

  const handlePress = () => {
    if (isDisabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const renderContent = () => {
    if (isLoading) {
      return <ActivityIndicator size="small" color={variant === 'primary' ? colors.bg : colors.gold} />;
    }

    const iconColor = variant === 'primary' ? colors.bg : (variant === 'danger' ? '#fff' : colors.gold);
    const textColor = variant === 'primary' ? colors.bg : (variant === 'danger' ? '#fff' : (variant === 'ghost' ? colors.textMuted : colors.text));

    return (
      <View style={styles.content}>
        {Icon && iconPosition === 'left' && <Icon size={size === 'sm' ? 16 : 20} color={iconColor} strokeWidth={2.5} />}
        <Text style={[
          styles.text, 
          { color: textColor, fontSize: FONT_SIZE[size] },
          variant === 'primary' && { fontFamily: fonts.sansBold },
          textStyleProp
        ]}>
          {children}
        </Text>
        {Icon && iconPosition === 'right' && <Icon size={size === 'sm' ? 16 : 20} color={iconColor} strokeWidth={2.5} />}
      </View>
    );
  };

  const buttonStyle = [
    styles.base,
    { height: HEIGHT[size], paddingHorizontal: PADDING_H[size] },
    variant === 'secondary' && styles.secondary,
    variant === 'outline' && styles.outline,
    variant === 'danger' && styles.danger,
    variant === 'ghost' && styles.ghost,
    isDisabled && { opacity: 0.5 },
    styleProp,
  ];

  if (variant === 'primary') {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isDisabled}
          style={styles.shadow}
        >
          <LinearGradient
            colors={[...goldGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.base, { height: HEIGHT[size], paddingHorizontal: PADDING_H[size] }, styleProp]}
          >
            {renderContent()}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        style={buttonStyle}
      >
        {renderContent()}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  text: {
    fontFamily: fonts.sansSemiBold,
    textAlign: 'center',
  },
  secondary: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  danger: {
    backgroundColor: colors.danger,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  shadow: {
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
});
