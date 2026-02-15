'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowRight, ArrowLeft, Sparkles, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { toast } from 'sonner';

interface QuizQuestion {
  id: string;
  question: string;
  emoji: string;
  type: 'single' | 'multi';
  options: {
    value: string;
    label: string;
    emoji: string;
    description?: string;
  }[];
}

const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'pace',
    question: 'Quel est votre rythme de voyage idéal ?',
    emoji: '⏱️',
    type: 'single',
    options: [
      {
        value: 'relaxed',
        label: 'Détente',
        emoji: '🧘',
        description: '2-3 activités par jour, beaucoup de temps libre',
      },
      {
        value: 'moderate',
        label: 'Modéré',
        emoji: '🚶',
        description: '4-5 activités par jour, équilibre parfait',
      },
      {
        value: 'intense',
        label: 'Intense',
        emoji: '🏃',
        description: 'Maximiser chaque journée, voir le plus possible',
      },
    ],
  },
  {
    id: 'budget',
    question: 'Quel est votre budget de voyage ?',
    emoji: '💰',
    type: 'single',
    options: [
      {
        value: 'budget',
        label: 'Économique',
        emoji: '💵',
        description: 'Auberges, street food, transports en commun',
      },
      {
        value: 'moderate',
        label: 'Modéré',
        emoji: '💳',
        description: 'Hôtels 3★, restaurants variés, bon rapport qualité-prix',
      },
      {
        value: 'comfort',
        label: 'Confort',
        emoji: '💎',
        description: 'Hôtels 4★, bons restaurants, quelques extras',
      },
      {
        value: 'luxury',
        label: 'Luxe',
        emoji: '👑',
        description: 'Hôtels 5★, gastronomie, services premium',
      },
    ],
  },
  {
    id: 'style',
    question: 'Quelle ambiance vous attire le plus ?',
    emoji: '🎭',
    type: 'single',
    options: [
      {
        value: 'cultural',
        label: 'Culture & Histoire',
        emoji: '🏛️',
        description: 'Musées, monuments, patrimoine',
      },
      {
        value: 'relaxed',
        label: 'Nature & Détente',
        emoji: '🌿',
        description: 'Parcs, plages, espaces verts',
      },
      {
        value: 'adventurous',
        label: 'Aventure & Sport',
        emoji: '🏄',
        description: 'Randonnée, activités physiques',
      },
      {
        value: 'party',
        label: 'Vie nocturne',
        emoji: '🍸',
        description: 'Bars, clubs, festivals',
      },
      {
        value: 'balanced',
        label: 'Équilibré',
        emoji: '⚖️',
        description: 'Un peu de tout',
      },
    ],
  },
  {
    id: 'activities',
    question: 'Quelles activités préférez-vous ? (plusieurs choix possibles)',
    emoji: '🎯',
    type: 'multi',
    options: [
      { value: 'museums', label: 'Musées', emoji: '🖼️' },
      { value: 'monuments', label: 'Monuments', emoji: '🗿' },
      { value: 'nature', label: 'Nature & Parcs', emoji: '🌳' },
      { value: 'beaches', label: 'Plages', emoji: '🏖️' },
      { value: 'hiking', label: 'Randonnée', emoji: '🥾' },
      { value: 'shopping', label: 'Shopping', emoji: '🛍️' },
      { value: 'nightlife', label: 'Vie nocturne', emoji: '🌙' },
      { value: 'food_tours', label: 'Gastronomie', emoji: '🍽️' },
      { value: 'sports', label: 'Sports & Aventure', emoji: '⛷️' },
      { value: 'wellness', label: 'Bien-être & Spa', emoji: '💆' },
      { value: 'photography', label: 'Photographie', emoji: '📸' },
      { value: 'local_experiences', label: 'Expériences locales', emoji: '🎪' },
    ],
  },
  {
    id: 'wakeup',
    question: 'À quelle heure préférez-vous commencer la journée ?',
    emoji: '⏰',
    type: 'single',
    options: [
      {
        value: 'early',
        label: 'Tôt (avant 7h)',
        emoji: '🌅',
        description: 'Profiter du lever du soleil',
      },
      {
        value: 'normal',
        label: 'Normal (7h-9h)',
        emoji: '☀️',
        description: 'Réveil classique',
      },
      {
        value: 'late',
        label: 'Tard (après 9h)',
        emoji: '😴',
        description: 'Grasse matinée appréciée',
      },
    ],
  },
];

