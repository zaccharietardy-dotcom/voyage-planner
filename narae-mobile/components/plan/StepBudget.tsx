import { View, Text, Pressable } from 'react-native';
import { Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
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
    <View style={{ gap: 28 }}>
      {/* Budget level */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 12 }}>
          Niveau de budget
        </Text>
        <View style={{ gap: 8 }}>
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
                  backgroundColor: selected ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: selected ? '#c5a059' : 'rgba(255,255,255,0.05)',
                  borderRadius: 14, padding: 16,
                }}
              >
                <View>
                  <Text style={{ color: selected ? '#c5a059' : '#f8fafc', fontSize: 15, fontWeight: '700' }}>
                    {label}
                  </Text>
                  <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{range} / personne</Text>
                </View>
                {selected && <Check size={20} color="#c5a059" />}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Transport mode */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 12 }}>
          Mode de transport
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                  backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 1, borderColor: selected ? '#c5a059' : 'transparent',
                }}
              >
                <Text style={{ fontSize: 16 }}>{opt.emoji}</Text>
                <Text style={{ color: selected ? '#c5a059' : '#94a3b8', fontSize: 13, fontWeight: '600' }}>
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
