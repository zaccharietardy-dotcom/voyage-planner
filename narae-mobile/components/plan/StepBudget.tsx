import { View, Text, Pressable } from 'react-native';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius } from '@/lib/theme';
import {
  BUDGET_LABELS, TRANSPORT_LABELS,
  type BudgetLevel, type TransportType, type TripPreferences,
} from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const TRANSPORT_OPTIONS: { value: TransportType; emoji: string }[] = [
  { value: 'optimal', emoji: '🎯' },
  { value: 'plane', emoji: '✈️' },
  { value: 'train', emoji: '🚄' },
  { value: 'car', emoji: '🚗' },
  { value: 'bus', emoji: '🚌' },
];

export function StepBudget({ prefs, onChange }: Props) {
  const budget = prefs.budgetLevel ?? 'moderate';
  const transport = prefs.transport ?? 'optimal';

  return (
    <View style={{ gap: 32 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display }}>
          Quel budget ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, marginTop: 4 }}>
          Pour adapter le confort de votre séjour
        </Text>
      </View>

      {/* Budget level */}
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 0 }}>Niveau de confort</Text>
        <View style={{ gap: 10 }}>
          {(Object.entries(BUDGET_LABELS) as [BudgetLevel, { label: string; range: string }][]).map(([key, { label, range }]) => {
            const selected = budget === key;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  Haptics.selectionAsync();
                  onChange({ budgetLevel: key });
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.06)',
                  borderWidth: 1,
                  borderColor: selected ? colors.gold : 'rgba(255,255,255,0.12)',
                  borderRadius: radius.xl, borderCurve: 'continuous', padding: 20,
                }}
              >
                <View>
                  <Text style={{ color: selected ? colors.gold : colors.text, fontSize: 16, fontFamily: fonts.sansSemiBold }}>
                    {label}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13, fontFamily: fonts.sansMedium, marginTop: 4 }}>{range} / personne</Text>
                </View>
                {selected && <Check size={20} color={colors.gold} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Transport mode */}
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 0 }}>Transport favori</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {TRANSPORT_OPTIONS.map((opt) => {
            const selected = transport === opt.value;
            const label = TRANSPORT_LABELS[opt.value].replace(/\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u, '').replace(/\s*\(.*\)/, '');
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  Haptics.selectionAsync();
                  onChange({ transport: opt.value });
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingHorizontal: 18, paddingVertical: 12, borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.06)',
                  borderWidth: 1, borderColor: selected ? colors.gold : 'rgba(255,255,255,0.12)',
                }}
              >
                <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
                <Text style={{ color: selected ? colors.gold : colors.text, fontSize: 14, fontFamily: fonts.sansSemiBold }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
