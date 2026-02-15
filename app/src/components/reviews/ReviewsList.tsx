'use client';

import { useState, useEffect } from 'react';
import { Star, Loader2, Filter } from 'lucide-react';
import { ReviewCard } from './ReviewCard';
import { PlaceReview, ReviewsAggregate } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ReviewsListProps {
  placeId: string;
  maxReviews?: number;
}

type SortOption = 'recent' | 'helpful' | 'rating_high' | 'rating_low';

const SORT_LABELS: Record<SortOption, string> = {
  recent: 'Plus récents',
  helpful: 'Plus utiles',
  rating_high: 'Meilleure note',
  rating_low: 'Pire note',
};

export function ReviewsList({ placeId, maxReviews }: ReviewsListProps) {
  const [reviews, setReviews] = useState<PlaceReview[]>([]);
  const [aggregate, setAggregate] = useState<ReviewsAggregate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('helpful');
  const [filterRating, setFilterRating] = useState<number | null>(null);

  const fetchReviews = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ placeId, sortBy });
      if (filterRating) params.append('rating', filterRating.toString());

      const [reviewsRes, aggregateRes] = await Promise.all([
        fetch(`/api/reviews?${params}`),
        fetch(`/api/reviews/aggregate?placeId=${placeId}`),
      ]);

      if (reviewsRes.ok) {
        const data = await reviewsRes.json();
        setReviews(maxReviews ? data.slice(0, maxReviews) : data);
      }

      if (aggregateRes.ok) {
        const aggData = await aggregateRes.json();
        setAggregate(aggData);
      }
    } catch (e) {
      console.error('Error fetching reviews:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [placeId, sortBy, filterRating]);

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              'h-5 w-5',
              star <= Math.round(rating)
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground/30'
            )}
          />
        ))}
      </div>
    );
  };

  const getRatingColor = (avg: number) => {
    if (avg >= 4) return 'text-emerald-600 dark:text-emerald-400';
    if (avg >= 3) return 'text-amber-600 dark:text-amber-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!aggregate || aggregate.totalReviews === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground mb-2">Aucun avis pour l&apos;instant</p>
        <p className="text-sm text-muted-foreground">Soyez le premier à laisser un avis !</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Aggregate Summary */}
      <div className="bg-muted/30 rounded-lg p-4">
        <div className="flex items-start gap-4">
          {/* Average Rating */}
          <div className="text-center">
            <div className={cn('text-4xl font-bold', getRatingColor(aggregate.averageRating))}>
              {aggregate.averageRating.toFixed(1)}
            </div>
            {renderStars(aggregate.averageRating)}
            <p className="text-xs text-muted-foreground mt-1">
              {aggregate.totalReviews} avis
            </p>
          </div>

          {/* Rating Distribution */}
          <div className="flex-1 space-y-1">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = aggregate.ratingDistribution[star] || 0;
              const percentage =
                aggregate.totalReviews > 0 ? (count / aggregate.totalReviews) * 100 : 0;

              return (
                <div key={star} className="flex items-center gap-2">
                  <button
                    onClick={() => setFilterRating(filterRating === star ? null : star)}
                    className={cn(
                      'text-xs font-medium w-10 text-left hover:text-primary transition-colors',
                      filterRating === star && 'text-primary font-bold'
                    )}
                  >
                    {star} ⭐
                  </button>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Review Excerpt */}
        {aggregate.topReview && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <p className="text-xs font-medium text-muted-foreground mb-1">Avis le plus utile</p>
            <p className="text-sm font-medium">{aggregate.topReview.title}</p>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
              {aggregate.topReview.content}
            </p>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Filter className="h-3 w-3" />
          Trier par:
        </span>
        {Object.entries(SORT_LABELS).map(([key, label]) => (
          <Button
            key={key}
            variant={sortBy === key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortBy(key as SortOption)}
            className="h-7 text-xs"
          >
            {label}
          </Button>
        ))}
        {filterRating && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilterRating(null)}
            className="h-7 text-xs text-muted-foreground"
          >
            Réinitialiser filtre ✕
          </Button>
        )}
      </div>

      {/* Reviews List */}
      <div className="space-y-3">
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>

      {maxReviews && reviews.length >= maxReviews && aggregate.totalReviews > maxReviews && (
        <p className="text-center text-sm text-muted-foreground">
          Affichage de {maxReviews} sur {aggregate.totalReviews} avis
        </p>
      )}
    </div>
  );
}
