'use client';

import { useState, useEffect } from 'react';
import { Star, MessageSquare } from 'lucide-react';
import { ReviewsAggregate } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ReviewsSummaryProps {
  placeId: string;
  activityTitle: string;
  onViewReviews?: () => void;
}

export function ReviewsSummary({ placeId, activityTitle, onViewReviews }: ReviewsSummaryProps) {
  const [aggregate, setAggregate] = useState<ReviewsAggregate | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAggregate = async () => {
      try {
        const res = await fetch(`/api/reviews/aggregate?placeId=${placeId}`);
        if (res.ok) {
          const data = await res.json();
          setAggregate(data);
        }
      } catch (e) {
        console.error('Error fetching reviews aggregate:', e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAggregate();
  }, [placeId]);

  if (isLoading || !aggregate || aggregate.totalReviews === 0) {
    return null;
  }

  const getRatingColor = (avg: number) => {
    if (avg >= 4) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
    if (avg >= 3) return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 border-amber-200 dark:border-amber-800';
    return 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 border-orange-200 dark:border-orange-800';
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all hover:shadow-sm',
        getRatingColor(aggregate.averageRating)
      )}
      onClick={onViewReviews}
    >
      {/* Rating */}
      <div className="flex items-center gap-1">
        <Star className="h-3.5 w-3.5 fill-current" />
        <span className="font-semibold">{aggregate.averageRating.toFixed(1)}</span>
      </div>

      {/* Review Count */}
      <div className="flex items-center gap-1">
        <MessageSquare className="h-3.5 w-3.5" />
        <span>
          {aggregate.totalReviews} avis
        </span>
      </div>

      {/* Top Review Excerpt (optional, only if space) */}
      {aggregate.topReview && (
        <span className="hidden sm:inline text-[11px] opacity-80 max-w-[200px] truncate">
          &ldquo;{aggregate.topReview.title}&rdquo;
        </span>
      )}
    </div>
  );
}
