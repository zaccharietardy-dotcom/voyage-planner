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
        <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, fontWeight: 'bold' }}>
          Quel budget ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>
          Pour adapter le confort de votre séjour
        </Text>
      </View>

      {/* Budget level */}
      <View style={{ gap: 16 }}>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Niveau de confort</Text>
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
                  backgroundColor: selected ? colors.goldBg : 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: selected ? colors.gold : 'rgba(255,255,255,0.05)',
                  borderRadius: 24, padding: 20,
                }}
              >
                <View>
                  <Text style={{ color: selected ? colors.gold : '#f8fafc', fontSize: 17, fontWeight: 'bold' }}>
                    {label}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 4, fontWeight: '600' }}>{range} / personne</Text>
                </View>
                {selected && <Check size={22} color={colors.gold} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Transport mode */}
      <View style={{ gap: 16 }}>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Transport favori</Text>
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
                  paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16,
                  backgroundColor: selected ? colors.goldBg : 'rgba(255,255,255,0.03)',
                  borderWidth: 1, borderColor: selected ? colors.gold : 'rgba(255,255,255,0.05)',
                }}
              >
                <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
                <Text style={{ color: selected ? colors.gold : colors.textSecondary, fontSize: 14, fontWeight: '700' }}>
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
