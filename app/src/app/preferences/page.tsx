'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Gem,
  Compass,
  Utensils,
  Bed,
  Clock,
  Heart,
  Accessibility,
  Save,
  Wand2,
  Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/auth';
import { useUserPreferences, preferenceOptions, defaultPreferences } from '@/hooks/useUserPreferences';
import { UserPreferences } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { TripStyleQuiz } from '@/components/trip/TripStyleQuiz';

type Step = 'travel_style' | 'budget' | 'accommodation' | 'pace' | 'activities' | 'food' | 'accessibility' | 'summary';

const steps: { id: Step; title: string; icon: React.ReactNode; description: string }[] = [
  { id: 'travel_style', title: 'Style de voyage', icon: <Compass className="h-5 w-5" />, description: 'Comment aimez-vous voyager ?' },
  { id: 'budget', title: 'Budget', icon: <Gem className="h-5 w-5" />, description: 'Quel est votre budget type ?' },
  { id: 'accommodation', title: 'Hébergement', icon: <Bed className="h-5 w-5" />, description: 'Où préférez-vous dormir ?' },
  { id: 'pace', title: 'Rythme', icon: <Clock className="h-5 w-5" />, description: 'À quel rythme voyagez-vous ?' },
  { id: 'activities', title: 'Activités', icon: <Heart className="h-5 w-5" />, description: 'Que préférez-vous faire ?' },
  { id: 'food', title: 'Alimentation', icon: <Utensils className="h-5 w-5" />, description: 'Vos préférences culinaires' },
  { id: 'accessibility', title: 'Accessibilité', icon: <Accessibility className="h-5 w-5" />, description: 'Besoins spécifiques ?' },
  { id: 'summary', title: 'Résumé', icon: <Check className="h-5 w-5" />, description: 'Vérifiez vos préférences' },
];

