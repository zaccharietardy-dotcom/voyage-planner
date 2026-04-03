import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import {
  ACTIVITY_LABELS, DIETARY_LABELS,
  type ActivityType, type DietaryType, type PaceLevel, type TripPreferences,
} from '@/lib/types/trip';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const PACE_OPTIONS: { value: PaceLevel; label: string; emoji: string; desc: string }[] = [
  { value: 'relaxed', label: 'Relaxé', emoji: '🧘', desc: 'Tranquille' },
  { value: 'moderate', label: 'Modéré', emoji: '🚶', desc: 'Équilibré' },
  { value: 'intensive', label: 'Intensif', emoji: '🏃', desc: 'On voit tout' },
];

export function StepPreferences({ prefs, onChange }: Props) {
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

  return (
    <View style={{ gap: 28 }}>
      <View>
        <Text style={s.title}>Qu'aimez-vous ?</Text>
        <Text style={s.subtitle}>Pour un itinéraire qui vous ressemble</Text>
      </View>

      {/* Activities */}
      <View>
        <Text style={s.sectionLabel}>Activités préférées</Text>
        <View style={s.chipGrid}>
          {(Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]).map(([key, label]) => {
            const selected = activities.includes(key);
            return (
              <Pressable
                key={key}
                onPress={() => toggleActivity(key)}
                style={[s.chip, selected && s.chipSelected]}
              >
                <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Pace */}
      <View>
        <Text style={s.sectionLabel}>Rythme</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PACE_OPTIONS.map((opt) => {
            const selected = pace === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => { Haptics.selectionAsync(); onChange({ pace: opt.value }); }}
                style={[s.paceCard, selected && s.paceCardSelected]}
              >
                <Text style={{ fontSize: 22, marginBottom: 4 }}>{opt.emoji}</Text>
                <Text style={[s.paceLabel, selected && { color: colors.gold }]}>{opt.label}</Text>
                <Text style={s.paceDesc}>{opt.desc}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Dietary */}
      <View>
        <Text style={s.sectionLabel}>Restrictions alimentaires</Text>
        <View style={s.chipGrid}>
          {(Object.entries(DIETARY_LABELS) as [DietaryType, string][])
            .filter(([k]) => k !== 'none')
            .map(([key, label]) => {
              const selected = dietary.includes(key);
              return (
                <Pressable key={key} onPress={() => toggleDietary(key)} style={[s.chip, selected && s.chipSelected]}>
                  <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
                </Pressable>
              );
            })}
        </View>
      </View>

      {/* Must-see */}
      <View>
        <Text style={s.sectionLabel}>Incontournables (optionnel)</Text>
        <TextInput
          style={s.textArea}
          placeholder="Ex: Sagrada Familia, Parc Güell..."
          placeholderTextColor={colors.textDim}
          multiline
          value={mustSee}
          onChangeText={(t) => onChange({ mustSee: t })}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: colors.text, fontSize: 24, fontFamily: fonts.display },
  subtitle: { color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, marginTop: 4 },
  sectionLabel: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  chipSelected: { backgroundColor: 'rgba(197,160,89,0.15)', borderColor: colors.gold },
  chipText: { color: colors.text, fontSize: 13, fontFamily: fonts.sansMedium },
  chipTextSelected: { color: colors.gold },
  paceCard: {
    flex: 1, alignItems: 'center', padding: 14, borderRadius: radius.xl,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  paceCardSelected: { backgroundColor: 'rgba(197,160,89,0.15)', borderColor: colors.gold },
  paceLabel: { color: colors.text, fontSize: 13, fontFamily: fonts.sansSemiBold },
  paceDesc: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.sans, marginTop: 2, textAlign: 'center' },
  textArea: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.xl, padding: 14, color: colors.text, fontSize: 14, fontFamily: fonts.sans,
    height: 80, textAlignVertical: 'top',
  },
});
