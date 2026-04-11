'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { PipelineQuestion } from '@/lib/types/pipelineQuestions';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  StepDestination,
  StepWhen,
  StepGroup,
  StepPreferences,
  StepBudget,
  StepSummary,
} from '@/components/forms';
import { StepOrigin } from '@/components/forms/StepOrigin';
import { TripPreferences } from '@/lib/types';
import { ArrowLeft, ArrowRight, UserCog, Check, AlertCircle, X } from 'lucide-react';
import { generateTripStream, PipelineProgressEvent } from '@/lib/generateTrip';
import { cn } from '@/lib/utils';
import { isProviderQuotaLikeMessage, isUserQuotaLikeMessage } from '@/lib/utils/quotaErrors';
import { safeSetItem } from '@/lib/storage';
import { useAuth } from '@/components/auth';
import { useUserPreferences, preferenceOptions } from '@/hooks/useUserPreferences';
import { toast } from 'sonner';
import { GeneratingScreen } from '@/components/trip/GeneratingScreen';
import { trackEvent } from '@/lib/analytics';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

import { hapticImpactLight, hapticSuccess } from '@/lib/utils/haptics';
import { useTranslation } from '@/lib/i18n';

const STEP_KEYS = [
  'plan.steps.destination',
  'plan.steps.origin',
  'plan.steps.dates',
  'plan.steps.travelers',
  'plan.steps.interests',
  'plan.steps.budget',
  'plan.steps.summary',
] as const;

const DEFAULT_PREFERENCES: Partial<TripPreferences> = {
  durationDays: 4,
  groupSize: 1,
  groupType: 'solo',
  transport: 'optimal',
  carRental: false,
  budgetLevel: 'moderate',
  activities: [],
  dietary: ['none'],
  tripMode: 'precise',
  cityPlan: [{ city: '', days: 4 }],
};

