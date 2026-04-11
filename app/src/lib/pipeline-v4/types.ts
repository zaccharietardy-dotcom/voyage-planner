/**
 * Pipeline V4 — LLM-First Types
 *
 * The LLM designs the trip. The pipeline validates facts.
 */

// ---------------------------------------------------------------------------
// LLM Trip Designer output (Step 1)
// ---------------------------------------------------------------------------

export interface LLMTripItem {
  type: 'activity' | 'restaurant' | 'bar';
  name: string;
  address?: string;
  startTime: string; // "HH:mm"
  duration: number;  // minutes
  estimatedCost?: number;
  tip?: string;
  mealType?: 'breakfast' | 'lunch' | 'dinner';
}

export interface LLMTripDrive {
  from: string;
  to: string;
  distanceKm: number;
  durationMin: number;
}

export interface LLMTripDay {
  day: number;
  hub: string;
  theme: string;
  narrative: string;
  items: LLMTripItem[];
  drives: LLMTripDrive[];
}

export interface LLMTripHub {
  day: number;
  city: string;
  sleepHere: boolean;
}

export interface LLMTripDesign {
  hubs: LLMTripHub[];
  days: LLMTripDay[];
}

// ---------------------------------------------------------------------------
// Validation output (Step 2)
// ---------------------------------------------------------------------------

export type ValidationSource =
  | 'google_places'
  | 'serpapi'
  | 'nominatim'
  | 'fallback_replacement'
  | 'unverified';

export interface ValidatedItem {
  /** Original LLM item */
  original: LLMTripItem;
  /** Day number this item belongs to */
  dayNumber: number;
  /** Whether the item was found in APIs */
  validated: boolean;
  /** Resolved GPS coordinates */
  coords: { lat: number; lng: number };
  /** Real Google rating (not LLM-estimated) */
  rating?: number;
  reviewCount?: number;
  /** Photo URLs from Google Places */
  photos?: string[];
  /** Real opening hours from Google Places */
  openingHours?: { open: string; close: string };
  openingHoursByDay?: Record<string, { open: string; close: string } | null>;
  website?: string;
  priceLevel?: number;
  googlePlaceId?: string;
  /** Google Maps URL */
  googleMapsUrl?: string;
  /** How the item was validated */
  source: ValidationSource;
  /** If the original wasn't found, what replaced it */
  replacedWith?: string;
  /** Full Restaurant object if type is restaurant/bar */
  restaurant?: import('../types').Restaurant;
  /** Alternative restaurants for meal diversity */
  restaurantAlternatives?: import('../types').Restaurant[];
}

// ---------------------------------------------------------------------------
// Validated drive (Step 2 — OSRM)
// ---------------------------------------------------------------------------

export interface ValidatedDrive {
  original: LLMTripDrive;
  dayNumber: number;
  fromCoords: { lat: number; lng: number };
  toCoords: { lat: number; lng: number };
  /** Real duration from OSRM (minutes) */
  realDurationMin: number;
  /** Real distance from OSRM (km) */
  realDistanceKm: number;
  /** Encoded polyline for map rendering */
  polyline?: string;
  /** Google Maps directions URL */
  googleMapsUrl?: string;
}

// ---------------------------------------------------------------------------
// Hotel result (Step 3)
// ---------------------------------------------------------------------------

export interface HubHotelResult {
  hub: LLMTripHub;
  hotel: import('../types').Accommodation | null;
  alternatives: import('../types').Accommodation[];
  source: 'booking' | 'airbnb' | 'fallback';
}

// ---------------------------------------------------------------------------
// V4 Pipeline result (before Trip conversion)
// ---------------------------------------------------------------------------

export interface V4PipelineResult {
  design: LLMTripDesign;
  validatedItems: ValidatedItem[];
  validatedDrives: ValidatedDrive[];
  hotels: HubHotelResult[];
  groundingStats: {
    totalItems: number;
    validatedCount: number;
    replacedCount: number;
    unverifiedCount: number;
    groundingRate: number;
  };
  latencyMs: {
    llmDesign: number;
    validation: number;
    hotels: number;
    buildTrip: number;
    total: number;
  };
}
