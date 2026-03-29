import { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ArrowRight } from 'lucide-react-native';
import Animated, { SlideInRight, SlideInLeft, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { generateTrip, type GenerateProgress } from '@/lib/api/trips';
import { api } from '@/lib/api/client';
import type { TripPreferences, Trip } from '@/lib/types/trip';
import { colors, fonts, radius } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { StepDestination } from '@/components/plan/StepDestination';
import { StepWhen } from '@/components/plan/StepWhen';
import { StepGroup } from '@/components/plan/StepGroup';
import { StepPreferences } from '@/components/plan/StepPreferences';
import { StepBudget } from '@/components/plan/StepBudget';
import { StepSummary } from '@/components/plan/StepSummary';
import { GeneratingScreen } from '@/components/plan/GeneratingScreen';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

const STEP_TITLES = [
  'Destination',
  'Quand ?',
  'Groupe',
  'Préférences',
  'Budget',
  'Récapitulatif',
];

const DEFAULT_PREFS: Partial<TripPreferences> = {
  origin: '',
  destination: '',
  durationDays: 3,
  groupSize: 2,
  groupType: 'couple',
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
  const [direction, setDirection] = useState<1 | -1>(1);
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
        if (!prefs.startDate) return 'Veuillez choisir une date de départ';
        return null;
      case 3:
        if (!prefs.activities?.length) return 'Sélectionnez au moins une activité';
        return null;
      default:
        return null;
    }
  };

  const goTo = (target: number) => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setDirection(target > step ? 1 : -1);
    setStep(target);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const next = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const err = validate();
    if (err) { Alert.alert('Attention', err); return; }
    if (step < 5) goTo(step + 1);
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

  const entering = direction === 1 ? SlideInRight.springify().damping(18) : SlideInLeft.springify().damping(18);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Header */}
          <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 }}>
            <Text style={{ color: colors.text, fontSize: 32, fontFamily: fonts.display, fontWeight: 'bold' }}>
              {STEP_TITLES[step]}
            </Text>
            {/* Premium Step dots */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'center' }}>
              {STEP_TITLES.map((_, i) => (
                <View
                  key={i}
                  style={{
                    height: 6,
                    width: i === step ? 24 : 6,
                    borderRadius: 3,
                    backgroundColor: i === step ? colors.gold : i < step ? 'rgba(197,160,89,0.4)' : 'rgba(255,255,255,0.1)',
                    shadowColor: i === step ? colors.gold : 'transparent',
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: i === step ? 0.8 : 0,
                    shadowRadius: 6,
                  }}
                />
              ))}
            </View>
          </View>

          {/* Step content */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
              <Animated.View key={step} entering={entering}>
                {step === 0 && <StepDestination prefs={prefs} onChange={updatePrefs} />}
                {step === 1 && <StepWhen prefs={prefs} onChange={updatePrefs} />}
                {step === 2 && <StepGroup prefs={prefs} onChange={updatePrefs} />}
                {step === 3 && <StepPreferences prefs={prefs} onChange={updatePrefs} />}
                {step === 4 && <StepBudget prefs={prefs} onChange={updatePrefs} />}
                {step === 5 && (
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
          {step < 5 && (
            <View style={{
              flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 20,
              gap: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
              backgroundColor: 'transparent',
            }}>
              {step > 0 && (
                <Button variant="outline" icon={ArrowLeft} onPress={prev} style={{ borderRadius: 18, height: 54 }}>
                  Retour
                </Button>
              )}
              <View style={{ flex: 1 }}>
                <Button icon={ArrowRight} iconPosition="right" onPress={next} style={{ borderRadius: 18, height: 54, backgroundColor: 'white' }} textStyle={{ color: 'black', fontWeight: 'bold' }}>
                  {step === 4 ? 'Récapitulatif' : 'Suivant'}
                </Button>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
