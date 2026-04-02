import type { Trip, TripItem } from '@/lib/types';

const BOOKABLE_ITEM_TYPES = new Set<TripItem['type']>([
  'activity',
  'restaurant',
  'transport',
  'hotel',
  'checkin',
  'checkout',
]);

export interface TripQualitySummary {
  score: number | null;
  status: 'healthy' | 'warning' | 'critical';
  contractViolationCount: number;
  qualityWarningCount: number;
  bookingCoveragePercent: number;
  bookableItemCount: number;
  itemsMissingBookingInfo: number;
  fallbackCount: number;
  lowConfidenceCount: number;
  reviewPoints: string[];
}

function hasBookingInfo(item: TripItem): boolean {
  return Boolean(
    item.bookingUrl
      || item.officialBookingUrl
      || item.googleMapsUrl
      || item.googleMapsPlaceUrl
      || item.aviasalesUrl
      || item.omioFlightUrl
      || item.hotelSearchLinks?.booking
      || item.flight?.bookingUrl
      || item.accommodation?.bookingUrl,
  );
}

function isBookableItem(item: TripItem): boolean {
  return BOOKABLE_ITEM_TYPES.has(item.type);
}

function isFallbackItem(item: TripItem): boolean {
  const qualityFlags = item.qualityFlags || [];

  return item.selectionSource === 'fallback'
    || item.dataReliability === 'estimated'
    || item.geoSource === 'city_fallback'
    || qualityFlags.some((flag) => flag.includes('fallback') || flag.includes('estimated'));
}

export function getTripQualitySummary(trip: Trip): TripQualitySummary {
  const items = trip.days.flatMap((day) => day.items);
  const contractViolationCount = trip.contractViolations?.length || 0;
  const qualityWarningCount = trip.qualityWarnings?.length || 0;
  const score = typeof trip.qualityMetrics?.score === 'number' ? trip.qualityMetrics.score : null;

  const bookableItems = items.filter(isBookableItem);
  const bookableItemCount = bookableItems.length;
  const itemsWithBookingInfo = bookableItems.filter(hasBookingInfo).length;
  const itemsMissingBookingInfo = Math.max(0, bookableItemCount - itemsWithBookingInfo);
  const bookingCoveragePercent = bookableItemCount > 0
    ? Math.round((itemsWithBookingInfo / bookableItemCount) * 100)
    : 100;

  const fallbackCount = items.filter(isFallbackItem).length;
  const lowConfidenceCount = items.filter((item) => item.geoConfidence === 'low').length;

  let status: TripQualitySummary['status'] = 'healthy';
  if (
    contractViolationCount > 0
    || (score !== null && score < 75)
    || itemsMissingBookingInfo >= 4
  ) {
    status = 'critical';
  } else if (
    qualityWarningCount > 0
    || fallbackCount > 0
    || lowConfidenceCount > 0
    || itemsMissingBookingInfo > 0
    || (score !== null && score < 85)
  ) {
    status = 'warning';
  }

  const reviewPoints: string[] = [];

  if (contractViolationCount > 0) {
    reviewPoints.push(`${contractViolationCount} violation${contractViolationCount > 1 ? 's' : ''} de contrat à corriger avant diffusion.`);
  }
  if (itemsMissingBookingInfo > 0) {
    reviewPoints.push(`${itemsMissingBookingInfo} étape${itemsMissingBookingInfo > 1 ? 's' : ''} sans lien exploitable de réservation ou de navigation.`);
  }
  if (fallbackCount > 0) {
    reviewPoints.push(`${fallbackCount} élément${fallbackCount > 1 ? 's' : ''} proviennent d'un fallback ou d'une estimation.`);
  }
  if (lowConfidenceCount > 0) {
    reviewPoints.push(`${lowConfidenceCount} point${lowConfidenceCount > 1 ? 's' : ''} ont une géolocalisation faible.`);
  }
  if (qualityWarningCount > 0) {
    reviewPoints.push(`${qualityWarningCount} avertissement${qualityWarningCount > 1 ? 's' : ''} qualité remonté${qualityWarningCount > 1 ? 's' : ''} par le pipeline.`);
  }
  if (reviewPoints.length === 0) {
    reviewPoints.push('L’itinéraire ne présente aucun signal bloquant connu sur la génération actuelle.');
  }

  return {
    score,
    status,
    contractViolationCount,
    qualityWarningCount,
    bookingCoveragePercent,
    bookableItemCount,
    itemsMissingBookingInfo,
    fallbackCount,
    lowConfidenceCount,
    reviewPoints,
  };
}
