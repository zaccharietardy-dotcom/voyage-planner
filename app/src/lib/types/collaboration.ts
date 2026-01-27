import { TripItem, TripDay, Trip } from '../types';
import { Profile } from '../supabase';

// Types de changements possibles dans une proposition
export type ChangeType =
  | 'add_activity'
  | 'remove_activity'
  | 'move_activity'
  | 'modify_activity'
  | 'change_restaurant'
  | 'change_hotel'
  | 'change_time';

// Changement proposé
export interface ProposedChange {
  id: string;
  type: ChangeType;
  dayNumber: number;
  targetId?: string; // ID de l'item à modifier/supprimer
  data: {
    // Pour add/modify
    activity?: Partial<TripItem>;
    // Pour move
    fromIndex?: number;
    toIndex?: number;
    fromDay?: number;
    toDay?: number;
    // Pour change_time
    newStartTime?: string;
    newEndTime?: string;
  };
  description: string; // Description lisible pour l'UI
}

// Statut d'une proposition
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'merged';

// Proposition complète avec auteur et votes
export interface Proposal {
  id: string;
  tripId: string;
  authorId: string;
  author: {
    displayName: string;
    avatarUrl: string | null;
  };
  title: string;
  description?: string;
  changes: ProposedChange[];
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  userVote?: boolean; // true = pour, false = contre, undefined = pas voté
  createdAt: string;
  resolvedAt?: string;
}

// Rôle d'un membre dans un voyage
export type MemberRole = 'owner' | 'editor' | 'viewer';

// Membre d'un voyage
export interface TripMember {
  id: string;
  tripId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
  profile: {
    displayName: string;
    avatarUrl: string | null;
    email: string;
  };
}

// Vote sur une proposition
export interface Vote {
  id: string;
  proposalId: string;
  userId: string;
  vote: boolean; // true = pour, false = contre
  createdAt: string;
}

// Action dans le log d'activité
export type ActivityAction =
  | 'trip_created'
  | 'trip_modified'
  | 'member_joined'
  | 'member_left'
  | 'member_role_changed'
  | 'proposal_created'
  | 'proposal_voted'
  | 'proposal_merged'
  | 'proposal_rejected';

// Entrée du log d'activité
export interface ActivityLogEntry {
  id: string;
  tripId: string;
  userId: string;
  user: {
    displayName: string;
    avatarUrl: string | null;
  };
  action: ActivityAction;
  details?: Record<string, any>;
  createdAt: string;
}

// Voyage avec toutes les données relationnelles
export interface CollaborativeTrip extends Trip {
  members: TripMember[];
  proposals: Proposal[];
  activityLog: ActivityLogEntry[];
  shareCode: string;
  userRole?: MemberRole;
}

// État du drag and drop
export interface DragState {
  activeId: string | null;
  overId: string | null;
  activeItem: TripItem | null;
}

// Résultat d'un déplacement
export interface MoveResult {
  success: boolean;
  updatedDays: TripDay[];
  description: string; // Pour créer une proposition si nécessaire
}

// Configuration pour le recalcul des horaires
export interface TimeCalculationConfig {
  defaultDurations: Record<string, number>; // en minutes
  transportBuffer: number; // minutes entre activités
  averageSpeedKmH: number; // pour estimer temps de transport
}

export const DEFAULT_TIME_CONFIG: TimeCalculationConfig = {
  defaultDurations: {
    activity: 120,      // 2h
    restaurant: 90,     // 1h30
    hotel: 30,          // check-in/out
    transport: 30,      // estimation par défaut
    flight: 180,        // 3h (avec aéroport)
    parking: 15,        // récupération voiture
    checkin: 30,
    checkout: 30,
    luggage: 30,        // consigne bagages
  },
  transportBuffer: 20,  // 20 min entre activités
  averageSpeedKmH: 25,  // vitesse moyenne en ville (mixte)
};

// Helpers pour créer des changements
export function createAddActivityChange(
  dayNumber: number,
  activity: Partial<TripItem>,
  description: string
): ProposedChange {
  return {
    id: crypto.randomUUID(),
    type: 'add_activity',
    dayNumber,
    data: { activity },
    description,
  };
}

export function createRemoveActivityChange(
  dayNumber: number,
  targetId: string,
  activityName: string
): ProposedChange {
  return {
    id: crypto.randomUUID(),
    type: 'remove_activity',
    dayNumber,
    targetId,
    data: {},
    description: `Supprimer "${activityName}"`,
  };
}

export function createMoveActivityChange(
  fromDay: number,
  toDay: number,
  fromIndex: number,
  toIndex: number,
  activityName: string
): ProposedChange {
  const sameDay = fromDay === toDay;
  return {
    id: crypto.randomUUID(),
    type: 'move_activity',
    dayNumber: toDay,
    data: { fromDay, toDay, fromIndex, toIndex },
    description: sameDay
      ? `Déplacer "${activityName}" en position ${toIndex + 1}`
      : `Déplacer "${activityName}" du jour ${fromDay} au jour ${toDay}`,
  };
}

export function createModifyActivityChange(
  dayNumber: number,
  targetId: string,
  updates: Partial<TripItem>,
  description: string
): ProposedChange {
  return {
    id: crypto.randomUUID(),
    type: 'modify_activity',
    dayNumber,
    targetId,
    data: { activity: updates },
    description,
  };
}

export function createChangeTimeChange(
  dayNumber: number,
  targetId: string,
  newStartTime: string,
  newEndTime: string,
  activityName: string
): ProposedChange {
  return {
    id: crypto.randomUUID(),
    type: 'change_time',
    dayNumber,
    targetId,
    data: { newStartTime, newEndTime },
    description: `Changer l'horaire de "${activityName}" à ${newStartTime}-${newEndTime}`,
  };
}
