import { Pressable, Text, ActivityIndicator, Animated, type ViewStyle, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { goldGradient, colors, radius, fonts } from '@/lib/theme';

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

const BG: Record<Variant, string> = {
  primary: 'transparent', // handled by LinearGradient
  secondary: '#1e293b',
  outline: 'transparent',
  ghost: 'transparent',
  danger: '#dc2626',
};

const TEXT_COLOR: Record<Variant, string> = {
  primary: '#020617',
  secondary: '#f8fafc',
  outline: '#f8fafc',
  ghost: '#94a3b8',
  danger: '#f8fafc',
};

const HEIGHT: Record<Size, number> = { sm: 36, md: 48, lg: 56 };
const FONT_SIZE: Record<Size, number> = { sm: 13, md: 15, lg: 17 };
const PADDING_H: Record<Size, number> = { sm: 14, md: 20, lg: 24 };

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
  const color = TEXT_COLOR[variant];
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (isDisabled) return;
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
    }).start();
  };

  const baseStyle: ViewStyle = {
    height: HEIGHT[size],
    borderRadius: radius.button,
    paddingHorizontal: PADDING_H[size],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    opacity: isDisabled ? 0.5 : 1,
    ...(variant === 'outline' ? { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)' } : {}),
  };

  const textStyle: TextStyle = {
    color,
    fontSize: FONT_SIZE[size],
    fontFamily: variant === 'primary' && size === 'lg' ? fonts.sansBold : fonts.sansSemiBold,
    letterSpacing: variant === 'primary' ? 0.3 : 0,
  };

  const content = isLoading ? (
    <ActivityIndicator size="small" color={color} />
  ) : (
    <>
      {Icon && iconPosition === 'left' && <Icon size={FONT_SIZE[size] + 2} color={color} strokeWidth={2.5} />}
      <Text style={[textStyle, textStyleProp]}>{children}</Text>
      {Icon && iconPosition === 'right' && <Icon size={FONT_SIZE[size] + 2} color={color} strokeWidth={2.5} />}
    </>
  );

  if (variant === 'primary') {
    return (
      <Animated.View style={[{ transform: [{ scale }] }, styleProp]}>
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isDisabled}
          style={{
            shadowColor: colors.gold,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.35,
            shadowRadius: 15,
            elevation: 10,
          }}
        >
          <LinearGradient
            colors={[...goldGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[baseStyle, { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }]}
          >
            {content}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    );
  }


  return (
    <Animated.View style={[{ transform: [{ scale }] }, styleProp]}>
      <Pressable
        style={[baseStyle, { backgroundColor: BG[variant] }]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}
