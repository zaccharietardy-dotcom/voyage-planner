import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Plane } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function formatShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
}

// Heuristic pricing (same as web — deterministic per date)
function estimatePrice(dateStr: string, basePrice: number): { price: number; tier: 'cheap' | 'medium' | 'expensive' } {
  const d = new Date(dateStr);
  const dayOfWeek = d.getDay();
  const month = d.getMonth();
  let multiplier = 1;

  // Weekend premium
  if (dayOfWeek === 5 || dayOfWeek === 0) multiplier += 0.3;
  if (dayOfWeek === 6) multiplier += 0.15;
  // Weekday discount
  if (dayOfWeek === 2 || dayOfWeek === 3) multiplier -= 0.15;
  // Summer premium
  if (month >= 5 && month <= 7) multiplier += 0.4;
  // Holiday premium
  if (month === 11) multiplier += 0.5;
  // Low season
  if (month === 0 || month === 1 || month === 10) multiplier -= 0.2;

  // Deterministic noise
  const hash = dateStr.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  multiplier += ((hash % 20) - 10) / 100;

  const price = Math.round(basePrice * Math.max(0.5, multiplier));
  const tier = multiplier < 0.9 ? 'cheap' : multiplier > 1.2 ? 'expensive' : 'medium';
  return { price, tier };
}

const TIER_COLORS = {
  cheap: '#4ade80',
  medium: colors.gold,
  expensive: '#f87171',
};

export function FlightDatePicker({ origin, destination, date }: Props) {
  const basePrice = 150;
  const days = [-2, -1, 0, 1, 2];

  const openAviasales = (dateStr: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const url = `https://www.aviasales.com/search/${origin}${dateStr.replace(/-/g, '')}${destination}1`;
    Linking.openURL(url);
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Plane size={14} color={colors.gold} />
        <Text style={s.title}>Dates flexibles</Text>
      </View>
      <View style={s.grid}>
        {days.map((offset) => {
          const dateStr = addDays(date, offset);
          const { price, tier } = estimatePrice(dateStr, basePrice);
          const isCenter = offset === 0;
          return (
            <Pressable
              key={offset}
              onPress={() => openAviasales(dateStr)}
              style={[s.cell, isCenter && s.cellCenter]}
            >
              <Text style={[s.cellDate, isCenter && s.cellDateCenter]}>
                {formatShort(dateStr)}
              </Text>
              <Text style={[s.cellPrice, { color: TIER_COLORS[tier] }]}>
                {price}€
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sansBold },
  grid: { flexDirection: 'row', gap: 6 },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  cellCenter: {
    backgroundColor: 'rgba(197,160,89,0.08)',
    borderColor: 'rgba(197,160,89,0.2)',
  },
  cellDate: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.sans },
  cellDateCenter: { color: colors.text, fontFamily: fonts.sansBold },
  cellPrice: { fontSize: 14, fontFamily: fonts.sansBold },
});
