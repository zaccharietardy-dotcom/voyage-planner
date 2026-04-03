import { View, Text, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { fonts } from '@/lib/theme';

type Variant = 'upcoming' | 'active' | 'past' | 'gold';

interface Props {
  variant: Variant;
  label: string;
}

const COLORS: Record<Variant, { bg: string; text: string; border: string }> = {
  upcoming: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
  active: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80', border: 'rgba(34,197,94,0.2)' },
  past: { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8', border: 'rgba(100,116,139,0.2)' },
  gold: { bg: 'rgba(197,160,89,0.15)', text: '#c5a059', border: 'rgba(197,160,89,0.2)' },
};

export function Badge({ variant, label }: Props) {
  const c = COLORS[variant];

  const innerContent = (
    <Text style={{
      color: c.text,
      fontSize: 9,
      fontWeight: '800',
      fontFamily: fonts.sansBold,
      letterSpacing: 1.5,
      textTransform: 'uppercase',
    }}>
      {label}
    </Text>
  );

  // BlurView works well on iOS; on Android fall back to a plain View
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={24}
        tint="dark"
        style={{
          borderRadius: 999,
          borderCurve: 'continuous',
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <View style={{
          backgroundColor: c.bg,
          paddingHorizontal: 12,
          paddingVertical: 5,
        }}>
          {innerContent}
        </View>
      </BlurView>
    );
  }

  return (
    <View style={{
      backgroundColor: c.bg,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 999,
      borderCurve: 'continuous',
      borderWidth: 1,
      borderColor: c.border,
    }}>
      {innerContent}
    </View>
  );
}
