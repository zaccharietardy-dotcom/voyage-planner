import { View, Text, Pressable } from 'react-native';
import { User, Heart, Users, Baby, UserCheck, Minus, Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { GROUP_TYPE_LABELS, type GroupType, type TripPreferences } from '@/lib/types/trip';
import { colors, fonts, radius } from '@/lib/theme';
import type { LucideIcon } from 'lucide-react-native';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const GROUP_OPTIONS: { value: GroupType; icon: LucideIcon; emoji: string }[] = [
  { value: 'solo', icon: User, emoji: '🧑' },
  { value: 'couple', icon: Heart, emoji: '💑' },
  { value: 'friends', icon: Users, emoji: '👥' },
  { value: 'family_with_kids', icon: Baby, emoji: '👨‍👩‍👧‍👦' },
  { value: 'family_without_kids', icon: UserCheck, emoji: '👫' },
];

export function StepGroup({ prefs, onChange }: Props) {
  const size = prefs.groupSize ?? 2;
  const type = prefs.groupType ?? 'couple';

  const setSize = (n: number) => {
    Haptics.selectionAsync();
    const clamped = Math.max(1, Math.min(20, n));
    const updates: Partial<TripPreferences> = { groupSize: clamped };
    // Auto-adjust type
    if (clamped === 1) updates.groupType = 'solo';
    else if (clamped >= 2 && type === 'solo') updates.groupType = 'couple';
    onChange(updates);
  };

  const setType = (t: GroupType) => {
    Haptics.selectionAsync();
    const updates: Partial<TripPreferences> = { groupType: t };
    if (t === 'solo' && size !== 1) updates.groupSize = 1;
    else if (t !== 'solo' && size === 1) updates.groupSize = 2;
    onChange(updates);
  };

  return (
    <View style={{ gap: 32 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display }}>
          Avec qui partez-vous ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, marginTop: 4 }}>
          Pour adapter les activités et le rythme
        </Text>
      </View>

      {/* Group Size */}
      <View style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, borderCurve: 'continuous', padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 20, textAlign: 'center' }}>Nombre de voyageurs</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
          <Pressable
            onPress={() => setSize(size - 1)}
            style={{
              width: 56, height: 56, borderRadius: radius.xl,
              borderCurve: 'continuous',
              backgroundColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
              opacity: size <= 1 ? 0.3 : 1,
            }}
          >
            <Minus size={24} color={colors.text} />
          </Pressable>
          <View style={{ alignItems: 'center', minWidth: 80 }}>
            <Text style={{ color: colors.gold, fontSize: 48, fontFamily: fonts.display }}>{size}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sansMedium }}>{size === 1 ? 'Voyageur' : 'Voyageurs'}</Text>
          </View>
          <Pressable
            onPress={() => setSize(size + 1)}
            style={{
              width: 56, height: 56, borderRadius: radius.xl,
              borderCurve: 'continuous',
              backgroundColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
              opacity: size >= 20 ? 0.3 : 1,
            }}
          >
            <Plus size={24} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Group Type */}
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 0 }}>Type de voyage</Text>
        <View style={{ gap: 10 }}>
          {GROUP_OPTIONS.map((opt) => {
            const selected = type === opt.value;
            const label = GROUP_TYPE_LABELS[opt.value].replace(/\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u, '');

            return (
              <Pressable
                key={opt.value}
                onPress={() => setType(opt.value)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 16,
                  padding: 18, borderRadius: radius.xl,
                  borderCurve: 'continuous',
                  backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.06)',
                  borderWidth: 1, borderColor: selected ? colors.gold : 'rgba(255,255,255,0.12)',
                }}
              >
                <View style={{
                  width: 48, height: 48, borderRadius: radius.lg,
                  borderCurve: 'continuous',
                  backgroundColor: selected ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.06)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 24 }}>{opt.emoji}</Text>
                </View>
                <Text style={{ color: selected ? colors.gold : colors.text, fontSize: 16, fontFamily: fonts.sansSemiBold }}>
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
