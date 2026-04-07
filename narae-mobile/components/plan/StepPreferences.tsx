import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import {
  type ActivityType, type DietaryType, type PaceLevel, type TripPreferences,
  DIETARY_LABELS,
} from '@/lib/types/trip';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

// Web-exact activity pills: emoji + short uppercase label
const ACTIVITY_OPTIONS: { key: ActivityType; emoji: string; labelKey: string }[] = [
  { key: 'culture', emoji: '🏛️', labelKey: 'plan.pref.culture' },
  { key: 'nature', emoji: '🌳', labelKey: 'plan.pref.nature' },
  { key: 'gastronomy', emoji: '🍽️', labelKey: 'plan.pref.gastronomy' },
  { key: 'adventure', emoji: '⛰️', labelKey: 'plan.pref.adventure' },
  { key: 'beach', emoji: '🏖️', labelKey: 'plan.pref.beach' },
  { key: 'shopping', emoji: '🛍️', labelKey: 'plan.pref.shopping' },
  { key: 'nightlife', emoji: '🍹', labelKey: 'plan.pref.nightlife' },
  { key: 'wellness', emoji: '🧘', labelKey: 'plan.pref.wellness' },
];

const PACE_OPTIONS: { value: PaceLevel; labelKey: string; emoji: string; descKey: string }[] = [
  { value: 'relaxed', labelKey: 'plan.pref.pace.relaxed', emoji: '🐢', descKey: 'plan.pref.pace.relaxed_desc' },
  { value: 'moderate', labelKey: 'plan.pref.pace.moderate', emoji: '⚖️', descKey: 'plan.pref.pace.moderate_desc' },
  { value: 'intensive', labelKey: 'plan.pref.pace.intensive', emoji: '🚀', descKey: 'plan.pref.pace.intensive_desc' },
];

export function StepPreferences({ prefs, onChange }: Props) {
  const { t } = useTranslation();
  const activities = prefs.activities ?? [];
  const dietary = prefs.dietary ?? [];
  const pace = prefs.pace ?? 'moderate';
  const mustSee = prefs.mustSee ?? '';

  const toggleActivity = (a: ActivityType) => {
    Haptics.selectionAsync();
    const next = activities.includes(a) ? activities.filter((x) => x !== a) : [...activities, a];
    onChange({ activities: next });
  };

  const toggleDietary = (d: DietaryType) => {
    Haptics.selectionAsync();
    const next = dietary.includes(d) ? dietary.filter((x) => x !== d) : [...dietary, d];
    onChange({ dietary: next });
  };

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Pick 3 random activities
    const all = ACTIVITY_OPTIONS.map((a) => a.key);
    const shuffled = [...all].sort(() => Math.random() - 0.5);
    onChange({ activities: shuffled.slice(0, 3) });
  };

  return (
    <View style={{ gap: 32 }}>
      {/* Title */}
      <View style={{ alignItems: 'center' }}>
        <Text style={s.title}>{t('plan.pref.title')}</Text>
        <Text style={s.subtitle}>{t('plan.pref.subtitle')}</Text>
      </View>

      {/* Activities */}
      <View style={{ gap: 16 }}>
        <Text style={s.sectionLabel}>{t('plan.pref.activities')}</Text>
        <View style={s.pillGrid}>
          {ACTIVITY_OPTIONS.map(({ key, emoji, labelKey }) => {
            const selected = activities.includes(key);
            return (
              <Pressable
                key={key}
                onPress={() => toggleActivity(key)}
                style={[s.pill, selected && s.pillSelected]}
              >
                <Text style={[s.pillEmoji, selected && s.pillEmojiSelected]}>{emoji}</Text>
                <Text style={[s.pillLabel, selected && s.pillLabelSelected]}>{t(labelKey as any)}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={handleSkip} style={{ alignSelf: 'center', paddingVertical: 8 }}>
          <Text style={s.skipText}>{t('plan.pref.skip')}</Text>
        </Pressable>
      </View>

      {/* Divider */}
      <View style={s.divider} />

      {/* Pace / Rythme */}
      <View style={{ gap: 16 }}>
        <Text style={s.sectionLabel}>{t('plan.pref.pace')}</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {PACE_OPTIONS.map((opt) => {
            const selected = pace === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => { Haptics.selectionAsync(); onChange({ pace: opt.value }); }}
                style={[s.paceCard, selected && s.paceCardSelected]}
              >
                <Text style={[s.paceEmoji, selected && { transform: [{ scale: 1.1 }] }]}>
                  {opt.emoji}
                </Text>
                <Text style={[s.paceLabel, selected && s.paceLabelSelected]}>{t(opt.labelKey as any)}</Text>
                <Text style={s.paceDesc}>{t(opt.descKey as any)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Divider */}
      <View style={s.divider} />

      {/* Dietary */}
      <View style={{ gap: 16 }}>
        <Text style={s.sectionLabel}>{t('plan.pref.dietary')}</Text>
        <View style={s.pillGrid}>
          {(Object.entries(DIETARY_LABELS) as [DietaryType, string][])
            .filter(([k]) => k !== 'none')
            .map(([key, label]) => {
              const selected = dietary.includes(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => toggleDietary(key)}
                  style={[s.pill, selected && s.pillSelected]}
                >
                  <Text style={[s.pillLabel, selected && s.pillLabelSelected]}>{label}</Text>
                </Pressable>
              );
            })}
        </View>
      </View>

      {/* Must-see */}
      <View style={{ gap: 12 }}>
        <Text style={s.sectionLabel}>{t('plan.pref.mustsee')}</Text>
        <TextInput
          style={s.textArea}
          placeholder={t('plan.pref.mustsee.placeholder')}
          placeholderTextColor="rgba(255,255,255,0.3)"
          multiline
          value={mustSee}
          onChangeText={(t) => onChange({ mustSee: t })}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Title section — matches web text-4xl font-serif font-bold
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
  // Section label — matches web text-[10px] font-black uppercase tracking-[0.3em] text-white/40
  sectionLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 3,
    textAlign: 'center',
  },
  // Activity pills — matches web px-6 py-4 rounded-full border-2
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  pillSelected: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(197,160,89,0.1)',
    // gold glow shadow
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
  },
  // Emoji — matches web text-2xl
  pillEmoji: {
    fontSize: 24,
    opacity: 0.5,
  },
  pillEmojiSelected: {
    opacity: 1,
    transform: [{ scale: 1.1 }],
  },
  // Label — matches web text-sm font-black uppercase tracking-widest
  pillLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  pillLabelSelected: {
    color: colors.text,
  },
  // Skip link — matches web gold text
  skipText: {
    color: colors.gold,
    fontSize: 12,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  // Divider
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 20,
  },
  // Pace cards — matches web rounded-3xl border-2 p-6
  paceCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    gap: 4,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  paceCardSelected: {
    borderColor: colors.gold,
    backgroundColor: 'rgba(197,160,89,0.1)',
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
  },
  // Pace emoji
  paceEmoji: {
    fontSize: 28,
  },
  // Pace label
  paceLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  paceLabelSelected: {
    color: colors.gold,
  },
  // Pace desc
  paceDesc: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    textAlign: 'center',
  },
  // TextArea
  textArea: {
    backgroundColor: 'rgba(14,18,32,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 19,
    borderCurve: 'continuous',
    padding: 16,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sans,
    height: 80,
    textAlignVertical: 'top',
  },
});
