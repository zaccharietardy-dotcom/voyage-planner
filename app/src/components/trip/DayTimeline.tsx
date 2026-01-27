'use client';

import { TripDay, TripItem } from '@/lib/types';
import { ActivityCard } from './ActivityCard';
import { ItineraryConnector } from './ItineraryConnector';
import { Button } from '@/components/ui/button';
import { Plus, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { shouldShowItinerary } from '@/lib/services/itineraryValidator';

interface DayTimelineProps {
  day: TripDay;
  selectedItemId?: string;
  onSelectItem?: (item: TripItem) => void;
  onEditItem?: (item: TripItem) => void;
  onDeleteItem?: (item: TripItem) => void;
  onAddItem?: (dayNumber: number) => void;
}

export function DayTimeline({
  day,
  selectedItemId,
  onSelectItem,
  onEditItem,
  onDeleteItem,
  onAddItem,
}: DayTimelineProps) {
  // Filter out 'transport' items (transfers) - they're replaced by ItineraryConnector links
  const filteredItems = day.items.filter(item => item.type !== 'transport');

  const sortedItems = [...filteredItems].sort((a, b) => {
    // Sort by start time
    return a.startTime.localeCompare(b.startTime);
  });

  return (
    <div className="space-y-4">
      {/* Day header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">
            {day.dayNumber}
          </div>
          <div>
            <h3 className="font-semibold">Jour {day.dayNumber}</h3>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {format(new Date(day.date), 'EEEE d MMMM', { locale: fr })}
            </p>
          </div>
        </div>
        {onAddItem && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => onAddItem(day.dayNumber)}
          >
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        )}
      </div>

      {/* Timeline */}
      <div className="relative pl-6 space-y-3">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-border" />

        {sortedItems.map((item, index) => {
          const nextItem = index < sortedItems.length - 1 ? sortedItems[index + 1] : null;

          return (
            <div key={item.id} className="relative">
              {/* Timeline dot */}
              <div className="absolute -left-6 top-5 w-3 h-3 rounded-full bg-background border-2 border-primary" />

              <ActivityCard
                item={item}
                isSelected={selectedItemId === item.id}
                onSelect={() => onSelectItem?.(item)}
                onEdit={() => onEditItem?.(item)}
                onDelete={() => onDeleteItem?.(item)}
              />

              {/* Connecteur d'itinéraire vers l'activité suivante */}
              {/* FILTRE: N'afficher que les itinéraires pratiques (pas check-in→vol, vol, etc.) */}
              {nextItem && shouldShowItinerary(item, nextItem) && (
                <ItineraryConnector
                  from={{
                    name: item.locationName || item.title,
                    latitude: item.latitude,
                    longitude: item.longitude,
                  }}
                  to={{
                    name: nextItem.locationName || nextItem.title,
                    latitude: nextItem.latitude,
                    longitude: nextItem.longitude,
                  }}
                  duration={nextItem.timeFromPrevious}
                  distance={nextItem.distanceFromPrevious}
                  mode={nextItem.transportToPrevious}
                />
              )}
            </div>
          );
        })}

        {sortedItems.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p>Aucune activité pour ce jour</p>
            {onAddItem && (
              <Button
                variant="link"
                className="mt-2"
                onClick={() => onAddItem(day.dayNumber)}
              >
                Ajouter une activité
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
