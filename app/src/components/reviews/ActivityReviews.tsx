'use client';

import { useState } from 'react';
import { MessageSquare, Pencil, X } from 'lucide-react';
import { ReviewsSummary } from './ReviewsSummary';
import { ReviewsList } from './ReviewsList';
import { WriteReview } from './WriteReview';
import { Button } from '@/components/ui/button';
import { TripItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ActivityReviewsProps {
  item: TripItem;
  tripId?: string;
}

/**
 * Component that integrates reviews into activity cards.
 * Shows a summary badge and allows expanding to see full reviews or write a review.
 */
export function ActivityReviews({ item, tripId }: ActivityReviewsProps) {
  const [showReviews, setShowReviews] = useState(false);
  const [showWriteReview, setShowWriteReview] = useState(false);

  // Only show reviews for activities and restaurants
  if (item.type !== 'activity' && item.type !== 'restaurant') {
    return null;
  }

  // Generate place ID (normalized from title + city)
  const normalizePlace = (title: string, location: string) => {
    return `${title}-${location}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  };

  // Extract city from locationName (e.g., "Paris, France" -> "Paris")
  const city = item.locationName?.split(',')[0]?.trim() || item.locationName || '';
  const placeId = normalizePlace(item.title, city);

  return (
    <div className="mt-3 border-t border-border/40 pt-3">
      {/* Summary Badge */}
      {!showReviews && !showWriteReview && (
        <div className="flex items-center justify-between gap-2">
          <ReviewsSummary
            placeId={placeId}
            activityTitle={item.title}
            onViewReviews={() => setShowReviews(true)}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowWriteReview(true)}
            className="h-7 text-xs"
          >
            <Pencil className="h-3 w-3 mr-1" />
            Laisser un avis
          </Button>
        </div>
      )}

      {/* Expanded Reviews View */}
      {showReviews && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Avis de la communauté
            </h4>
            <div className="flex items-center gap-2">
              {!showWriteReview && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowWriteReview(true)}
                  className="h-7 text-xs"
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Écrire un avis
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowReviews(false)}
                className="h-7 w-7 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {showWriteReview && (
            <div className="mb-3">
              <WriteReview
                activityTitle={item.title}
                city={city}
                placeId={placeId}
                tripId={tripId}
                onReviewSubmitted={() => {
                  setShowWriteReview(false);
                  // Refresh reviews list
                  window.location.reload();
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowWriteReview(false)}
                className="mt-2 text-xs"
              >
                Annuler
              </Button>
            </div>
          )}

          <ReviewsList placeId={placeId} maxReviews={5} />
        </div>
      )}

      {/* Write Review View (without full list) */}
      {showWriteReview && !showReviews && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Écrire un avis</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowWriteReview(false)}
              className="h-7 w-7 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <WriteReview
            activityTitle={item.title}
            city={city}
            placeId={placeId}
            tripId={tripId}
            onReviewSubmitted={() => {
              setShowWriteReview(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
