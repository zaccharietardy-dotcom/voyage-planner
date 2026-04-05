import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight, Lock, Sparkles } from 'lucide-react-native';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import {
  checkGenerateAccess,
  generateTrip,
  type GenerateAccessCheck,
  type GenerateProgress,
} from '@/lib/api/trips';
import type { PipelineMapSnapshot, PipelineQuestion } from '@/lib/types/pipeline';
import type { TripPreferences } from '@/lib/types/trip';
import { colors, fonts, goldGradient, radius } from '@/lib/theme';
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
  'Centres d’intérêt',
  'Budget',
  'Résumé',
] as const;

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

type GateState = Pick<GenerateAccessCheck, 'action' | 'reason'> | null;

export function PlanWizardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ destination?: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const questionResolverRef = useRef<((selectedOptionId: string) => void) | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  const compact = height < 760;
  const navHeight = compact ? 74 : 82;

  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<Partial<TripPreferences>>({
    ...DEFAULT_PREFS,
    ...(params.destination ? { destination: params.destination } : {}),
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [mapSnapshot, setMapSnapshot] = useState<PipelineMapSnapshot | null>(null);
  const [pipelineQuestion, setPipelineQuestion] = useState<PipelineQuestion | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [gate, setGate] = useState<GateState>(null);
  const [gateChecked, setGateChecked] = useState(false);

  useEffect(() => {
    if (!params.destination) return;
    setPrefs((current) => (current.destination ? current : { ...current, destination: params.destination }));
  }, [params.destination]);

  const refreshGate = useCallback(async () => {
    try {
      const access = await checkGenerateAccess();
      if (!access.allowed) {
        setGate({
          action: access.action,
          reason: access.reason,
        });
      } else {
        setGate(null);
      }
    } catch {
      setGate(null);
    } finally {
      setGateChecked(true);
    }
  }, []);

  useEffect(() => {
    void refreshGate();
  }, [refreshGate, user?.id]);

  const updatePrefs = useCallback((update: Partial<TripPreferences>) => {
    setPrefs((current) => ({ ...current, ...update }));
  }, []);

  const validate = useCallback(() => {
    switch (step) {
      case 0:
        if (!prefs.destination?.trim()) return 'Veuillez choisir une destination.';
        return null;
      case 1:
        if (!prefs.origin?.trim()) return 'Indiquez votre ville de départ.';
        return null;
      case 2:
        if (!prefs.startDate) return 'Veuillez choisir une date de départ.';
        return null;
      case 4:
        if (!prefs.activities?.length) return 'Sélectionnez au moins une activité.';
        return null;
      default:
        return null;
    }
  }, [prefs, step]);

  useEffect(() => {
    if (formError && !validate()) {
      setFormError(null);
    }
  }, [formError, validate]);

  const goTo = useCallback((target: number) => {
    Haptics.selectionAsync();
    Keyboard.dismiss();
    setStep(target);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  const handleNext = () => {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step < STEP_TITLES.length - 1) {
      goTo(step + 1);
    }
  };

  const handleBack = () => {
    setFormError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step === 0) {
      router.replace('/(tabs)');
      return;
    }
    goTo(step - 1);
  };

  const handleQuestionAnswer = useCallback((_questionId: string, selectedOptionId: string) => {
    questionResolverRef.current?.(selectedOptionId);
  }, []);

  const handleGenerate = useCallback(async () => {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }

    setFormError(null);
    setGenError(null);
    setProgress(null);
    setMapSnapshot(null);
    setPipelineQuestion(null);
    setIsGenerating(true);

    try {
      const access = await checkGenerateAccess();
      if (!access.allowed && !(access.action === 'login' && user)) {
        setGate({ action: access.action, reason: access.reason });
        setIsGenerating(false);
        return;
      }

      const fullPrefs = {
        ...DEFAULT_PREFS,
        ...prefs,
        dietary: prefs.dietary?.length ? prefs.dietary : ['none'],
        startDate: prefs.startDate ?? new Date(),
      } as TripPreferences;

      const generatedTrip = await generateTrip(fullPrefs, {
        onProgress: (nextProgress) => {
          setPipelineQuestion(null);
          setProgress(nextProgress);
        },
        onSnapshot: (nextSnapshot) => {
          setMapSnapshot(nextSnapshot);
        },
        onQuestion: (question) => new Promise<string>((resolve) => {
          setPipelineQuestion(question);
          questionResolverRef.current = (selectedOptionId: string) => {
            questionResolverRef.current = null;
            resolve(selectedOptionId);
          };
        }),
      });

      const savedTrip = await api.post<{ id: string }>('/api/trips', {
        ...generatedTrip,
        destination: fullPrefs.destination,
        durationDays: fullPrefs.durationDays,
        startDate: fullPrefs.startDate,
        preferences: fullPrefs,
      });

      router.replace(`/trip/${savedTrip.id}`);
    } catch (error) {
      setGenError(error instanceof Error ? error.message : 'Erreur inconnue');
    } finally {
      setIsGenerating(false);
    }
  }, [prefs, router, validate]);

  const handleGateAction = useCallback(() => {
    if (gate?.action === 'upgrade') {
      router.push('/pricing');
      return;
    }

    router.push({
      pathname: '/(auth)/login',
      params: { redirect: '/plan' },
    });
  }, [gate?.action, router]);

  const content = useMemo(() => {
    switch (step) {
      case 0:
        return <StepDestination prefs={prefs} onChange={updatePrefs} />;
      case 1:
        return <StepOrigin prefs={prefs} onChange={updatePrefs} />;
      case 2:
        return <StepWhen prefs={prefs} onChange={updatePrefs} />;
      case 3:
        return <StepGroup prefs={prefs} onChange={updatePrefs} />;
      case 4:
        return <StepPreferences prefs={prefs} onChange={updatePrefs} />;
      case 5:
        return <StepBudget prefs={prefs} onChange={updatePrefs} />;
      case 6:
        return (
          <StepSummary
            prefs={prefs}
            onEdit={goTo}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
          />
        );
      default:
        return null;
    }
  }, [goTo, handleGenerate, isGenerating, prefs, step, updatePrefs]);

  if (gate && gateChecked && !(gate.action === 'login' && user)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <View
          style={{
            flex: 1,
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: 20,
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              borderRadius: radius.card,
              borderCurve: 'continuous',
              backgroundColor: 'rgba(255,255,255,0.04)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
              padding: 28,
              gap: 20,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                borderCurve: 'continuous',
                backgroundColor: colors.goldBg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {gate.action === 'upgrade' ? (
                <Sparkles size={28} color={colors.gold} />
              ) : (
                <Lock size={28} color={colors.gold} />
              )}
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display }}>
                {gate.action === 'upgrade' ? 'Débloquez la génération' : 'Connectez-vous'}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 15, fontFamily: fonts.sans, lineHeight: 24 }}>
                {gate.reason || 'Connectez-vous pour générer votre voyage.'}
              </Text>
            </View>

            <Button size="lg" onPress={handleGateAction}>
              {gate.action === 'upgrade' ? 'Voir les offres' : 'Se connecter'}
            </Button>

            <Button
              variant="ghost"
              size="lg"
              onPress={() => router.replace('/(tabs)')}
              style={{ marginTop: -4 }}
            >
              Revenir à l’accueil
            </Button>
          </View>
        </View>
      </View>
    );
  }

  if (isGenerating || genError) {
    return (
      <GeneratingScreen
        origin={prefs.origin ?? ''}
        destination={prefs.destination ?? 'votre destination'}
        durationDays={prefs.durationDays ?? 3}
        progress={progress}
        snapshot={mapSnapshot}
        error={genError}
        question={pipelineQuestion}
        onAnswer={handleQuestionAnswer}
        onRetry={handleGenerate}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <LinearGradient
          colors={['rgba(2,6,23,0)', 'rgba(2,6,23,0.92)']}
          pointerEvents="none"
          style={[styles.bottomFade, { height: navHeight + insets.bottom + 56 }]}
        />

        <View style={[styles.header, { paddingTop: insets.top + (compact ? 8 : 14), paddingHorizontal: compact ? 16 : 20 }]}>
          <View style={styles.headerTopRow}>
            <Pressable onPress={() => router.replace('/(tabs)')} hitSlop={12} style={styles.closeButton}>
              <ArrowLeft size={20} color={colors.text} />
            </Pressable>
            <Text style={[styles.stepLabel, { marginTop: 0 }]}>
              Étape {step + 1} / {STEP_TITLES.length}
            </Text>
          </View>

          <Text style={[styles.title, compact ? styles.titleCompact : null]}>
            {STEP_TITLES[step]}
          </Text>

          <View style={styles.dotsRow}>
            {STEP_TITLES.map((label, index) => {
              const isActive = index === step;
              const isDone = index < step;

              return (
                <Pressable
                  key={index}
                  onPress={() => {
                    if (index < step) {
                      goTo(index);
                    }
                  }}
                  disabled={index >= step}
                  style={styles.dotWrap}
                >
                  <View
                    style={[
                      styles.dot,
                      isActive ? styles.dotActive : null,
                      isDone ? styles.dotCompleted : null,
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={[
            styles.contentArea,
            {
              marginHorizontal: compact ? 12 : 16,
              marginBottom: step < STEP_TITLES.length - 1 ? navHeight + insets.bottom + 26 : insets.bottom + 16,
            },
          ]}
        >
          <ScrollView
            ref={scrollRef}
            contentInsetAdjustmentBehavior="never"
            style={{ flex: 1 }}
            contentContainerStyle={styles.contentScroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={Keyboard.dismiss} style={{ flex: 1 }}>
              <Animated.View key={step} entering={FadeIn.duration(180)}>
                <View style={[styles.contentShell, compact ? styles.contentShellCompact : null]}>
                  {content}
                </View>
              </Animated.View>
            </Pressable>
          </ScrollView>
        </View>

        {step < STEP_TITLES.length - 1 ? (
          <View style={[styles.navWrap, { paddingBottom: insets.bottom + 12, paddingHorizontal: compact ? 12 : 16 }]}>
            {formError ? (
              <View style={styles.errorBadge}>
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            ) : null}
            <View style={styles.navCard}>
              <Button
                variant="outline"
                size="lg"
                onPress={handleBack}
                style={styles.navButton}
                icon={ArrowLeft}
              >
                {step === 0 ? 'Quitter' : 'Retour'}
              </Button>
              <Button
                size="lg"
                onPress={handleNext}
                style={styles.navButton}
                icon={ArrowRight}
                iconPosition="right"
              >
                {step === STEP_TITLES.length - 2 ? 'Récapitulatif' : 'Suivant'}
              </Button>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 10,
    paddingBottom: 12,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontFamily: fonts.display,
    letterSpacing: -0.6,
  },
  titleCompact: {
    fontSize: 28,
  },
  stepLabel: {
    color: colors.gold,
    fontFamily: fonts.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(197,160,89,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(197,160,89,0.2)',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  dotWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 16,
    width: 48,
  },
  dot: {
    height: 6,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    // default pending state
    width: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  dotActive: {
    width: 32,
    backgroundColor: colors.gold,
    // gold glow
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
  },
  dotCompleted: {
    width: 8,
    backgroundColor: 'rgba(197,160,89,0.5)',
  },
  dotLabel: {
    position: 'absolute',
    bottom: -18,
    fontSize: 9,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.2)',
  },
  dotLabelActive: {
    color: colors.gold,
  },
  contentArea: {
    flex: 1,
  },
  contentShell: {
    borderRadius: 40,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(2,6,23,0.4)',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 50,
  },
  contentScroll: {
    paddingBottom: 8,
  },
  contentShellCompact: {
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  navWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: 10,
  },
  errorBadge: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.22)',
  },
  errorText: {
    color: '#fecaca',
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  navCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  navButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 999,
    borderWidth: 0,
  },
});
