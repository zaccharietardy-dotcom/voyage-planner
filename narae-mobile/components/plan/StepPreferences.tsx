import { View, Text, TextInput, Pressable } from 'react-native';
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
    <View style={{ gap: 32 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, fontWeight: 'bold' }}>
          Qu'aimez-vous ?
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 15, marginTop: 4 }}>
          Pour un itinéraire qui vous ressemble
        </Text>
      </View>

      {/* Activities */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Activités préférées</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {(Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]).map(([key, label]) => {
            const selected = activities.includes(key);
            const emoji = label.split(' ')[0];
            const text = label.split(' ').slice(1).join(' ');
            
            return (
              <Pressable
                key={key}
                onPress={() => toggleActivity(key)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16,
                  backgroundColor: selected ? colors.goldBg : 'rgba(255,255,255,0.03)',
                  borderWidth: 1, borderColor: selected ? colors.gold : 'rgba(255,255,255,0.05)',
                }}
              >
                <Text style={{ fontSize: 18 }}>{emoji}</Text>
                <Text style={{ color: selected ? colors.gold : colors.textSecondary, fontSize: 14, fontWeight: '700' }}>
                  {text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Pace */}
      <View>
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>Rythme</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {PACE_OPTIONS.map((opt) => {
            const selected = pace === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => { Haptics.selectionAsync(); onChange({ pace: opt.value }); }}
                style={{
                  flex: 1, alignItems: 'center', padding: 16, borderRadius: 20,
                  backgroundColor: selected ? colors.goldBg : 'rgba(255,255,255,0.03)',
                  borderWidth: 1, borderColor: selected ? colors.gold : 'rgba(255,255,255,0.05)',
                }}
              >
                <Text style={{ fontSize: 28, marginBottom: 6 }}>{opt.emoji}</Text>
                <Text style={{ color: selected ? colors.gold : colors.textSecondary, fontSize: 14, fontWeight: 'bold' }}>
                  {opt.label}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 4, textAlign: 'center', fontWeight: '600' }}>{opt.desc}</Text>
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
