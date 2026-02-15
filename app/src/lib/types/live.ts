import type { TripItem } from './trip';

// ============================================
// Types pour le Live Trip Mode
// ============================================

export interface LiveTripState {
  isLive: boolean;
  currentDay: number;
  currentActivity: TripItem | null;
  nextActivity: TripItem | null;
  dayProgress: number; // 0-100
  timeline: LiveTimelineEvent[];
}

export interface LiveTimelineEvent {
  id: string;
  type: 'activity' | 'transport' | 'meal' | 'free_time';
  title: string;
  startTime: string;
  endTime: string;
  status: 'completed' | 'in_progress' | 'upcoming';
  activity?: TripItem;
}

export interface LiveNotification {
  id: string;
  type: 'activity_starting' | 'activity_ending' | 'transport_reminder' | 'morning_briefing';
  title: string;
  body: string;
  scheduledAt: Date;
  activityId?: string;
}
