import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useAuth } from '@/hooks/useAuth';
import { fetchPreferences, updatePreferences } from '@/lib/api/users';
import { Button } from '@/components/ui/Button';
import {
  ACTIVITY_LABELS, DIETARY_LABELS, BUDGET_LABELS,
  type ActivityType, type DietaryType, type BudgetLevel, type PaceLevel,
} from '@/lib/types/trip';

const PACE_OPTIONS: { value: PaceLevel; label: string; desc: string }[] = [
  { value: 'relaxed', label: 'Relaxé', desc: 'Peu d\'activités, beaucoup de temps libre' },
  { value: 'moderate', label: 'Modéré', desc: 'Bon équilibre activités / repos' },
  { value: 'intensive', label: 'Intensif', desc: 'Maximum d\'activités par jour' },
];

export default function PreferencesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [dietary, setDietary] = useState<DietaryType[]>([]);
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel | null>(null);
  const [pace, setPace] = useState<PaceLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchPreferences(user.id).then((p) => {
      if (p) {
        setActivities((p.activities as ActivityType[]) ?? []);
        setDietary((p.dietary as DietaryType[]) ?? []);
        setBudgetLevel((p.budget_level as BudgetLevel) ?? null);
        setPace((p.pace as PaceLevel) ?? null);
      }
      setLoaded(true);
    });
  }, [user]);

  const toggleActivity = (a: ActivityType) =>
    setActivities((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);

  const toggleDietary = (d: DietaryType) =>
    setDietary((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await updatePreferences(user.id, {
        activities,
        dietary,
        budget_level: budgetLevel,
        pace,
      });
      router.back();
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de sauvegarder vos préférences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color="#f8fafc" />
        </Pressable>
        <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '700' }}>Préférences de voyage</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 28 }}>
        {/* Activities */}
        <Section title="Activités préférées">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]).map(([key, label]) => (
              <Chip
                key={key}
                label={label}
                selected={activities.includes(key)}
                onPress={() => toggleActivity(key)}
              />
            ))}
          </View>
        </Section>

        {/* Dietary */}
        <Section title="Restrictions alimentaires">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.entries(DIETARY_LABELS) as [DietaryType, string][])
              .filter(([k]) => k !== 'none')
              .map(([key, label]) => (
                <Chip
                  key={key}
                  label={label}
                  selected={dietary.includes(key)}
                  onPress={() => toggleDietary(key)}
                />
              ))}
          </View>
        </Section>

        {/* Budget */}
        <Section title="Budget par défaut">
          <View style={{ gap: 8 }}>
            {(Object.entries(BUDGET_LABELS) as [BudgetLevel, { label: string; range: string }][]).map(([key, { label, range }]) => (
              <Pressable
                key={key}
                onPress={() => setBudgetLevel(key)}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: budgetLevel === key ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: budgetLevel === key ? '#c5a059' : 'rgba(255,255,255,0.05)',
                  borderRadius: 12, padding: 14,
                }}
              >
                <View>
                  <Text style={{ color: budgetLevel === key ? '#c5a059' : '#f8fafc', fontSize: 15, fontWeight: '600' }}>{label}</Text>
                  <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{range}</Text>
                </View>
                {budgetLevel === key && <Check size={18} color="#c5a059" />}
              </Pressable>
            ))}
          </View>
        </Section>

        {/* Pace */}
        <Section title="Rythme de voyage">
          <View style={{ gap: 8 }}>
            {PACE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => setPace(opt.value)}
                style={{
                  backgroundColor: pace === opt.value ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: pace === opt.value ? '#c5a059' : 'rgba(255,255,255,0.05)',
                  borderRadius: 12, padding: 14,
                }}
              >
                <Text style={{ color: pace === opt.value ? '#c5a059' : '#f8fafc', fontSize: 15, fontWeight: '600' }}>
                  {opt.label}
                </Text>
                <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{opt.desc}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Button isLoading={saving} onPress={handleSave}>Enregistrer</Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{ color: '#f8fafc', fontSize: 16, fontWeight: '700', marginBottom: 12 }}>{title}</Text>
      {children}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
        borderWidth: 1,
        borderColor: selected ? '#c5a059' : 'transparent',
      }}
    >
      <Text style={{ color: selected ? '#c5a059' : '#94a3b8', fontSize: 13, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
