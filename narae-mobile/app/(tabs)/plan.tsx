import { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Keyboard } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { generateTrip, type GenerateProgress } from '@/lib/api/trips';
import { api } from '@/lib/api/client';
import type { TripPreferences } from '@/lib/types/trip';
import { colors, fonts, radius } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { StepDestination } from '@/components/plan/StepDestination';
import { StepOrigin } from '@/components/plan/StepOrigin';
import { StepWhen } from '@/components/plan/StepWhen';
import { StepGroup } from '@/components/plan/StepGroup';
import { StepPreferences } from '@/components/plan/StepPreferences';
import { StepBudget } from '@/components/plan/StepBudget';
import { StepSummary } from '@/components/plan/StepSummary';
import { GeneratingScreen } from '@/components/plan/GeneratingScreen';

const STEP_TITLES = [
  'Destination',
  'Ville de départ',
  'Quand ?',
  'Voyageurs',
  'Centres d\u2019intérêt',
  'Quel budget ?',
  'Résumé',
];

const DEFAULT_PREFS: Partial<TripPreferences> = {
  origin: '',
  destination: '',
  durationDays: 3,
  groupSize: 1,
  groupType: 'solo',
  budgetLevel: 'moderate',
  transport: 'optimal',
  activities: [],
  dietary: [],
  pace: 'moderate',
  mustSee: '',
  carRental: false,
};

export default function PlanScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ destination?: string }>();
  const scrollRef = useRef<ScrollView>(null);

  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<Partial<TripPreferences>>({
    ...DEFAULT_PREFS,
    ...(params.destination ? { destination: params.destination } : {}),
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const updatePrefs = useCallback((update: Partial<TripPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...update }));
  }, []);

  const validate = (): string | null => {
    switch (step) {
      case 0:
        if (!prefs.destination?.trim()) return 'Veuillez choisir une destination';
        return null;
      case 1:
        if (!prefs.origin?.trim()) return 'Indiquez votre ville de départ';
        return null;
      case 2:
        if (!prefs.startDate) return 'Veuillez choisir une date de départ';
        return null;
      case 4:
        if (!prefs.activities?.length) return 'Sélectionnez au moins une activité';
        return null;
      default:
        return null;
    }
  };

  const goTo = (target: number) => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setStep(target);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const err = validate();
    if (err) { Alert.alert('Attention', err); return; }
    if (step < 6) goTo(step + 1);
  };

  const prev = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step > 0) goTo(step - 1);
  };

  const handleGenerate = async () => {
    if (!user) { router.push('/(auth)/login'); return; }
    const err = validate();
    if (err) { Alert.alert('Attention', err); return; }

    setIsGenerating(true);
    setProgress(null);
    setGenError(null);

    try {
      const fullPrefs = {
        ...DEFAULT_PREFS,
        ...prefs,
        startDate: prefs.startDate ?? new Date(),
      } as TripPreferences;

      const trip = await generateTrip(fullPrefs, setProgress);

      if (trip?.id) {
        router.replace(`/trip/${trip.id}`);
      } else {
        const saved = await api.post<{ id: string }>('/api/trips', {
          destination: prefs.destination,
          preferences: fullPrefs,
          data: trip,
        });
        router.replace(`/trip/${saved.id}`);
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setIsGenerating(false);
    }
  };

  if (isGenerating || genError) {
    return (
      <GeneratingScreen
        destination={prefs.destination ?? 'votre destination'}
        progress={progress}
        error={genError}
        onRetry={handleGenerate}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
          {/* Header + Step indicator */}
          <View style={styles.header}>
            <Text style={styles.title}>{STEP_TITLES[step]}</Text>
            <View style={styles.dotsRow}>
              {STEP_TITLES.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i === step && styles.dotActive,
                    i < step && styles.dotCompleted,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.stepLabel}>
              Étape {step + 1} / {STEP_TITLES.length}
            </Text>
          </View>

          {/* Step content */}
          <ScrollView
            ref={scrollRef}
            contentInsetAdjustmentBehavior="automatic"
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
              <Animated.View key={step} entering={FadeIn.duration(200)}>
                {step === 0 && <StepDestination prefs={prefs} onChange={updatePrefs} />}
                {step === 1 && <StepOrigin prefs={prefs} onChange={updatePrefs} />}
                {step === 2 && <StepWhen prefs={prefs} onChange={updatePrefs} />}
                {step === 3 && <StepGroup prefs={prefs} onChange={updatePrefs} />}
                {step === 4 && <StepPreferences prefs={prefs} onChange={updatePrefs} />}
                {step === 5 && <StepBudget prefs={prefs} onChange={updatePrefs} />}
                {step === 6 && (
                  <StepSummary
                    prefs={prefs}
                    onEdit={goTo}
                    onGenerate={handleGenerate}
                    isGenerating={isGenerating}
                  />
                )}
              </Animated.View>
            </Pressable>
          </ScrollView>

          {/* Navigation buttons */}
          {step < 6 && (
            <View style={styles.navContainer}>
              <View style={styles.navRow}>
                {step > 0 ? (
                  <Button variant="outline" onPress={prev} style={styles.navButton}>
                    Retour
                  </Button>
                ) : <View style={styles.navButton} />}
                <Button
                  variant="primary"
                  onPress={next}
                  style={{ ...styles.navButton, backgroundColor: '#fff' }}
                  textStyle={{ color: '#000', fontFamily: fonts.sansSemiBold }}
                >
                  {step === 5 ? 'Récapitulatif' : 'Suivant'}
                </Button>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
  },
  title: {
    color: colors.text,
    fontSize: 36,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    alignItems: 'center',
  },
  dot: {
    height: 8,
    width: 8,
    borderRadius: 4,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dotActive: {
    width: 32,
    backgroundColor: colors.gold,
    boxShadow: '0 0 6px rgba(197,160,89,0.8)',
  },
  dotCompleted: {
    backgroundColor: 'rgba(197,160,89,0.5)',
  },
  stepLabel: {
    color: colors.textMuted,
    fontFamily: fonts.sansBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 10,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 200,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 30,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(2,6,23,0.4)',
    marginHorizontal: 4,
  },
  navContainer: {
    position: 'absolute',
    bottom: 90,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
  },
  navRow: {
    flexDirection: 'row',
    gap: 12,
  },
  navButton: {
    flex: 1,
    height: 54,
    borderRadius: 32,
    borderCurve: 'continuous',
  },
});
