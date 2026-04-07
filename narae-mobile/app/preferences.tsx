import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useAuth } from '@/hooks/useAuth';
import { fetchPreferences, updatePreferences } from '@/lib/api/users';
import { Button } from '@/components/ui/Button';
import { colors, fonts, radius } from '@/lib/theme';
import { useTranslation, type TranslationKey } from '@/lib/i18n';
import {
  ACTIVITY_LABELS, DIETARY_LABELS, BUDGET_LABELS,
  type ActivityType, type DietaryType, type BudgetLevel, type PaceLevel,
} from '@/lib/types/trip';

const PACE_OPTION_KEYS: { value: PaceLevel; labelKey: TranslationKey; descKey: TranslationKey }[] = [
  { value: 'relaxed', labelKey: 'preferences.pace.relaxed', descKey: 'preferences.pace.relaxed.desc' },
  { value: 'moderate', labelKey: 'preferences.pace.moderate', descKey: 'preferences.pace.moderate.desc' },
  { value: 'intensive', labelKey: 'preferences.pace.intensive', descKey: 'preferences.pace.intensive.desc' },
];

export default function PreferencesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [dietary, setDietary] = useState<DietaryType[]>([]);
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel | null>(null);
  const [pace, setPace] = useState<PaceLevel | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchPreferences(user.id).then((p) => {
      if (p) {
        setActivities((p.activities as ActivityType[]) ?? []);
        setDietary((p.dietary as DietaryType[]) ?? []);
        setBudgetLevel((p.budget_level as BudgetLevel) ?? null);
        setPace((p.pace as PaceLevel) ?? null);
      }
    }).catch(() => {});
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
      router.canGoBack() ? router.back() : router.replace("/(tabs)");
    } catch {
      Alert.alert(t('common.error'), t('preferences.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} hitSlop={12}>
          <ArrowLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.sansBold }}>{t('preferences.title')}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 28 }}>
        <Section title={t('preferences.activities')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.entries(ACTIVITY_LABELS) as [ActivityType, string][]).map(([key, label]) => (
              <Chip key={key} label={label} selected={activities.includes(key)} onPress={() => toggleActivity(key)} />
            ))}
          </View>
        </Section>

        <Section title={t('preferences.dietary')}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.entries(DIETARY_LABELS) as [DietaryType, string][])
              .filter(([k]) => k !== 'none')
              .map(([key, label]) => (
                <Chip key={key} label={label} selected={dietary.includes(key)} onPress={() => toggleDietary(key)} />
              ))}
          </View>
        </Section>

        <Section title={t('preferences.budget')}>
          <View style={{ gap: 8 }}>
            {(Object.entries(BUDGET_LABELS) as [BudgetLevel, { label: string; range: string }][]).map(([key, { label, range }]) => (
              <Pressable
                key={key}
                onPress={() => setBudgetLevel(key)}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  backgroundColor: budgetLevel === key ? colors.goldBg : 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: budgetLevel === key ? colors.gold : 'rgba(255,255,255,0.05)',
                  borderRadius: radius.lg, padding: 14,
                }}
              >
                <View>
                  <Text style={{ color: budgetLevel === key ? colors.gold : colors.text, fontSize: 15, fontFamily: fonts.sansSemiBold }}>{label}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: fonts.sans, marginTop: 2 }}>{range}</Text>
                </View>
                {budgetLevel === key && <Check size={18} color={colors.gold} />}
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title={t('preferences.pace')}>
          <View style={{ gap: 8 }}>
            {PACE_OPTION_KEYS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => setPace(opt.value)}
                style={{
                  backgroundColor: pace === opt.value ? colors.goldBg : 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: pace === opt.value ? colors.gold : 'rgba(255,255,255,0.05)',
                  borderRadius: radius.lg, padding: 14,
                }}
              >
                <Text style={{ color: pace === opt.value ? colors.gold : colors.text, fontSize: 15, fontFamily: fonts.sansSemiBold }}>
                  {t(opt.labelKey)}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: fonts.sans, marginTop: 2 }}>{t(opt.descKey)}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Button isLoading={saving} onPress={handleSave}>{t('preferences.save')}</Button>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.sansBold, marginBottom: 12 }}>{title}</Text>
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
        borderRadius: radius.sm,
        backgroundColor: selected ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
        borderWidth: 1,
        borderColor: selected ? colors.gold : 'transparent',
      }}
    >
      <Text style={{ color: selected ? colors.gold : colors.textSecondary, fontSize: 13, fontFamily: fonts.sansSemiBold }}>
        {label}
      </Text>
    </Pressable>
  );
}
