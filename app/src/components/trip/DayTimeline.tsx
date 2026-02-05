'use client';

import { TripDay, TripItem, Accommodation } from '@/lib/types';
import { ActivityCard } from './ActivityCard';
import { HotelCarouselSelector } from './HotelCarouselSelector';
import { ItineraryConnector } from './ItineraryConnector';
import { Button } from '@/components/ui/button';
import { Plus, Calendar } from 'lucide-react';
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
 * Convertit une heure HH:MM en minutes depuis minuit, avec gestion des horaires après minuit.
 * Les heures entre 00:00 et 05:59 sont considérées comme "après minuit" (lendemain)
 * et reçoivent +1440 minutes (24h) pour être triées après les heures normales.
 */
function timeToSortableMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;

  // Si l'heure est entre 00:00 et 05:59, c'est probablement après minuit
  // On ajoute 24h (1440 minutes) pour que ça trie APRÈS les heures de la journée
  if (hours < 6) {
    return totalMinutes + 1440;
  }

  return totalMinutes;
}

export function DayTimeline({
  day,
  selectedItemId,
  globalIndexOffset = 0,
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
  // Filter out 'transport' items (transfers) - they're replaced by ItineraryConnector links
  // Then sort by startTime with special handling for after-midnight times
  const sortedItems = [...day.items]
    .sort((a, b) => timeToSortableMinutes(a.startTime) - timeToSortableMinutes(b.startTime));

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

          const isFirst = index === 0;
          const isLast = index === sortedItems.length - 1;

          return (
            <div key={item.id} className="relative group/item">
              {/* Timeline dot */}
              <div className="absolute -left-6 top-5 w-3 h-3 rounded-full bg-background border-2 border-primary" />

              <ActivityCard
                item={item}
                orderNumber={globalIndexOffset + index + 1}
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

              {/* Sélecteur d'hôtel inline après le check-in */}
              {item.type === 'checkin' && hotelSelectorData && hotelSelectorData.hotels.length > 0 && (
                <div className="mt-3 mb-1">
                  <HotelCarouselSelector
                    hotels={hotelSelectorData.hotels}
                    selectedId={hotelSelectorData.selectedId}
                    onSelect={hotelSelectorData.onSelect}
                    searchLinks={hotelSelectorData.searchLinks}
                    nights={hotelSelectorData.nights}
                  />
                </div>
              )}

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
