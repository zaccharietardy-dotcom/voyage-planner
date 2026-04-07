import { View, Text, Pressable, StyleSheet } from 'react-native';
import { User, Heart, Users, Baby, UserCheck, Minus, Plus } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { GROUP_TYPE_LABELS, type GroupType, type TripPreferences } from '@/lib/types/trip';
import { colors, fonts } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import type { LucideIcon } from 'lucide-react-native';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const GROUP_OPTIONS: { value: GroupType; Icon: LucideIcon; emoji: string }[] = [
  { value: 'solo', Icon: User, emoji: '🧑' },
  { value: 'couple', Icon: Heart, emoji: '💑' },
  { value: 'friends', Icon: Users, emoji: '👥' },
  { value: 'family_with_kids', Icon: Baby, emoji: '👨‍👩‍👧‍👦' },
  { value: 'family_without_kids', Icon: UserCheck, emoji: '👫' },
];

export function StepGroup({ prefs, onChange }: Props) {
  const { t } = useTranslation();
  const size = prefs.groupSize ?? 2;
  const type = prefs.groupType ?? 'couple';

  const setSize = (n: number) => {
    Haptics.selectionAsync();
    const clamped = Math.max(1, Math.min(20, n));
    const updates: Partial<TripPreferences> = { groupSize: clamped };
    if (clamped === 1) updates.groupType = 'solo';
    else if (clamped >= 2 && type === 'solo') updates.groupType = 'couple';
    onChange(updates);
  };

  const setType = (t: GroupType) => {
    Haptics.selectionAsync();
    const updates: Partial<TripPreferences> = { groupType: t };
    if (t === 'solo') updates.groupSize = 1;
    else if (t === 'couple') updates.groupSize = 2;
    else if (size < 2) updates.groupSize = 2;
    onChange(updates);
  };

  return (
    <View style={{ gap: 32 }}>
      {/* Title — matches web text-4xl font-serif font-bold */}
      <View style={{ alignItems: 'center' }}>
        <Text style={s.title}>{t('plan.group.title')}</Text>
        <Text style={s.subtitle}>{t('plan.group.subtitle')}</Text>
      </View>

      {/* Counter — matches web rounded-[2.5rem] border-white/[0.08] bg-[#0e1220]/50 p-10 */}
      <View style={s.counterBox}>
        {/* Gold glow background effect */}
        <View style={s.counterGlow} />

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, zIndex: 1 }}>
          <Pressable
            onPress={() => setSize(size - 1)}
            disabled={size <= 1}
            style={[s.counterButton, size <= 1 && { opacity: 0.3 }]}
          >
            <Minus size={24} color={colors.text} />
          </Pressable>

          {/* Giant number — matches web text-[5rem] font-serif */}
          <View style={{ alignItems: 'center', minWidth: 120, zIndex: 1 }}>
            <Text style={s.counterNumber}>{size}</Text>
          </View>

          <Pressable
            onPress={() => setSize(size + 1)}
            disabled={size >= 20}
            style={[s.counterButton, size >= 20 && { opacity: 0.3 }]}
          >
            <Plus size={24} color={colors.text} />
          </Pressable>
        </View>

        <Text style={s.counterLabel}>
          {size === 1 ? t('plan.group.singular') : t('plan.group.plural')}
        </Text>
      </View>

      {/* Group type — matches web grid-cols-2 gap-4 */}
      <View style={{ gap: 16 }}>
        <Text style={s.sectionLabel}>{t('plan.group.type')}</Text>
        <View style={s.typeGrid}>
          {GROUP_OPTIONS.map((opt) => {
            const selected = type === opt.value;
            const label = GROUP_TYPE_LABELS[opt.value]
              .replace(/\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u, '');

            return (
              <Pressable
                key={opt.value}
                onPress={() => setType(opt.value)}
                style={[s.typeCard, selected && s.typeCardSelected]}
              >
                <View style={[s.typeIcon, selected && s.typeIconSelected]}>
                  <opt.Icon size={22} color={selected ? '#000' : 'rgba(255,255,255,0.4)'} />
                </View>
                <Text style={[s.typeLabel, selected && { color: colors.text }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: 36,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 17,
    fontFamily: fonts.sans,
    marginTop: 6,
    textAlign: 'center',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 3,
    textAlign: 'center',
  },
  // Counter box — matches web rounded-[2.5rem] p-10
  counterBox: {
    borderRadius: 40,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(14,18,32,0.5)',
    padding: 40,
    alignItems: 'center',
    gap: 16,
    overflow: 'hidden',
    // inner shadow effect
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  counterGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(197,160,89,0.05)',
    opacity: 0.2,
  },
  // Counter buttons — matches web h-16 w-16 rounded-full
  counterButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Giant number — matches web text-[5rem] font-serif
  counterNumber: {
    color: colors.text,
    fontSize: 80,
    fontFamily: fonts.display,
    lineHeight: 80,
    // text shadow glow
    textShadowColor: 'rgba(255,255,255,0.2)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  // Counter label — matches web text-[11px] font-bold uppercase tracking-widest text-gold/80
  counterLabel: {
    color: 'rgba(197,160,89,0.8)',
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 3,
    zIndex: 1,
  },
  // Type grid — matches web grid-cols-2 gap-4
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  // Type card — matches web p-5 rounded-[1.5rem] border-white/[0.08] bg-[#0e1220]/50
  typeCard: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 20,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(14,18,32,0.5)',
  },
  typeCardSelected: {
    borderColor: colors.gold,
    backgroundColor: '#0e1220',
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    transform: [{ scale: 1.02 }],
  },
  typeIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeIconSelected: {
    backgroundColor: colors.gold,
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  typeLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 16,
    fontFamily: fonts.sansBold,
    letterSpacing: -0.3,
    flexShrink: 1,
  },
});