interface TripStyleQuizProps {
  onComplete?: () => void;
  onClose?: () => void;
}

export function TripStyleQuiz({ onComplete, onClose }: TripStyleQuizProps) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { savePreferences } = useUserPreferences();

  const question = QUIZ_QUESTIONS[currentQuestion];
  const progress = ((currentQuestion + 1) / QUIZ_QUESTIONS.length) * 100;

  const handleSelect = (value: string) => {
    if (question.type === 'single') {
      setAnswers({ ...answers, [question.id]: value });
    } else {
      const current = (answers[question.id] as string[]) || [];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      setAnswers({ ...answers, [question.id]: updated });
    }
  };

  const isSelected = (value: string) => {
    if (question.type === 'single') {
      return answers[question.id] === value;
    }
    return ((answers[question.id] as string[]) || []).includes(value);
  };

  const canProceed = () => {
    const answer = answers[question.id];
    if (question.type === 'single') {
      return !!answer;
    }
    return Array.isArray(answer) && answer.length > 0;
  };

  const handleNext = () => {
    if (currentQuestion < QUIZ_QUESTIONS.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const handleBack = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const preferences = {
        pace_preference: answers.pace as 'relaxed' | 'moderate' | 'intense',
        budget_preference: answers.budget as 'budget' | 'moderate' | 'comfort' | 'luxury',
        travel_style: answers.style as 'adventurous' | 'relaxed' | 'cultural' | 'party' | 'balanced',
        favorite_activities: answers.activities as string[],
        wake_up_time: answers.wakeup as 'early' | 'normal' | 'late',
      };

      const success = await savePreferences(preferences);

      if (success) {
        toast.success('Préférences sauvegardées avec succès !');
        onComplete?.();
      } else {
        toast.error('Erreur lors de la sauvegarde des préférences');
      }
    } catch (error) {
      console.error('Quiz submission error:', error);
      toast.error('Une erreur est survenue');
    } finally {
      setIsSubmitting(false);
    }
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 100 : -100,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction > 0 ? -100 : 100,
      opacity: 0,
    }),
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Sparkles className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-bold">Découvrez votre style de voyage</h2>
        </div>
        <p className="text-muted-foreground">
          Répondez à quelques questions pour personnaliser vos futurs voyages
        </p>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">
            Question {currentQuestion + 1} sur {QUIZ_QUESTIONS.length}
          </span>
          <span className="text-sm text-muted-foreground">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Question Card */}
      <Card className="overflow-hidden">
        <CardContent className="p-8">
          <AnimatePresence mode="wait" custom={1}>
            <motion.div
              key={currentQuestion}
              custom={1}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              {/* Question */}
              <div className="mb-8 text-center">
                <div className="text-6xl mb-4">{question.emoji}</div>
                <h3 className="text-xl font-semibold mb-2">{question.question}</h3>
                {question.type === 'multi' && (
                  <p className="text-sm text-muted-foreground">
                    Sélectionnez toutes les options qui vous intéressent
                  </p>
                )}
              </div>

              {/* Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {question.options.map((option) => (
                  <motion.button
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'relative p-4 rounded-xl border-2 text-left transition-all',
                      'hover:border-primary/50 hover:bg-primary/5',
                      isSelected(option.value)
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-card'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-3xl flex-shrink-0">{option.emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{option.label}</span>
                          {isSelected(option.value) && (
                            <Check className="h-4 w-4 text-primary flex-shrink-0" />
                          )}
                        </div>
                        {option.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {option.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <Button
          variant="outline"
          onClick={currentQuestion === 0 ? onClose : handleBack}
          disabled={isSubmitting}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          {currentQuestion === 0 ? 'Annuler' : 'Retour'}
        </Button>

        {currentQuestion < QUIZ_QUESTIONS.length - 1 ? (
          <Button onClick={handleNext} disabled={!canProceed()} className="gap-2">
            Suivant
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={!canProceed() || isSubmitting}
            className="gap-2 bg-gradient-to-r from-primary to-primary/80"
          >
            {isSubmitting ? (
              <>
                <Clock className="h-4 w-4 animate-spin" />
                Sauvegarde...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Terminer
              </>
            )}
          </Button>
        )}
      </div>

      {/* Selected Activities Count */}
      {question.type === 'multi' && (
        <div className="mt-4 text-center">
          <Badge variant="secondary">
            {((answers[question.id] as string[]) || []).length} sélectionnée(s)
          </Badge>
        </div>
      )}
    </div>
  );
}
