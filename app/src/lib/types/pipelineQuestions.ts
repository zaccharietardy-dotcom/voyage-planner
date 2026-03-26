/**
 * Types for pipeline smart questions and post-generation feedback cards.
 */

export interface QuestionOption {
  id: string;
  label: string;
  subtitle?: string;
  emoji?: string;
  isDefault: boolean;
}

export interface PipelineQuestion {
  questionId: string;
  sessionId: string;
  type: 'full_day_activity' | 'day_trip' | 'activity_balance' | 'hotel_area';
  title: string;
  prompt: string;
  options: QuestionOption[];
  timeoutMs: number;
  metadata?: Record<string, unknown>;
}

export interface QuestionAnswer {
  sessionId: string;
  questionId: string;
  selectedOptionId: string;
}

export interface FeedbackCard {
  id: string;
  type: 'restaurant_swap' | 'activity_swap';
  dayNumber: number;
  slotLabel: string;
  optionA: {
    id: string;
    name: string;
    rating?: number;
    imageUrl?: string;
    cuisineOrType?: string;
  };
  optionB: {
    id: string;
    name: string;
    rating?: number;
    imageUrl?: string;
    cuisineOrType?: string;
  };
  targetItemId: string;
}
