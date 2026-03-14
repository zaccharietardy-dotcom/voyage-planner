import type { TripItem, TripDay } from './trip';

// ============================================
// Types pour le Chatbot de modification
// ============================================

export type ModificationIntentType =
  | 'shift_times'      // Décaler les horaires (me lever plus tard)
  | 'swap_activity'    // Remplacer une activité par une autre
  | 'add_activity'     // Ajouter une nouvelle activité
  | 'remove_activity'  // Supprimer une activité
  | 'extend_free_time' // Plus de temps libre
  | 'reorder_day'      // Réorganiser l'ordre des activités
  | 'change_restaurant'// Changer un restaurant
  | 'adjust_duration'  // Modifier la durée d'une activité
  | 'add_day'          // Ajouter un jour au voyage
  | 'report_issue'     // Signaler un problème (activité fermée, météo, etc.)
  | 'change_pace'      // Changer l'intensité d'un jour (plus relax ou plus intense)
  | 'swap_category'    // Remplacer une activité par une catégorie différente
  | 'rebalance'        // Redistribuer les activités entre les jours
  | 'clarification'    // Besoin de clarification
  | 'general_question';// Question générale (pas de modification)

export interface ModificationIntent {
  type: ModificationIntentType;
  confidence: number; // 0-1
  parameters: {
    dayNumbers?: number[];      // Jours concernés
    targetActivity?: string;    // Activité ciblée (nom ou id)
    targetItemId?: string;      // ID de l'item ciblé
    newValue?: string;          // Nouvelle valeur/activité
    timeShift?: number;         // Décalage en minutes
    direction?: 'later' | 'earlier'; // Direction du décalage
    scope?: 'morning_only' | 'afternoon_only' | 'full_day'; // Portée du décalage temporel
    mealType?: 'breakfast' | 'lunch' | 'dinner'; // Type de repas si restaurant
    cuisineType?: string;       // Type de cuisine demandée
    duration?: number;          // Durée souhaitée en minutes
    insertAfterDay?: number;    // Insérer un jour APRÈS ce numéro de jour
    issueType?: 'closed' | 'weather' | 'unavailable' | 'schedule_change'; // Type de problème signalé
    paceDirection?: 'relax' | 'intense'; // Direction pour change_pace
    newCategory?: string; // Catégorie souhaitée pour swap_category (outdoor, culture, etc.)
  };
  explanation: string; // Explication de ce que l'utilisateur veut
}

export type TripChangeType = 'add' | 'remove' | 'update' | 'move';

export interface TripChange {
  type: TripChangeType;
  dayNumber: number;
  itemId?: string;
  before?: Partial<TripItem>;
  after?: Partial<TripItem>;
  newItem?: TripItem; // Pour les ajouts
  description: string;
}

export interface ModificationResult {
  success: boolean;
  changes: TripChange[];
  explanation: string;      // Réponse conversationnelle
  warnings: string[];       // Avertissements (conflits potentiels)
  newDays: TripDay[];       // Nouvel état des jours après modification
  rollbackData: TripDay[];  // État avant modification (pour undo)
  errorInfo?: ChatErrorInfo; // Info d'erreur structurée (quand success === false)
}

export interface ChatMessage {
  id: string;
  tripId: string;
  userId?: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: ModificationIntent | null;
  changesApplied?: TripChange[] | null;
  errorInfo?: ChatErrorInfo | null;
  createdAt: Date;
}

export interface ChatResponse {
  reply: string;
  intent: ModificationIntent | null;
  changes: TripChange[] | null;
  previewDays: TripDay[] | null;
  requiresConfirmation: boolean;
  warnings: string[];
  suggestions?: ContextualSuggestion[];
  errorInfo?: ChatErrorInfo;
}

// ============================================
// Suggestions contextuelles
// ============================================

export interface ContextualSuggestion {
  label: string;    // Texte court affiché sur le chip
  prompt: string;   // Message complet envoyé au chatbot
  icon?: string;    // Emoji optionnel pour le chip
}

// ============================================
// Mémoire conversationnelle
// ============================================

export interface ConversationContext {
  recentExchanges: Array<{
    userMessage: string;
    assistantReply: string;
    intent?: string;
  }>;
}

// ============================================
// Erreurs structurées
// ============================================

export type ChatErrorType =
  | 'schedule_conflict'
  | 'budget_exceeded'
  | 'immutable_item'
  | 'item_not_found'
  | 'no_slot_available'
  | 'constraint_violation'
  | 'unknown';

export interface ChatErrorInfo {
  type: ChatErrorType;
  message: string;
  alternativeSuggestion?: ContextualSuggestion;
}

export interface TripConstraint {
  itemId: string;
  type: 'immutable' | 'time_locked' | 'booking_required';
  reason: string;
}

export const SUGGESTED_CHAT_PROMPTS = [
  { label: 'Me lever plus tard', prompt: 'Je veux me lever plus tard le matin' },
  { label: 'Plus de temps libre', prompt: "J'aimerais plus de temps libre l'après-midi" },
  { label: 'Changer un restaurant', prompt: 'Change le restaurant du ' },
  { label: 'Ajouter une activité', prompt: 'Ajoute ' },
  { label: 'Supprimer une visite', prompt: 'Supprime ' },
  { label: 'Réorganiser la journée', prompt: 'Réorganise le jour ' },
  { label: 'Ajouter un jour', prompt: 'Ajoute un jour libre entre le jour ' },
  { label: 'Rendre plus relax', prompt: 'Rends cette journée plus relax' },
  { label: "Plus d'outdoor", prompt: "Remplace une activité par quelque chose d'outdoor" },
  { label: 'Mieux répartir', prompt: 'Répartis mieux les activités entre les jours' },
] as const;
