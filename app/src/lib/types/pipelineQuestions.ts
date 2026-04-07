/**
 * Types for pipeline smart questions and post-generation feedback cards.
 */

// Effets structurés pour les questions LLM
export type QuestionEffect =
  | { type: 'set_travel_mode'; value: 'single_base' | 'road_trip' }
  | { type: 'add_day_trip'; destination: string }
  | { type: 'add_avoid'; name: string }
  | { type: 'adjust_scores'; category: string; delta: number }
  | { type: 'set_preference'; key: string; value: string }
  | { type: 'noop' };

export interface QuestionOption {
  id: string;
  label: string;
  subtitle?: string;
  emoji?: string;
  isDefault: boolean;
  effect?: QuestionEffect;
}

export type PipelineQuestionType =
  | 'full_day_activity' | 'day_trip' | 'activity_balance' | 'hotel_area'
  | 'pre_fetch_llm' | 'post_scoring_llm';

export interface PipelineQuestion {
  questionId: string;
  sessionId: string;
  type: PipelineQuestionType;
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
