'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowLeftRight, Star, Clock, MapPin } from 'lucide-react';
import { TripItem, TripDay } from '@/lib/types';
import { Attraction } from '@/lib/services/attractions';
import { getUnusedAttractions } from '@/lib/services/itineraryCalculator';

interface ActivitySwapButtonProps {
  item: TripItem;
  days: TripDay[];
  attractionPool: Attraction[];
  onSwap: (oldItem: TripItem, newAttraction: Attraction) => void;
}

export function ActivitySwapButton({ item, days, attractionPool, onSwap }: ActivitySwapButtonProps) {
  const [open, setOpen] = useState(false);

  // Récupérer les alternatives non utilisées, filtrées par pertinence
  const alternatives = useMemo(() => {
    const unused = getUnusedAttractions(attractionPool, days);

    // Priorité : même type d'activité, sinon toutes
    const sameType = unused.filter(a => a.type === item.type as string);
    const others = unused.filter(a => a.type !== item.type as string);

    // Combine : d'abord même type (max 5), puis autres (max 3)
    return [...sameType.slice(0, 5), ...others.slice(0, 3)];
  }, [attractionPool, days, item.type]);

  if (alternatives.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
          }}
          title="Changer cette activité"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 max-h-[350px] overflow-y-auto"
        align="end"
        side="left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-3 border-b bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground">
            Remplacer &quot;{item.title}&quot;
          </p>
        </div>
        <div className="divide-y">
          {alternatives.map((attraction) => (
            <button
              key={attraction.id}
              className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors flex gap-3 items-start"
              onClick={(e) => {
                e.stopPropagation();
                onSwap(item, attraction);
                setOpen(false);
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{attraction.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {attraction.rating > 0 && (
                    <span className="flex items-center gap-0.5 text-xs text-amber-600">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                      {attraction.rating.toFixed(1)}
                      {attraction.reviewCount ? (
                        <span className="text-muted-foreground">({attraction.reviewCount > 1000 ? `${(attraction.reviewCount / 1000).toFixed(1)}k` : attraction.reviewCount})</span>
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
                      {attraction.estimatedCost}€
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
      </PopoverContent>
    </Popover>
  );
}
