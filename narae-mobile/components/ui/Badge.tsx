import { View, Text, Platform, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { fonts, radius } from '@/lib/theme';

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
    <Text style={[styles.label, { color: c.text }]}>
      {label}
    </Text>
  );

  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={24} tint="dark" style={[styles.container, { borderColor: c.border }]}>
        <View style={[styles.inner, { backgroundColor: c.bg }]}>
          {innerContent}
        </View>
      </BlurView>
    );
  }

  return (
    <View style={[styles.container, styles.inner, { backgroundColor: c.bg, borderColor: c.border }]}>
      {innerContent}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.full,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  inner: {
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  label: {
    fontSize: 9,
    fontFamily: fonts.sansBold,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
});