export default function PreferencesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const { preferences, isLoading: prefsLoading, savePreferences, refetch } = useUserPreferences();

  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<UserPreferences>>(defaultPreferences);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizMode, setQuizMode] = useState<'initial' | 'modify'>('initial');

  // Load existing preferences
  useEffect(() => {
    if (preferences) {
      setFormData(preferences);
      setShowQuiz(false);
    } else if (!prefsLoading && !preferences) {
      // New user without preferences - show quiz option
      setQuizMode('initial');
    }
  }, [preferences, prefsLoading]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/preferences');
    }
  }, [user, authLoading, router]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const success = await savePreferences(formData);
      if (success) {
        toast.success('Préférences sauvegardées !');
        router.push('/plan');
      } else {
        toast.error('Erreur lors de la sauvegarde');
      }
    } catch {
      toast.error('Une erreur est survenue');
    } finally {
      setIsSaving(false);
    }
  };

  const handleQuizComplete = async () => {
    await refetch();
    setShowQuiz(false);
    toast.success('Quiz terminé ! Vos préférences ont été enregistrées.');
  };

  const handleQuizClose = () => {
    setShowQuiz(false);
  };

  const updateFormData = (key: keyof UserPreferences, value: unknown) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayValue = (key: keyof UserPreferences, value: string) => {
    const current = (formData[key] as string[]) || [];
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    updateFormData(key, updated);
  };

  if (authLoading || prefsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const currentStepData = steps[currentStep];

  // Show quiz if requested
  if (showQuiz) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 py-8">
        <div className="container mx-auto px-4">
          <TripStyleQuiz onComplete={handleQuizComplete} onClose={handleQuizClose} />
        </div>
      </div>
    );
  }

  // Show initial choice for new users
  if (quizMode === 'initial' && !preferences && !prefsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center py-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Compass className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-3xl mb-2">Bienvenue !</CardTitle>
              <CardDescription className="text-base">
                Commençons par définir vos préférences de voyage
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={() => setShowQuiz(true)}
                className="w-full h-auto py-6 flex-col gap-2"
                size="lg"
              >
                <Wand2 className="h-6 w-6" />
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">Quiz interactif (recommandé)</span>
                  <span className="text-xs font-normal opacity-90">5 questions rapides - 2 minutes</span>
                </div>
              </Button>

              <Button
                onClick={() => setQuizMode('modify')}
                variant="outline"
                className="w-full h-auto py-6 flex-col gap-2"
                size="lg"
              >
                <Settings className="h-6 w-6" />
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">Configuration manuelle</span>
                  <span className="text-xs font-normal opacity-70">Définir chaque préférence en détail</span>
                </div>
              </Button>

              <div className="text-center pt-4">
                <Button variant="ghost" onClick={() => router.push('/plan')}>
                  Passer pour l&apos;instant
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 py-8">
      <div className="container mx-auto px-4 max-w-3xl">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Retour
            </Button>
            <div className="flex items-center gap-2">
              {preferences && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowQuiz(true)}
                  className="gap-1"
                >
                  <Wand2 className="h-3 w-3" />
                  Refaire le quiz
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Étape {currentStep + 1} sur {steps.length}
              </span>
            </div>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-primary/80"
              initial={{ width: 0 }}
              animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="flex justify-between mt-2">
            {steps.map((step, index) => (
              <button
                key={step.id}
                onClick={() => setCurrentStep(index)}
                className={cn(
                  'flex flex-col items-center gap-1 transition-colors',
                  index <= currentStep ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs',
                  index < currentStep ? 'bg-primary text-primary-foreground' :
                  index === currentStep ? 'bg-primary/20 text-primary' : 'bg-muted'
                )}>
                  {index < currentStep ? <Check className="h-4 w-4" /> : step.icon}
                </div>
                <span className="text-xs hidden sm:block">{step.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                {currentStepData.icon}
              </div>
              <CardTitle className="text-2xl">{currentStepData.title}</CardTitle>
              <CardDescription>{currentStepData.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {/* Travel Style */}
              {currentStepData.id === 'travel_style' && (
                <div className="grid gap-3">
                  {preferenceOptions.travelStyle.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateFormData('travel_style', option.value)}
                      className={cn(
                        'p-4 rounded-xl border-2 text-left transition-all',
                        formData.travel_style === option.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="text-sm text-muted-foreground">{option.description}</div>
                    </button>
                  ))}
                </div>
              )}

              {/* Budget */}
              {currentStepData.id === 'budget' && (
                <div className="grid gap-3">
                  {preferenceOptions.budgetPreference.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateFormData('budget_preference', option.value)}
                      className={cn(
                        'p-4 rounded-xl border-2 text-left transition-all',
                        formData.budget_preference === option.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="text-sm text-muted-foreground">{option.description}</div>
                    </button>
                  ))}
                </div>
              )}

              {/* Accommodation */}
              {currentStepData.id === 'accommodation' && (
                <div className="grid gap-3">
                  {preferenceOptions.accommodationPreference.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateFormData('accommodation_preference', option.value)}
                      className={cn(
                        'p-4 rounded-xl border-2 text-left transition-all',
                        formData.accommodation_preference === option.value
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="text-sm text-muted-foreground">{option.description}</div>
                    </button>
                  ))}
                </div>
              )}

              {/* Pace */}
              {currentStepData.id === 'pace' && (
                <div className="space-y-6">
                  <div className="grid gap-3">
                    <h4 className="font-medium text-sm text-muted-foreground">Rythme de voyage</h4>
                    {preferenceOptions.pacePreference.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => updateFormData('pace_preference', option.value)}
                        className={cn(
                          'p-4 rounded-xl border-2 text-left transition-all',
                          formData.pace_preference === option.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="text-sm text-muted-foreground">{option.description}</div>
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3">
                    <h4 className="font-medium text-sm text-muted-foreground">Heure de réveil</h4>
                    {preferenceOptions.wakeUpTime.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => updateFormData('wake_up_time', option.value)}
                        className={cn(
                          'p-4 rounded-xl border-2 text-left transition-all',
                          formData.wake_up_time === option.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        )}
                      >
                        <div className="font-medium">{option.label}</div>
                        <div className="text-sm text-muted-foreground">{option.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Activities */}
              {currentStepData.id === 'activities' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Sélectionnez toutes les activités qui vous intéressent
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {preferenceOptions.favoriteActivities.map((option) => (
                      <Badge
                        key={option.value}
                        variant={formData.favorite_activities?.includes(option.value) ? 'default' : 'outline'}
                        className={cn(
                          'cursor-pointer py-2 px-4 text-sm transition-all',
                          formData.favorite_activities?.includes(option.value)
                            ? 'bg-primary hover:bg-primary/90'
                            : 'hover:bg-primary/10'
                        )}
                        onClick={() => toggleArrayValue('favorite_activities', option.value)}
                      >
                        {option.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Food */}
              {currentStepData.id === 'food' && (
                <div className="space-y-6">
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground">Régimes alimentaires</h4>
                    <div className="flex flex-wrap gap-2">
                      {preferenceOptions.dietaryRestrictions.map((option) => (
                        <Badge
                          key={option.value}
                          variant={formData.dietary_restrictions?.includes(option.value) ? 'default' : 'outline'}
                          className={cn(
                            'cursor-pointer py-2 px-4 text-sm transition-all',
                            formData.dietary_restrictions?.includes(option.value)
                              ? 'bg-primary hover:bg-primary/90'
                              : 'hover:bg-primary/10'
                          )}
                          onClick={() => toggleArrayValue('dietary_restrictions', option.value)}
                        >
                          {option.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm text-muted-foreground">Type de cuisine</h4>
                    <div className="flex flex-wrap gap-2">
                      {preferenceOptions.cuisinePreferences.map((option) => (
                        <Badge
                          key={option.value}
                          variant={formData.cuisine_preferences?.includes(option.value) ? 'default' : 'outline'}
                          className={cn(
                            'cursor-pointer py-2 px-4 text-sm transition-all',
                            formData.cuisine_preferences?.includes(option.value)
                              ? 'bg-primary hover:bg-primary/90'
                              : 'hover:bg-primary/10'
                          )}
                          onClick={() => toggleArrayValue('cuisine_preferences', option.value)}
                        >
                          {option.label}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Accessibility */}
              {currentStepData.id === 'accessibility' && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Avez-vous des besoins d&apos;accessibilité ? (optionnel)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {preferenceOptions.accessibilityNeeds.map((option) => (
                      <Badge
                        key={option.value}
                        variant={formData.accessibility_needs?.includes(option.value) ? 'default' : 'outline'}
                        className={cn(
                          'cursor-pointer py-2 px-4 text-sm transition-all',
                          formData.accessibility_needs?.includes(option.value)
                            ? 'bg-primary hover:bg-primary/90'
                            : 'hover:bg-primary/10'
                        )}
                        onClick={() => toggleArrayValue('accessibility_needs', option.value)}
                      >
                        {option.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    Ces informations nous permettent de vous proposer des activités adaptées.
                  </p>
                </div>
              )}

              {/* Summary */}
              {currentStepData.id === 'summary' && (
                <div className="space-y-6">
                  <div className="grid gap-4">
                    <SummaryItem
                      label="Style de voyage"
                      value={preferenceOptions.travelStyle.find(o => o.value === formData.travel_style)?.label || '-'}
                    />
                    <SummaryItem
                      label="Budget"
                      value={preferenceOptions.budgetPreference.find(o => o.value === formData.budget_preference)?.label || '-'}
                    />
                    <SummaryItem
                      label="Hébergement"
                      value={preferenceOptions.accommodationPreference.find(o => o.value === formData.accommodation_preference)?.label || '-'}
                    />
                    <SummaryItem
                      label="Rythme"
                      value={preferenceOptions.pacePreference.find(o => o.value === formData.pace_preference)?.label || '-'}
                    />
                    <SummaryItem
                      label="Réveil"
                      value={preferenceOptions.wakeUpTime.find(o => o.value === formData.wake_up_time)?.label || '-'}
                    />
                    {(formData.favorite_activities?.length ?? 0) > 0 && (
                      <SummaryItem
                        label="Activités"
                        value={
                          <div className="flex flex-wrap gap-1">
                            {formData.favorite_activities?.map(v => (
                              <Badge key={v} variant="secondary" className="text-xs">
                                {preferenceOptions.favoriteActivities.find(o => o.value === v)?.label}
                              </Badge>
                            ))}
                          </div>
                        }
                      />
                    )}
                    {(formData.dietary_restrictions?.length ?? 0) > 0 && (
                      <SummaryItem
                        label="Régimes"
                        value={
                          <div className="flex flex-wrap gap-1">
                            {formData.dietary_restrictions?.map(v => (
                              <Badge key={v} variant="secondary" className="text-xs">
                                {preferenceOptions.dietaryRestrictions.find(o => o.value === v)?.label}
                              </Badge>
                            ))}
                          </div>
                        }
                      />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Ces préférences seront utilisées pour personnaliser vos futurs voyages.
                    Vous pourrez les modifier à tout moment.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handlePrev}
            disabled={currentStep === 0}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Précédent
          </Button>

          {currentStep === steps.length - 1 ? (
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Sauvegarder
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Suivant
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
