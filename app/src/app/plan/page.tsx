'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import {
  StepDestination,
  StepTransport,
  StepGroup,
  StepBudget,
  StepActivities,
} from '@/components/forms';
import { TripPreferences } from '@/lib/types';
import { ArrowLeft, ArrowRight, Sparkles, Loader2, UserCog, Check, Shuffle } from 'lucide-react';
import { generateRandomPreferences } from '@/lib/randomExample';
import { generateTripStream } from '@/lib/generateTrip';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth';
import { useUserPreferences, preferenceOptions } from '@/hooks/useUserPreferences';
import { toast } from 'sonner';

const STEPS = [
  { id: 1, title: 'Destination', icon: '📍' },
  { id: 2, title: 'Transport', icon: '✈️' },
  { id: 3, title: 'Groupe', icon: '👥' },
  { id: 4, title: 'Budget', icon: '💰' },
  { id: 5, title: 'Activités', icon: '🎯' },
];

const DEFAULT_PREFERENCES: Partial<TripPreferences> = {
  durationDays: 7,
  groupSize: 1,
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
  const directionRef = useRef(1); // 1 = forward, -1 = backward

  // Animation variants for step transitions
  const stepVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 80 : -80,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -80 : 80,
      opacity: 0,
    }),
  };

  // Function to apply user preferences to trip form
  const applyUserPreferences = () => {
    if (!userPrefs) return;

    const updatedPrefs: Partial<TripPreferences> = { ...preferences };

    // Map budget preference (user prefs uses 'budget', form uses 'economic')
    if (userPrefs.budget_preference) {
      const budgetMap: Record<string, 'economic' | 'moderate' | 'comfort' | 'luxury'> = {
        'budget': 'economic',
        'moderate': 'moderate',
        'comfort': 'comfort',
        'luxury': 'luxury',
      };
      updatedPrefs.budgetLevel = budgetMap[userPrefs.budget_preference] || 'moderate';
    }

    // Map activities (filter to match available activities in the form)
    if (userPrefs.favorite_activities && userPrefs.favorite_activities.length > 0) {
      // Map user preference activities to form ActivityType
      type ActivityType = 'beach' | 'nature' | 'culture' | 'gastronomy' | 'nightlife' | 'shopping' | 'adventure' | 'wellness';
      const activityMapping: Record<string, ActivityType> = {
        'museums': 'culture',
        'monuments': 'culture',
        'nature': 'nature',
        'beaches': 'beach',
        'hiking': 'adventure',
        'shopping': 'shopping',
        'nightlife': 'nightlife',
        'food_tours': 'gastronomy',
        'sports': 'adventure',
        'wellness': 'wellness',
        'photography': 'culture',
        'local_experiences': 'culture',
      };

      const mappedActivities = userPrefs.favorite_activities
        .map(a => activityMapping[a])
        .filter((a): a is ActivityType => !!a);

      if (mappedActivities.length > 0) {
        updatedPrefs.activities = [...new Set(mappedActivities)] as ActivityType[];
      }
    }

    // Map dietary restrictions
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

  const canProceed = () => {
    switch (currentStep) {
      case 1: {
        const hasOrigin = !!preferences.origin;
        const hasDate = !!preferences.startDate;
        const stages = preferences.cityPlan || [];
        const hasDestination = stages.length > 0 && stages.every(s => s.city.trim().length > 0);
        return hasOrigin && hasDate && hasDestination;
      }
      case 2:
        return preferences.transport;
      case 3:
        return preferences.groupSize && preferences.groupType;
      case 4:
        return preferences.budgetLevel || preferences.budgetCustom;
      case 5:
        return preferences.activities && preferences.activities.length > 0;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 5) {
      directionRef.current = 1;
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      directionRef.current = -1;
      setCurrentStep(currentStep - 1);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      // Sync cityPlan → destination + durationDays for pipeline compatibility
      const finalPreferences = { ...preferences };
      if (finalPreferences.cityPlan && finalPreferences.cityPlan.length > 0) {
        finalPreferences.destination = finalPreferences.cityPlan[0].city;
        finalPreferences.durationDays = finalPreferences.cityPlan.reduce((sum, s) => sum + s.days, 0);

        // For multi-city trips, enrich mustSee with secondary cities for Claude
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

      // 1. Générer le voyage avec l'IA (streaming pour éviter timeout 504)
      const generatedTrip = await generateTripStream(finalPreferences);

      // 2. Si l'utilisateur est connecté, sauvegarder en base de données
      if (user) {
        try {
          const saveResponse = await fetch('/api/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...generatedTrip,
              preferences: finalPreferences,
            }),
          });

          if (saveResponse.ok) {
            const savedTrip = await saveResponse.json();
            // Utiliser l'ID de la base de données
            localStorage.setItem('currentTrip', JSON.stringify({ ...generatedTrip, id: savedTrip.id }));
            router.push(`/trip/${savedTrip.id}`);
            return;
          }

          // Sauvegarde échouée - afficher l'erreur complète pour debug
          const errorData = await saveResponse.json().catch(() => ({}));
          console.error('[Plan] Save failed:', saveResponse.status, JSON.stringify(errorData));
          const errorMsg = [errorData.error, errorData.details, errorData.hint].filter(Boolean).join(' | ');
          toast.error(`Sauvegarde échouée: ${errorMsg || 'Erreur inconnue'}. Le voyage sera stocké localement.`);
        } catch (saveError) {
          console.error('[Plan] Save exception:', saveError);
          toast.error('Erreur lors de la sauvegarde. Le voyage sera stocké localement.');
        }
      }

      // Fallback: localStorage pour les utilisateurs non connectés
      if (!generatedTrip.id) {
        throw new Error('Voyage généré sans identifiant');
      }
      localStorage.setItem('currentTrip', JSON.stringify(generatedTrip));
      router.push(`/trip/${generatedTrip.id}`);
    } catch (error) {
      console.error('Erreur génération:', error);
      const message = error instanceof Error ? error.message : 'Erreur inconnue';
      toast.error(`Erreur: ${message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <StepDestination data={preferences} onChange={updatePreferences} />;
      case 2:
        return <StepTransport data={preferences} onChange={updatePreferences} />;
      case 3:
        return <StepGroup data={preferences} onChange={updatePreferences} />;
      case 4:
        return <StepBudget data={preferences} onChange={updatePreferences} />;
      case 5:
        return <StepActivities data={preferences} onChange={updatePreferences} />;
      default:
        return null;
    }
  };

  const progress = (currentStep / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container max-w-2xl mx-auto px-4 py-8">
        {/* User Preferences Banner */}
        {user && !prefsLoading && (
          <div className="mb-6">
            {userPrefs ? (
              <div className="flex items-center justify-between p-4 rounded-xl bg-primary/5 border border-primary/20">
                <div className="flex items-center gap-3">
                  <UserCog className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">Vos préférences de voyage</p>
                    <p className="text-xs text-muted-foreground">
                      {preferenceOptions.travelStyle.find(o => o.value === userPrefs.travel_style)?.label} · {preferenceOptions.budgetPreference.find(o => o.value === userPrefs.budget_preference)?.label}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {preferencesApplied ? (
                    <span className="text-sm text-primary flex items-center gap-1">
                      <Check className="h-4 w-4" />
                      Appliquées
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={applyUserPreferences}
                      className="text-primary border-primary/30 hover:bg-primary/10"
                    >
                      Charger
                    </Button>
                  )}
                  <Link href="/preferences">
                    <Button variant="ghost" size="sm">
                      Modifier
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <Link href="/preferences" className="block">
                <div className="flex items-center justify-between p-4 rounded-xl bg-muted/50 border border-border hover:bg-muted/80 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <UserCog className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Définir mes préférences</p>
                      <p className="text-xs text-muted-foreground">
                        Gagnez du temps en sauvegardant vos préférences
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            )}
          </div>
        )}

        {/* Progress header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Planifier votre voyage</h1>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreferences(generateRandomPreferences());
                  setCurrentStep(1);
                  toast.success('Exemple aléatoire chargé !');
                }}
                className="gap-1 text-xs"
              >
                <Shuffle className="h-3 w-3" />
                Exemple aléatoire
              </Button>
            </div>
            <span className="text-sm text-muted-foreground">
              Étape {currentStep} sur {STEPS.length}
            </span>
          </div>
          <Progress value={progress} className="h-2" />

          {/* Step indicators */}
          <div className="flex justify-between mt-4">
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
                className={cn(
                  'relative flex flex-col items-center gap-1 transition-all',
                  step.id < currentStep && 'cursor-pointer opacity-70 hover:opacity-100',
                  step.id > currentStep && 'opacity-40 cursor-not-allowed'
                )}
              >
                {step.id === currentStep && (
                  <motion.div
                    layoutId="step-active-pill"
                    className="absolute -inset-1.5 rounded-xl bg-primary/10 border border-primary/20"
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                  />
                )}
                <span className="relative text-2xl">{step.icon}</span>
                <span className="relative text-xs font-medium hidden sm:block">{step.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Form card */}
        <Card className="shadow-lg overflow-hidden">
          <CardContent className="p-6 sm:p-8">
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
                {renderStep()}
              </motion.div>
            </AnimatePresence>
          </CardContent>
        </Card>

        {/* Navigation buttons */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 1}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour
          </Button>

          {currentStep < 5 ? (
            <Button onClick={handleNext} disabled={!canProceed()} className="gap-2">
              Suivant
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={!canProceed() || isGenerating}
              className="gap-2 bg-gradient-to-r from-primary to-primary/80"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Génération en cours...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Générer mon voyage
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
