/**
 * TransportPlan — sortie du step 4b (LLM + fallback déterministe).
 *
 * Décompose le trajet aller/retour en plusieurs legs (ex: domicile → hub →
 * destination → hôtel) avec durée et coût par leg et lien de réservation
 * approprié au mode de chaque leg.
 */
export type TransportPlanMode = 'plane' | 'train' | 'car' | 'bus';

export type LegMode =
  | 'plane'
  | 'train'
  | 'high_speed_train'
  | 'rer'
  | 'metro'
  | 'bus'
  | 'car'
  | 'taxi'
  | 'walk'
  | 'ferry';

export type HubKind = 'airport' | 'station' | 'port';

export interface TransportHub {
  name: string;
  code?: string;
  kind: HubKind;
  lat: number;
  lng: number;
  city?: string;
  country?: string;
}

export interface TransportPoint {
  name: string;
  lat: number;
  lng: number;
  hub?: TransportHub;
}

export interface TransportLeg {
  index: number;
  mode: LegMode;
  from: TransportPoint;
  to: TransportPoint;
  durationMin: number;
  costEur: number;
  provider?: string;
  reasoning?: string;
}

export interface TransportPlan {
  mode: TransportPlanMode;
  reasoning: string;
  outboundLegs: TransportLeg[];
  returnLegs: TransportLeg[];
  totalOutboundMin: number;
  totalReturnMin: number;
  totalCostEur: number;
  source: 'cache' | 'llm' | 'fallback_table' | 'fallback_places' | 'fallback_heuristic';
}

export const PLAN_MODE_TO_LEG_MODE: Record<TransportPlanMode, LegMode> = {
  plane: 'plane',
  train: 'train',
  car: 'car',
  bus: 'bus',
};

export function isHubLeg(leg: TransportLeg): boolean {
  return leg.mode === 'plane' || leg.mode === 'train' || leg.mode === 'high_speed_train' || leg.mode === 'bus' || leg.mode === 'ferry';
}

export function isTransferLeg(leg: TransportLeg): boolean {
  return leg.mode === 'rer' || leg.mode === 'metro' || leg.mode === 'taxi' || leg.mode === 'walk' || (leg.mode === 'train' && !!leg.from.hub !== !!leg.to.hub);
}
