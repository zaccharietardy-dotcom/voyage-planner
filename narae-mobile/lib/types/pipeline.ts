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

export interface PipelineProgressEvent {
  type: 'step_start' | 'step_done' | 'api_call' | 'api_done' | 'info' | 'warning' | 'error';
  step?: number;
  stepName?: string;
  label?: string;
  durationMs?: number;
  detail?: string;
}

export type PipelineMapMarkerKind =
  | 'origin'
  | 'destination'
  | 'activity'
  | 'hotel'
  | 'restaurant'
  | 'day_trip';

export interface PipelineMapCoordinate {
  latitude: number;
  longitude: number;
}

export interface PipelineMapMarker extends PipelineMapCoordinate {
  id: string;
  title: string;
  kind: PipelineMapMarkerKind;
  dayNumber?: number;
  score?: number;
}

export interface PipelineMapPolyline {
  id: string;
  kind: 'day_route';
  dayNumber?: number;
  coordinates: PipelineMapCoordinate[];
}

export interface PipelineMapSnapshot {
  stage: 'fetched' | 'clustered';
  center: PipelineMapCoordinate;
  markers: PipelineMapMarker[];
  polylines?: PipelineMapPolyline[];
}
