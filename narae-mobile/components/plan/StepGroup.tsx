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
    <View style={{ gap: 28 }}>
      {/* Group size */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 16 }}>
          Nombre de voyageurs
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
          <Pressable
            onPress={() => setSize(size - 1)}
            style={{
              width: 44, height: 44, borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.05)',
              alignItems: 'center', justifyContent: 'center',
              opacity: size <= 1 ? 0.3 : 1,
            }}
          >
            <Minus size={20} color="#f8fafc" />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ color: colors.gold, fontSize: 44, fontFamily: fonts.display }}>{size}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{size === 1 ? 'voyageur' : 'voyageurs'}</Text>
          </View>
          <Pressable
            onPress={() => setSize(size + 1)}
            style={{
              width: 44, height: 44, borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.05)',
              alignItems: 'center', justifyContent: 'center',
              opacity: size >= 20 ? 0.3 : 1,
            }}
          >
            <Plus size={20} color="#f8fafc" />
          </Pressable>
        </View>
      </View>

      {/* Group type */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 12 }}>
          Type de groupe
        </Text>
        <View style={{ gap: 8 }}>
          {GROUP_OPTIONS.map((opt) => {
            const selected = type === opt.value;
            const label = GROUP_TYPE_LABELS[opt.value].replace(/\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u, '');
            return (
              <Pressable
                key={opt.value}
                onPress={() => setType(opt.value)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  backgroundColor: selected ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: selected ? '#c5a059' : 'rgba(255,255,255,0.05)',
                  borderRadius: 14, padding: 16,
                }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
                </View>
                <Text style={{ color: selected ? '#c5a059' : '#e2e8f0', fontSize: 15, fontWeight: '600' }}>
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
