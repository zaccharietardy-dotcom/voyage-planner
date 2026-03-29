import { Pressable, Text, ActivityIndicator, type ViewStyle, type TextStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

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
  primary: '#c5a059',
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

  const containerStyle: ViewStyle = {
    backgroundColor: BG[variant],
    height: HEIGHT[size],
    borderRadius: 14,
    paddingHorizontal: PADDING_H[size],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    opacity: isDisabled ? 0.5 : 1,
    ...(variant === 'outline' ? { borderWidth: 1, borderColor: '#334155' } : {}),
  };

  const textStyle: TextStyle = {
    color,
    fontSize: FONT_SIZE[size],
    fontWeight: '700',
  };

  return (
    <Pressable
      style={({ pressed }) => [containerStyle, styleProp, pressed && !isDisabled && { opacity: 0.8 }]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <>
          {Icon && iconPosition === 'left' && <Icon size={FONT_SIZE[size] + 2} color={color} />}
          <Text style={[textStyle, textStyleProp]}>{children}</Text>
          {Icon && iconPosition === 'right' && <Icon size={FONT_SIZE[size] + 2} color={color} />}
        </>
      )}
    </Pressable>
  );
}
