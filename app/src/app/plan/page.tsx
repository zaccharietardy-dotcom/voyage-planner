'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
import { ArrowLeft, ArrowRight, Sparkles, Loader2, UserCog, Check } from 'lucide-react';
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
  groupSize: 2,
  transport: 'plane',
  carRental: false,
  budgetLevel: 'moderate',
  activities: [],
  dietary: ['none'],
};

export default function PlanPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { preferences: userPrefs, isLoading: prefsLoading } = useUserPreferences();
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preferences, setPreferences] = useState<Partial<TripPreferences>>(DEFAULT_PREFERENCES);
  const [preferencesApplied, setPreferencesApplied] = useState(false);

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
      case 1:
        return preferences.origin && preferences.destination && preferences.startDate;
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
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      // 1. Générer le voyage avec l'IA
      const generateResponse = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!generateResponse.ok) {
        const errorData = await generateResponse.json().catch(() => ({}));
        const errorMessage = errorData.error || `Erreur ${generateResponse.status}`;
        throw new Error(errorMessage);
      }

      const generatedTrip = await generateResponse.json();

      // 2. Si l'utilisateur est connecté, sauvegarder en base de données
      if (user) {
        const saveResponse = await fetch('/api/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...generatedTrip,
            preferences,
          }),
        });

        if (saveResponse.ok) {
          const savedTrip = await saveResponse.json();
          // Utiliser l'ID de la base de données
          localStorage.setItem('currentTrip', JSON.stringify({ ...generatedTrip, id: savedTrip.id }));
          router.push(`/trip/${savedTrip.id}`);
          return;
        }
        // Si la sauvegarde échoue, continuer avec localStorage
        console.warn('Sauvegarde en BDD échouée, utilisation localStorage');
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
            <h1 className="text-lg font-semibold">Planifier votre voyage</h1>
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
                onClick={() => step.id < currentStep && setCurrentStep(step.id)}
                disabled={step.id > currentStep}
                className={cn(
                  'flex flex-col items-center gap-1 transition-all',
                  step.id === currentStep && 'scale-110',
                  step.id < currentStep && 'cursor-pointer opacity-70 hover:opacity-100',
                  step.id > currentStep && 'opacity-40 cursor-not-allowed'
                )}
              >
                <span className="text-2xl">{step.icon}</span>
                <span className="text-xs font-medium hidden sm:block">{step.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Form card */}
        <Card className="shadow-lg">
          <CardContent className="p-6 sm:p-8">{renderStep()}</CardContent>
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
