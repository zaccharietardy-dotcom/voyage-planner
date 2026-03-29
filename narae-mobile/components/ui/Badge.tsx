import { View, Text } from 'react-native';

type Variant = 'upcoming' | 'active' | 'past' | 'gold';

interface Props {
  variant: Variant;
  label: string;
}

const COLORS: Record<Variant, { bg: string; text: string }> = {
  upcoming: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  active: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80' },
  past: { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' },
  gold: { bg: 'rgba(197,160,89,0.15)', text: '#c5a059' },
};

export function Badge({ variant, label }: Props) {
  const { bg, text } = COLORS[variant];
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
      <Text style={{ color: text, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
