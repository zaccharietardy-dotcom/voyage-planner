'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { PipelineQuestion } from '@/lib/types/pipelineQuestions';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  StepDestination,
  StepWhen,
  StepPreferences,
  StepSummary,
} from '@/components/forms';
import { TripPreferences } from '@/lib/types';
import { ArrowLeft, ArrowRight, UserCog, Check, AlertCircle } from 'lucide-react';
import { generateTripStream, PipelineProgressEvent } from '@/lib/generateTrip';
import { cn } from '@/lib/utils';
import { safeSetItem } from '@/lib/storage';
import { useAuth } from '@/components/auth';
import { useUserPreferences, preferenceOptions } from '@/hooks/useUserPreferences';
import { toast } from 'sonner';
import { GeneratingScreen } from '@/components/trip/GeneratingScreen';
import { trackEvent } from '@/lib/analytics';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

import { hapticImpactLight, hapticSuccess } from '@/lib/utils/haptics';

const STEPS = [
  { id: 1, label: 'Où' },
  { id: 2, label: 'Quand' },
  { id: 3, label: 'Style' },
  { id: 4, label: 'Résumé' },
];

const DEFAULT_PREFERENCES: Partial<TripPreferences> = {
  durationDays: 7,
  groupSize: 2,
  transport: 'optimal',
  carRental: false,
  budgetLevel: 'moderate',
  activities: [],
  dietary: ['none'],
  tripMode: 'precise',
  cityPlan: [{ city: '', days: 7 }],
};

export default function PlanPage() {
  const router = useRouter();
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

  // Load template preferences if coming from a template card
  useEffect(() => {
    const stored = sessionStorage.getItem('narae-template');
    if (stored) {
      sessionStorage.removeItem('narae-template');
      try {
        const templatePrefs = JSON.parse(stored);
        setPreferences((prev) => ({ ...prev, ...templatePrefs }));
        toast.success('Modèle chargé — personnalisez et lancez !');
      } catch { /* ignore */ }
    }
  }, []);

  const stepVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 100 : -100,
      y: 10,
      opacity: 0,
      scale: 0.98
    }),
    center: {
      x: 0,
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        x: { type: "spring" as const, stiffness: 300, damping: 30 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.4, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }
      }
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -100 : 100,
      y: -10,
      opacity: 0,
      scale: 0.98,
      transition: {
        x: { duration: 0.3 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.3 }
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
    toast.success('Préférences appliquées !');
  };

  const updatePreferences = useCallback((data: Partial<TripPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...data }));
  }, []);

  const getValidationErrors = (): string[] => {
    switch (currentStep) {
      case 1: {
        const errors: string[] = [];
        if (!preferences.origin) errors.push('Indiquez votre ville de départ');
        const stages = preferences.cityPlan || [];
        if (stages.length === 0 || !stages.every(s => s.city.trim().length > 0)) {
          errors.push('Renseignez au moins une destination');
        }
        return errors;
      }
      case 2: {
        const errors: string[] = [];
        if (!preferences.startDate) errors.push('Choisissez une date de départ');
        return errors;
      }
      case 3:
        return (preferences.activities && preferences.activities.length > 0)
          ? []
          : ['Sélectionnez au moins un centre d\'intérêt'];
      case 4:
        return []; // Summary — always valid
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
          toast.error(check.reason);
          router.push('/login?redirect=/plan');
          return;
        }
        if (check.action === 'upgrade') {
          toast.error(check.reason);
          router.push('/pricing');
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
          toast.error('Sauvegarde échouée. Voyage stocké localement.');
        } catch (saveError) {
          console.error('[Plan] Save exception:', saveError);
          toast.error('Erreur sauvegarde. Voyage stocké localement.');
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
      const message = error instanceof Error ? error.message : 'Erreur inconnue';

      if (message.includes('authentifié') || message.includes('Non authentifié')) {
        toast.error('Connectez-vous pour générer votre voyage');
        router.push('/login?redirect=/plan');
      } else if (message.includes('QUOTA_EXCEEDED') || message.includes('Limite')) {
        toast.error('Passez à Pro pour des voyages illimités');
        router.push('/pricing');
      } else if (message.includes('RATE_LIMIT')) {
        toast.error('Trop de générations récentes. Réessayez dans quelques minutes.');
      } else {
        toast.error(`Une erreur est survenue. Réessayez.`);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const renderedStep = useMemo(() => {
    switch (currentStep) {
      case 1:
        return <StepDestination data={preferences} onChange={updatePreferences} />;
      case 2:
        return <StepWhen data={preferences} onChange={updatePreferences} />;
      case 3:
        return <StepPreferences data={preferences} onChange={updatePreferences} />;
      case 4:
        return (
          <StepSummary
            data={preferences}
            onChange={updatePreferences}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
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

  return (
    <div className="min-h-screen bg-[#020617] relative">
      <PremiumBackground />
      {isGenerating && (
        <GeneratingScreen
          destination={generatingDestination}
          durationDays={generatingDuration}
          pipelineStep={pipelineStep}
          question={currentQuestion}
          onAnswer={handleQuestionAnswer}
        />
      )}

      <div className="container max-w-xl mx-auto px-4 py-8">
        {/* User Preferences Banner */}
        {user && !prefsLoading && userPrefs && !preferencesApplied && (
          <div className="mb-6">
            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" />
                <p className="text-sm">Charger mes préférences</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={applyUserPreferences}
                className="text-primary border-primary/30 hover:bg-primary/10 h-7 text-xs"
              >
                Appliquer
              </Button>
            </div>
          </div>
        )}

        {/* Step dots */}
        <div className="flex items-center justify-center gap-3 mb-8">
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
              className="flex flex-col items-center gap-1.5"
            >
              <div className={cn(
                'w-2.5 h-2.5 rounded-full transition-all',
                step.id === currentStep && 'w-8 bg-primary',
                step.id < currentStep && 'bg-primary/40 cursor-pointer',
                step.id > currentStep && 'bg-muted-foreground/20'
              )} />
              <span className={cn(
                'text-[10px] font-medium',
                step.id === currentStep ? 'text-primary' : 'text-muted-foreground/60'
              )}>
                {step.label}
              </span>
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="rounded-[2.5rem] border border-white/10 bg-black/40 backdrop-blur-3xl p-6 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
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

        {/* Navigation */}
        {currentStep < 4 && (
          <div className="mt-5 space-y-3">
            <div className="flex justify-between">
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={currentStep === 1}
                className="gap-1.5 text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Retour
              </Button>

              <Button onClick={handleNext} className="gap-1.5 rounded-xl">
                Suivant
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Validation errors */}
            <AnimatePresence>
              {showErrors && getValidationErrors().length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-0.5">
                    {getValidationErrors().map((error) => (
                      <p key={error} className="text-sm text-amber-700 dark:text-amber-300">
                        {error}
                      </p>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {currentStep === 4 && (
          <div className="mt-4">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="gap-1.5 text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Retour
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
