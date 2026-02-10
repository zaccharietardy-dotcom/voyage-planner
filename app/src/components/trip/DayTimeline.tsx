'use client';

import { TripDay, TripItem, Accommodation } from '@/lib/types';
import { ActivityCard } from './ActivityCard';
import { HotelCarouselSelector } from './HotelCarouselSelector';
import { ItineraryConnector } from './ItineraryConnector';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { shouldShowItinerary } from '@/lib/services/itineraryValidator';

export interface HotelSelectorData {
  hotels: Accommodation[];
  selectedId: string;
  onSelect: (hotelId: string) => void;
  searchLinks?: {
    googleHotels?: string;
    booking?: string;
    airbnb?: string;
  };
  nights: number;
}

interface DayTimelineProps {
  day: TripDay;
  selectedItemId?: string;
  globalIndexOffset?: number;
  mapNumbers?: Map<string, number>;
  onSelectItem?: (item: TripItem) => void;
  onEditItem?: (item: TripItem) => void;
  onDeleteItem?: (item: TripItem) => void;
  onAddItem?: (dayNumber: number) => void;
  onMoveItem?: (item: TripItem, direction: 'up' | 'down') => void;
  onHoverItem?: (itemId: string | null) => void;
  showMoveButtons?: boolean;
  renderSwapButton?: (item: TripItem) => React.ReactNode;
  hotelSelectorData?: HotelSelectorData;
}

/**
 * Convertit une heure HH:MM en minutes depuis minuit, avec gestion des horaires apres minuit.
 */
function timeToSortableMinutes(time: string, treatEarlyAsAfterMidnight: boolean = true): number {
  const [hours, minutes] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;

  if (treatEarlyAsAfterMidnight && hours < 6) {
    return totalMinutes + 1440;
  }

  return totalMinutes;
}

export function DayTimeline({
  day,
  selectedItemId,
  globalIndexOffset = 0,
  mapNumbers,
  onSelectItem,
  onEditItem,
  onDeleteItem,
  onAddItem,
  onMoveItem,
  onHoverItem,
  showMoveButtons = false,
  renderSwapButton,
  hotelSelectorData,
}: DayTimelineProps) {
  const hasLateNightItems = day.items.some(item => {
    const [h] = item.startTime.split(':').map(Number);
    return h >= 22;
  });
  const sortedItems = [...day.items]
    .sort((a, b) => timeToSortableMinutes(a.startTime, hasLateNightItems) - timeToSortableMinutes(b.startTime, hasLateNightItems));

  const formattedDate = format(new Date(day.date), 'EEEE d MMMM', { locale: fr });
  // Capitalize first letter
  const displayDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);

  return (
    <div className="space-y-3">
      {/* Day header — minimal, Apple-style */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold tracking-tight text-foreground">
            J{day.dayNumber}
          </span>
          <span className="text-sm text-muted-foreground/60 font-medium">
            {displayDate}
          </span>
        </div>
        {onAddItem && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground/50 hover:text-foreground h-7 px-2 rounded-full"
            onClick={() => onAddItem(day.dayNumber)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-xs">Ajouter</span>
          </Button>
        )}
      </div>

      {/* Activities list — clean, no heavy timeline line */}
      <div className="space-y-1.5">
        {sortedItems.map((item, index) => {
          const nextItem = index < sortedItems.length - 1 ? sortedItems[index + 1] : null;
          const isFirst = index === 0;
          const isLast = index === sortedItems.length - 1;

          return (
            <div key={item.id}>
              <ActivityCard
                item={item}
                orderNumber={mapNumbers?.get(item.id) ?? (globalIndexOffset + index + 1)}
                isSelected={selectedItemId === item.id}
                onSelect={() => onSelectItem?.(item)}
                onEdit={() => onEditItem?.(item)}
                onDelete={() => onDeleteItem?.(item)}
                onMoveUp={showMoveButtons && onMoveItem ? () => onMoveItem(item, 'up') : undefined}
                onMoveDown={showMoveButtons && onMoveItem ? () => onMoveItem(item, 'down') : undefined}
                canMoveUp={!isFirst}
                canMoveDown={!isLast}
                onMouseEnter={() => onHoverItem?.(item.id)}
                onMouseLeave={() => onHoverItem?.(null)}
                swapButton={renderSwapButton?.(item)}
              />

              {/* Hotel selector after check-in */}
              {item.type === 'hotel' && hotelSelectorData && hotelSelectorData.hotels.length > 0 && (
                <div className="mt-2 mb-1">
                  <HotelCarouselSelector
                    hotels={hotelSelectorData.hotels}
                    selectedId={hotelSelectorData.selectedId}
                    onSelect={hotelSelectorData.onSelect}
                    searchLinks={hotelSelectorData.searchLinks}
                    nights={hotelSelectorData.nights}
                  />
                </div>
              )}

              {/* Itinerary connector */}
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
          <div className="text-center py-10 text-muted-foreground/40">
            <p className="text-sm">Aucune activite pour ce jour</p>
            {onAddItem && (
              <Button
                variant="link"
                className="mt-1 text-primary/60 hover:text-primary"
                onClick={() => onAddItem(day.dayNumber)}
              >
                Ajouter une activite
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
