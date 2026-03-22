'use client';

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Star,
  Clock,
} from 'lucide-react';
import { TripItem, TripDay } from '@/lib/types';
import { Attraction } from '@/lib/services/attractions';
import { getUnusedAttractions } from '@/lib/services/itineraryCalculator';

interface ActivityAlternativesDialogProps {
  item: TripItem;
  days: TripDay[];
  attractionPool: Attraction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwap: (oldItem: TripItem, newAttraction: Attraction) => void;
}

export function ActivityAlternativesDialog({
  item,
  days,
  attractionPool,
  open,
  onOpenChange,
  onSwap,
}: ActivityAlternativesDialogProps) {
  const alternatives = useMemo(() => {
    const unused = getUnusedAttractions(attractionPool, days);
    const sameType = unused.filter(a => a.type === item.type as string);
    const others = unused.filter(a => a.type !== item.type as string);
    return [...sameType.slice(0, 5), ...others.slice(0, 3)];
  }, [attractionPool, days, item.type]);

  if (alternatives.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md p-0 gap-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="text-sm font-medium leading-tight">
            Remplacer{' '}
            <span className="text-muted-foreground font-normal">
              &quot;{item.title}&quot;
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[50vh] overflow-y-auto divide-y">
          {alternatives.map((attraction) => (
            <button
              key={attraction.id}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3 items-start"
              onClick={(e) => {
                e.stopPropagation();
                onSwap(item, attraction);
                onOpenChange(false);
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {attraction.name}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {attraction.rating > 0 && (
                    <span className="flex items-center gap-0.5 text-xs text-amber-600">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                      {attraction.rating.toFixed(1)}
                      {attraction.reviewCount ? (
                        <span className="text-muted-foreground">
                          (
                          {attraction.reviewCount > 1000
                            ? `${(attraction.reviewCount / 1000).toFixed(1)}k`
                            : attraction.reviewCount}
                          )
                        </span>
                      ) : null}
                    </span>
                  )}
                  {attraction.duration > 0 && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {attraction.duration >= 60
                        ? `${Math.floor(attraction.duration / 60)}h${attraction.duration % 60 > 0 ? (attraction.duration % 60).toString().padStart(2, '0') : ''}`
                        : `${attraction.duration}min`}
                    </span>
                  )}
                  {attraction.estimatedCost > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {attraction.estimatedCost}&euro;
                    </span>
                  )}
                  {attraction.estimatedCost === 0 && (
                    <span className="text-xs text-green-600 font-medium">
                      Gratuit
                    </span>
                  )}
                </div>
                {attraction.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {attraction.description}
                  </p>
                )}
              </div>
              {attraction.mustSee && (
                <span className="shrink-0 text-[10px] font-medium bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                  Top
                </span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