export default function PlanPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { preferences: userPrefs, isLoading: prefsLoading } = useUserPreferences();
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preferences, setPreferences] = useState<Partial<TripPreferences>>(DEFAULT_PREFERENCES);
  const [preferencesApplied, setPreferencesApplied] = useState(false);
  const directionRef = useRef(1);
  const [showErrors, setShowErrors] = useState(false);
  const [pipelineStep, setPipelineStep] = useState<string | undefined>(undefined);
  const [currentQuestion, setCurrentQuestion] = useState<PipelineQuestion | null>(null);
  const questionResolverRef = useRef<((optionId: string) => void) | null>(null);
  const [gate, setGate] = useState<null | 'login' | 'upgrade'>(null);
  const [gateMessage, setGateMessage] = useState('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  const STEPS = STEP_KEYS.map((key, i) => ({ id: i + 1, label: t(key) }));
  const [gateChecked, setGateChecked] = useState(false);

  // Gate: check auth + quota IMMEDIATELY on page load
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await fetch('/api/generate/preflight');
        const check = await res.json();
        if (!check.allowed) {
          if (check.action === 'login') {
            setGate('login');
            setGateMessage(t('plan.loginRequired'));
          } else if (check.action === 'upgrade') {
            setGate('upgrade');
            setGateMessage(check.reason || t('plan.limitDefault'));
          }
        }
      } catch {
        // Fail open
      }
      setGateChecked(true);
    };
    checkAccess();
  }, []);

  // Load template preferences if coming from a template card
  useEffect(() => {
    const stored = sessionStorage.getItem('narae-template');
    if (stored) {
      sessionStorage.removeItem('narae-template');
      try {
        const templatePrefs = JSON.parse(stored);
        setPreferences((prev) => ({ ...prev, ...templatePrefs }));
        toast.success(t('plan.templateLoaded'));
      } catch { /* ignore */ }
    }
  }, []);

  const stepVariants: Variants = {
    enter: (dir: number) => ({ 
      y: dir > 0 ? 10 : -10, 
      opacity: 0,
      filter: 'blur(10px)',
      scale: 1,
    }),
    center: { 
      y: 0, 
      opacity: 1,
      filter: 'blur(0px)',
      scale: 1,
      transition: {
        y: { type: "spring", stiffness: 200, damping: 25 },
        opacity: { duration: 0.3 },
        filter: { duration: 0.4 },
        scale: { duration: 0.4, ease: [0.25, 1, 0.5, 1] }
      }
    },
    exit: (dir: number) => ({ 
      y: dir > 0 ? -10 : 10, 
      opacity: 0,
      filter: 'blur(10px)',
      scale: 1,
      transition: {
        y: { duration: 0.2, ease: [0.5, 0, 0.75, 0] },
        opacity: { duration: 0.2 },
        filter: { duration: 0.2 },
        scale: { duration: 0.2 }
      }
    }),
  };


  const applyUserPreferences = () => {
    if (!userPrefs) return;
    hapticSuccess();

    const updatedPrefs: Partial<TripPreferences> = { ...preferences };

    if (userPrefs.budget_preference) {
      const budgetMap: Record<string, 'economic' | 'moderate' | 'comfort' | 'luxury'> = {
        'budget': 'economic',
        'moderate': 'moderate',
        'comfort': 'comfort',
        'luxury': 'luxury',
      };
      updatedPrefs.budgetLevel = budgetMap[userPrefs.budget_preference] || 'moderate';
    }

    if (userPrefs.favorite_activities && userPrefs.favorite_activities.length > 0) {
      type ActivityType = 'beach' | 'nature' | 'culture' | 'gastronomy' | 'nightlife' | 'shopping' | 'adventure' | 'wellness';
      const activityMapping: Record<string, ActivityType> = {
        'museums': 'culture', 'monuments': 'culture', 'nature': 'nature',
        'beaches': 'beach', 'hiking': 'adventure', 'shopping': 'shopping',
        'nightlife': 'nightlife', 'food_tours': 'gastronomy', 'sports': 'adventure',
        'wellness': 'wellness', 'photography': 'culture', 'local_experiences': 'culture',
      };
      const mappedActivities = userPrefs.favorite_activities
        .map(a => activityMapping[a])
        .filter((a): a is ActivityType => !!a);
      if (mappedActivities.length > 0) {
        updatedPrefs.activities = [...new Set(mappedActivities)] as ActivityType[];
      }
    }

    if (userPrefs.dietary_restrictions && userPrefs.dietary_restrictions.length > 0) {
      type DietaryType = 'none' | 'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'gluten_free';
      const validDietary: DietaryType[] = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free'];
      const mappedDietary = userPrefs.dietary_restrictions
        .filter((d): d is DietaryType => validDietary.includes(d as DietaryType));
      if (mappedDietary.length > 0) {
        updatedPrefs.dietary = mappedDietary;
      }
    }

    setPreferences(updatedPrefs);
    setPreferencesApplied(true);
    toast.success(t('plan.preferencesApplied'));
  };

  const updatePreferences = useCallback((data: Partial<TripPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...data }));
  }, []);

  const getValidationErrors = (): string[] => {
    switch (currentStep) {
      case 1: {
        // Step 1: Destination only
        const stages = preferences.cityPlan || [];
        if (stages.length === 0 || !stages.every(s => s.city.trim().length > 0)) {
          return [t('plan.validation.destination')];
        }
        return [];
      }
      case 2: {
        // Step 2: Origin
        if (!preferences.origin) return [t('plan.validation.origin')];
        return [];
      }
      case 3: {
        // Step 3: When
        if (!preferences.startDate) return [t('plan.validation.startDate')];
        return [];
      }
      case 4: {
        // Step 4: Group
        if (!preferences.groupType) return [t('plan.validation.groupType')];
        return [];
      }
      case 5:
        // Step 5: Style
        return (preferences.activities && preferences.activities.length > 0)
          ? []
          : [t('plan.validation.interests')];
      case 6: {
        // Step 6: Budget
        if (!preferences.budgetLevel && !preferences.budgetCustom) return [t('plan.validation.budget')];
        return [];
      }
      case 7:
        // Step 7: Summary
        return [];
      default:
        return [];
    }
  };

  const canProceed = () => getValidationErrors().length === 0;

  useEffect(() => {
    if (showErrors && canProceed()) {
      setShowErrors(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences, currentStep]);

  const handleNext = () => {
    if (!canProceed()) {
      setShowErrors(true);
      return;
    }
    hapticImpactLight();
    if (currentStep < STEPS.length) {
      directionRef.current = 1;
      setShowErrors(false);
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    hapticImpactLight();
    if (currentStep > 1) {
      directionRef.current = -1;
      setShowErrors(false);
      setCurrentStep(currentStep - 1);
    }
  };

  const handleGenerate = async () => {
    // Pre-check auth + quota before starting generation
    try {
      const preflight = await fetch('/api/generate/preflight');
      const check = await preflight.json();

      if (!check.allowed) {
        if (check.action === 'login') {
          const msg = encodeURIComponent(check.reason || t('plan.error.loginToGenerate'));
          router.push(`/login?redirect=/plan&reason=${msg}`);
          return;
        }
        if (check.action === 'upgrade') {
          const msg = encodeURIComponent(check.reason || t('plan.error.upgradePro'));
          router.push(`/pricing?reason=${msg}`);
          return;
        }
      }
    } catch {
      // Fail open — don't block if preflight errors
    }

    setIsGenerating(true);
    setPipelineStep(undefined);
    try {
      const finalPreferences = { ...preferences };
      if (finalPreferences.cityPlan && finalPreferences.cityPlan.length > 0) {
        finalPreferences.destination = finalPreferences.cityPlan[0].city;
        finalPreferences.durationDays = finalPreferences.cityPlan.reduce((sum, s) => sum + s.days, 0);

        if (finalPreferences.cityPlan.length > 1) {
          const secondaryCities = finalPreferences.cityPlan
            .slice(1)
            .map(s => `${s.city} (${s.days} jours)`)
            .join(', ');
          const multiCityNote = `Itinéraire multi-villes : inclure ${secondaryCities} dans le voyage`;
          finalPreferences.mustSee = finalPreferences.mustSee
            ? `${finalPreferences.mustSee}. ${multiCityNote}`
            : multiCityNote;
        }
      }

      // Ensure defaults for fields not in simplified flow
      if (!finalPreferences.groupType) finalPreferences.groupType = 'couple';
      if (!finalPreferences.groupSize) finalPreferences.groupSize = 2;
      if (!finalPreferences.transport) finalPreferences.transport = 'optimal';
      if (!finalPreferences.budgetLevel) finalPreferences.budgetLevel = 'moderate';

      trackEvent('trip_generation_started', {
        destination: finalPreferences.destination || '',
        duration: finalPreferences.durationDays || 0,
        budget: finalPreferences.budgetLevel || '',
        transport: finalPreferences.transport || '',
        group_size: finalPreferences.groupSize || 0,
      });

      const onProgress = (status: string, event?: PipelineProgressEvent) => {
        if (status === 'progress' && event) {
          // Clear question card when pipeline resumes (all questions answered)
          setCurrentQuestion(null);
          if (event.type === 'step_start' && event.stepName) {
            const label = event.step
              ? `${event.step}/8 — ${event.stepName}`
              : event.stepName;
            setPipelineStep(label);
          } else if (event.type === 'api_call' && event.label) {
            setPipelineStep(event.label);
          }
        }
      };

      const onQuestion = (question: PipelineQuestion): Promise<string> => {
        return new Promise<string>((resolve) => {
          setCurrentQuestion(question);
          questionResolverRef.current = (optionId: string) => {
            questionResolverRef.current = null;
            resolve(optionId);
            // Don't clear currentQuestion immediately — the answered QuestionCard
            // stays visible (with selected state) until the next question arrives
            // or the pipeline emits progress. Avoids a fact-card flash between questions.
          };
        });
      };

      const generatedTrip = await generateTripStream(finalPreferences, onProgress, onQuestion);

      trackEvent('trip_generation_completed', {
        destination: finalPreferences.destination || '',
        duration: finalPreferences.durationDays || 0,
        has_accommodation: !!generatedTrip.accommodation,
        has_flights: !!(generatedTrip.outboundFlight || generatedTrip.returnFlight),
        total_activities: generatedTrip.days?.reduce((sum, day) => sum + day.items.length, 0) || 0,
      });

      if (generatedTrip?.reliabilitySummary?.publishable === false) {
        const failures = Array.isArray(generatedTrip?.reliabilitySummary?.gateFailures)
          ? generatedTrip.reliabilitySummary.gateFailures.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        const shortFailures = failures.length > 0 ? ` (${failures.slice(0, 2).join(' · ')})` : '';
        toast.warning(`Itinéraire généré en brouillon privé${shortFailures}`);
      }

      if (user) {
        try {
          const saveResponse = await fetch('/api/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...generatedTrip, preferences: finalPreferences }),
          });

          if (saveResponse.ok) {
            const savedTrip = await saveResponse.json();
            safeSetItem('currentTrip', JSON.stringify({ ...generatedTrip, id: savedTrip.id }));
            if (generatedTrip.contractViolations?.length) {
              toast.warning(`Itinéraire généré avec ${generatedTrip.contractViolations.length} avertissement${generatedTrip.contractViolations.length > 1 ? 's' : ''}`);
            }
            router.push(`/trip/${savedTrip.id}`);
            return;
          }

          const errorData = await saveResponse.json().catch(() => ({}));
          console.error('[Plan] Save failed:', saveResponse.status, JSON.stringify(errorData));
          toast.error(t('plan.error.saveFailed'));
        } catch (saveError) {
          console.error('[Plan] Save exception:', saveError);
          toast.error(t('plan.error.saveException'));
        }
      }

      if (!generatedTrip.id) {
        throw new Error('Voyage généré sans identifiant');
      }
      safeSetItem('currentTrip', JSON.stringify(generatedTrip));
      if (generatedTrip.contractViolations?.length) {
        toast.warning(`Itinéraire généré avec ${generatedTrip.contractViolations.length} avertissement${generatedTrip.contractViolations.length > 1 ? 's' : ''}`);
      }
      router.push(`/trip/${generatedTrip.id}`);
    } catch (error) {
      console.error('Erreur génération:', error);
      const streamError = error as Error & { code?: string; gateFailures?: string[] };
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      const normalized = message.toLowerCase();
      const userQuotaExceeded =
        isUserQuotaLikeMessage(message)
        || message.includes('QUOTA_EXCEEDED')
        || normalized.includes('rate_limit')
        || normalized.includes('trop de generation');
      const providerQuotaExceeded = !userQuotaExceeded && isProviderQuotaLikeMessage(message);
      const qualityGateFailed =
        streamError?.code === 'QUALITY_GATE_FAILED'
        || normalized.includes('quality_gate_failed')
        || normalized.includes('qualité insuffisante');

      if (message.includes('authentifié') || message.includes('Non authentifié')) {
        toast.error(t('plan.error.loginToGenerate'));
        router.push('/login?redirect=/plan');
      } else if (userQuotaExceeded) {
        router.push('/pricing?reason=' + encodeURIComponent(t('plan.error.upgradePro')));
      } else if (providerQuotaExceeded) {
        setGenerationError('Nos APIs partenaires sont temporairement en limite de quota. Reessaie dans 1 a 2 minutes.');
      } else if (qualityGateFailed) {
        const failures = Array.isArray(streamError?.gateFailures)
          ? streamError.gateFailures.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
          : [];
        const shortFailures = failures.length > 0 ? ` Détails: ${failures.slice(0, 3).join(' · ')}` : '';
        setGenerationError(
          `On a stoppé la publication pour éviter un itinéraire incohérent. Ajuste légèrement la destination, la durée ou le budget puis relance.${shortFailures}`
        );
      } else {
        setGenerationError(message);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRetry = useCallback(() => {
    setGenerationError(null);
    // Re-trigger generation
    handleGenerate();
  }, []);

  const renderedStep = useMemo(() => {
    switch (currentStep) {
      case 1:
        return <StepDestination data={preferences} onChange={updatePreferences} />;
      case 2:
        return <StepOrigin data={preferences} onChange={updatePreferences} />;
      case 3:
        return <StepWhen data={preferences} onChange={updatePreferences} />;
      case 4:
        return <StepGroup data={preferences} onChange={updatePreferences} />;
      case 5:
        return <StepPreferences data={preferences} onChange={updatePreferences} />;
      case 6:
        return <StepBudget data={preferences} onChange={updatePreferences} />;
      case 7:
        return (
          <StepSummary
            data={preferences}
            onChange={updatePreferences}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            onJumpToStep={(step) => {
              directionRef.current = -1;
              setCurrentStep(step);
            }}
          />
        );
      default:
        return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, preferences, updatePreferences, isGenerating]);

  const handleQuestionAnswer = useCallback((questionId: string, selectedOptionId: string) => {
    questionResolverRef.current?.(selectedOptionId);
  }, []);

  const generatingDestination = preferences.cityPlan?.[0]?.city || preferences.destination || '';
  const generatingDuration = preferences.cityPlan
    ? preferences.cityPlan.reduce((sum, s) => sum + s.days, 0)
    : preferences.durationDays;

  // Gate screen — shown instead of wizard when not authorized
  if (gate && gateChecked) {
    return (
      <div className="min-h-screen bg-[#020617] relative flex items-center justify-center">
        <PremiumBackground />
        <div className="relative z-10 max-w-md w-full mx-4">
          <div className="rounded-[2.5rem] border border-white/10 bg-white/[0.03] backdrop-blur-xl p-10 text-center space-y-6 shadow-2xl">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-gold/10 flex items-center justify-center">
              {gate === 'login' ? (
                <ArrowRight className="h-8 w-8 text-gold" />
              ) : (
                <AlertCircle className="h-8 w-8 text-gold" />
              )}
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold text-white">
                {gate === 'login' ? t('plan.createAccount') : t('plan.limitReached')}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {gateMessage}
              </p>
            </div>
            {gate === 'login' ? (
              <div className="space-y-3">
                <Button
                  onClick={() => router.push('/login?redirect=/plan')}
                  className="w-full h-14 rounded-2xl bg-gold hover:bg-gold/90 text-black font-bold text-base"
                >
                  {t('plan.signIn')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => router.push('/register?redirect=/plan')}
                  className="w-full h-12 rounded-xl text-muted-foreground"
                >
                  {t('plan.createAccountFree')}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button
                  onClick={() => router.push('/pricing')}
                  className="w-full h-14 rounded-2xl bg-gold hover:bg-gold/90 text-black font-bold text-base"
                >
                  {t('plan.unlimitedPro')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push('/pricing')}
                  className="w-full h-12 rounded-xl border-white/10 text-white hover:bg-white/5"
                >
                  {t('plan.buyOne')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => router.push('/')}
                  className="w-full h-10 rounded-xl text-muted-foreground text-xs"
                >
                  {t('plan.backToHome')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] relative">
      <PremiumBackground />
      {(isGenerating || generationError) && (
        <GeneratingScreen
          destination={generatingDestination}
          durationDays={generatingDuration}
          pipelineStep={pipelineStep}
          question={currentQuestion}
          onAnswer={handleQuestionAnswer}
          error={generationError ?? undefined}
          onRetry={handleRetry}
        />
      )}

      <div className="container max-w-xl mx-auto px-4 py-4">
        {/* User Preferences Banner */}
        {user && !prefsLoading && userPrefs && !preferencesApplied && (
          <div className="mb-6">
            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" />
                <p className="text-sm">{t('plan.loadPreferences')}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={applyUserPreferences}
                className="text-primary border-primary/30 hover:bg-primary/10 h-7 text-xs"
              >
                {t('plan.apply')}
              </Button>
            </div>
          </div>
        )}

        {/* Step dots */}
        <div className="flex items-center justify-center gap-4 mb-8 pt-2">
          {STEPS.map((step) => (
            <button
              key={step.id}
              onClick={() => {
                if (step.id < currentStep) {
                  directionRef.current = -1;
                  setCurrentStep(step.id);
                }
              }}
              disabled={step.id > currentStep}
              className="flex flex-col items-center gap-2 group relative"
            >
              <div className="relative flex items-center justify-center h-4 w-12">
                <div className={cn(
                  'h-1.5 rounded-full transition-all duration-500 absolute',
                  step.id === currentStep ? 'w-8 bg-gold shadow-[0_0_20px_rgba(197,160,89,0.8)]' : 'w-2 bg-white/10 group-hover:bg-white/30',
                  step.id < currentStep && 'bg-gold/50'
                )} />
              </div>
              <span className={cn(
                'text-[10px] font-black uppercase tracking-[0.2em] transition-colors duration-300 text-center md:absolute md:-bottom-6 md:w-max',
                step.id === currentStep
                  ? 'block mt-1 md:mt-0 text-gold drop-shadow-md'
                  : 'hidden md:block text-white/20 group-hover:text-white/50'
              )}>
                {step.label}
              </span>
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="relative min-h-[400px] md:min-h-[450px] rounded-[2.5rem] border border-white/[0.08] bg-[#020617]/40 backdrop-blur-3xl p-6 sm:p-12 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
          <AnimatePresence mode="wait" custom={directionRef.current}>
            <motion.div
              key={currentStep}
              custom={directionRef.current}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              {renderedStep}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation - sticky bottom */}
        {currentStep < 7 && (
          <div className="sticky bottom-4 mt-8 flex justify-between items-center max-w-xl mx-auto px-4 z-50">
            {currentStep === 1 ? (
              <Button
                variant="ghost"
                onClick={() => router.push('/')}
                className="gap-2 text-muted-foreground hover:text-white hover:bg-white/5 rounded-full px-6 h-14"
              >
                <X className="h-4 w-4" />
                {t('plan.quit')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={handleBack}
                className="gap-2 text-muted-foreground hover:text-white hover:bg-white/5 rounded-full px-6 h-14"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('common.back')}
              </Button>
            )}

            <Button onClick={handleNext} className="gap-2 h-14 px-8 rounded-full font-bold bg-white text-black hover:bg-white/90 shadow-[0_0_20px_rgba(255,255,255,0.15)] transition-all hover:scale-105 active:scale-95">
              {t('common.next')}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Validation errors */}
        <AnimatePresence>
          {showErrors && getValidationErrors().length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-6 flex justify-center"
            >
              <div className="flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/10 backdrop-blur-md px-6 py-3 shadow-xl">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <p className="text-sm font-medium text-red-200">
                  {getValidationErrors()[0]}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {currentStep === 7 && (
          <div className="mt-8 flex justify-center max-w-xl mx-auto px-4">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="gap-2 text-muted-foreground hover:text-white hover:bg-white/5 rounded-full px-6 h-14"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('common.back')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
