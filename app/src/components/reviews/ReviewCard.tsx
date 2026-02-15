'use client';

import { useState } from 'react';
import { Star, ThumbsUp, MapPin, Calendar, ShieldCheck, ImageIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PlaceReview } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

interface ReviewCardProps {
  review: PlaceReview;
  onHelpfulClick?: (reviewId: string) => void;
  isHelpfulByUser?: boolean;
}

export function ReviewCard({ review, onHelpfulClick, isHelpfulByUser }: ReviewCardProps) {
  const [localHelpfulCount, setLocalHelpfulCount] = useState(review.helpfulCount);
  const [localIsHelpful, setLocalIsHelpful] = useState(isHelpfulByUser || false);
  const [processing, setProcessing] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);

  const handleHelpful = async () => {
    if (processing) return;
    setProcessing(true);

    try {
      const res = await fetch(`/api/reviews/${review.id}/helpful`, {
        method: 'POST',
      });

      if (res.ok) {
        const data = await res.json();
        setLocalHelpfulCount(data.count);
        setLocalIsHelpful(data.helpful);
        onHelpfulClick?.(review.id);
      } else {
        toast.error('Erreur lors du vote');
      }
    } catch {
      toast.error('Erreur réseau');
    } finally {
      setProcessing(false);
    }
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={cn(
              'h-4 w-4',
              star <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
            )}
          />
        ))}
      </div>
    );
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={review.userAvatar || undefined} />
          <AvatarFallback className="text-sm">
            {review.userName[0]?.toUpperCase() || 'V'}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          {/* Header: User + Rating */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{review.userName}</span>
              {review.isVerifiedVisit && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded-full text-[10px] font-medium">
                  <ShieldCheck className="h-3 w-3" />
                  Visite vérifiée
                </span>
              )}
            </div>
            {renderStars(review.rating)}
          </div>

          {/* Date & Location */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDistanceToNow(new Date(review.createdAt), {
                addSuffix: true,
                locale: fr,
              })}
            </span>
            {review.visitDate && (
              <span>
                Visité le {new Date(review.visitDate).toLocaleDateString('fr-FR')}
              </span>
            )}
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {review.city}
            </span>
          </div>

          {/* Title */}
          <h4 className="font-semibold text-sm mb-1.5">{review.title}</h4>

          {/* Content */}
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap mb-2">
            {review.content}
          </p>

          {/* Tips */}
          {review.tips && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30 rounded-lg p-3 mb-2">
              <p className="text-xs font-medium text-blue-900 dark:text-blue-300 mb-1">
                💡 Conseils
              </p>
              <p className="text-xs text-blue-800 dark:text-blue-200 leading-relaxed">
                {review.tips}
              </p>
            </div>
          )}

          {/* Photos */}
          {review.photos && review.photos.length > 0 && (
            <div className="mb-2">
              <button
                onClick={() => setShowPhotos(!showPhotos)}
                className="flex items-center gap-1 text-xs text-primary hover:underline mb-1"
              >
                <ImageIcon className="h-3 w-3" />
                {review.photos.length} photo{review.photos.length > 1 ? 's' : ''}
              </button>
              {showPhotos && (
                <div className="flex gap-2 flex-wrap">
                  {review.photos.map((photo, idx) => (
                    <img
                      key={idx}
                      src={photo}
                      alt={`Photo ${idx + 1}`}
                      className="w-20 h-20 object-cover rounded-md"
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Helpful button */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            <Button
              variant={localIsHelpful ? 'default' : 'ghost'}
              size="sm"
              onClick={handleHelpful}
              disabled={processing}
              className="h-7 text-xs"
            >
              <ThumbsUp className={cn('h-3 w-3 mr-1', localIsHelpful && 'fill-current')} />
              Utile {localHelpfulCount > 0 && `(${localHelpfulCount})`}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
