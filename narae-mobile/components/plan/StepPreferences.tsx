import { View, Text, TextInput, Pressable } from 'react-native';
import {
  ACTIVITY_LABELS, DIETARY_LABELS,
  type ActivityType, type DietaryType, type PaceLevel, type TripPreferences,
} from '@/lib/types/trip';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  prefs: Partial<TripPreferences>;
  onChange: (update: Partial<TripPreferences>) => void;
}

const PACE_OPTIONS: { value: PaceLevel; label: string; emoji: string; desc: string }[] = [
  { value: 'relaxed', label: 'Relaxé', emoji: '🧘', desc: 'Peu d\'activités, du temps libre' },
  { value: 'moderate', label: 'Modéré', emoji: '🚶', desc: 'Équilibré' },
  { value: 'intensive', label: 'Intensif', emoji: '🏃', desc: 'On voit un max !' },
];

export function StepPreferences({ prefs, onChange }: Props) {
  const activities = prefs.activities ?? [];
  const dietary = prefs.dietary ?? [];
  const pace = prefs.pace ?? 'moderate';
  const mustSee = prefs.mustSee ?? '';

  const toggleActivity = (a: ActivityType) => {
    const next = activities.includes(a) ? activities.filter((x) => x !== a) : [...activities, a];
    onChange({ activities: next });
  };

  const toggleDietary = (d: DietaryType) => {
    const next = dietary.includes(d) ? dietary.filter((x) => x !== d) : [...dietary, d];
    onChange({ dietary: next });
  };

  return (
    <View style={{ gap: 24 }}>
      {/* Activities */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 10 }}>
          Activités préférées
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]).map(([key, label]) => {
            const selected = activities.includes(key);
            return (
              <Pressable
                key={key}
                onPress={() => toggleActivity(key)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                  backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
                  borderWidth: 1, borderColor: selected ? '#c5a059' : 'transparent',
                }}
              >
                <Text style={{ color: selected ? '#c5a059' : '#94a3b8', fontSize: 13, fontWeight: '600' }}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Pace */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 10 }}>Rythme</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PACE_OPTIONS.map((opt) => {
            const selected = pace === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => onChange({ pace: opt.value })}
                style={{
                  flex: 1, alignItems: 'center', padding: 14, borderRadius: 14,
                  backgroundColor: selected ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.03)',
                  borderWidth: 1, borderColor: selected ? '#c5a059' : 'rgba(255,255,255,0.05)',
                }}
              >
                <Text style={{ fontSize: 22, marginBottom: 4 }}>{opt.emoji}</Text>
                <Text style={{ color: selected ? '#c5a059' : '#e2e8f0', fontSize: 13, fontWeight: '700' }}>
                  {opt.label}
                </Text>
                <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2, textAlign: 'center' }}>{opt.desc}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Dietary */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 10 }}>
          Restrictions alimentaires
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(Object.entries(DIETARY_LABELS) as [DietaryType, string][])
            .filter(([k]) => k !== 'none')
            .map(([key, label]) => {
              const selected = dietary.includes(key);
              return (
                <Pressable
                  key={key}
                  onPress={() => toggleDietary(key)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                    backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
                    borderWidth: 1, borderColor: selected ? '#c5a059' : 'transparent',
                  }}
                >
                  <Text style={{ color: selected ? '#c5a059' : '#94a3b8', fontSize: 13, fontWeight: '600' }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
        </View>
      </View>

      {/* Must-see */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600', marginBottom: 8 }}>
          Incontournables (optionnel)
        </Text>
        <TextInput
          style={{
            backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#1e293b',
            borderRadius: 12, padding: 14, color: '#f8fafc', fontSize: 14,
            height: 80, textAlignVertical: 'top',
          }}
          placeholder="Ex: Sagrada Familia, Parc Güell..."
          placeholderTextColor="#475569"
          multiline
          value={mustSee}
          onChangeText={(t) => onChange({ mustSee: t })}
        />
      </View>
    </View>
  );
}
