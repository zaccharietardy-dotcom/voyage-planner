'use client';

import { TripDay, TripItem, Accommodation } from '@/lib/types';
import { ActivityCard } from './ActivityCard';
import { HotelCarouselSelector } from './HotelCarouselSelector';
import { ItineraryConnector } from './ItineraryConnector';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, Bed, Clock, Navigation } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { shouldShowItinerary } from '@/lib/services/itineraryValidator';
import { motion } from 'framer-motion';

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
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: NonNullable<TripItem['restaurant']>) => void;
  onSelectSelfMeal?: (item: TripItem) => void;
}

/**
 * Convertit une heure HH:MM en minutes depuis minuit, avec gestion des horaires après minuit.
 * Les heures entre 00:00 et 05:59 sont considérées comme "après minuit" (lendemain)
 * UNIQUEMENT si le jour contient aussi des items tardifs (après 22h = nightlife).
 * Sinon, ce sont des matins tôt (ex: trajet aéroport à 04:45) → tri normal.
 */
function timeToSortableMinutes(time: string, treatEarlyAsAfterMidnight: boolean = true): number {
  const [hours, minutes] = time.split(':').map(Number);
  const totalMinutes = hours * 60 + minutes;

  // Seulement si le jour a des items après 22h (nightlife), traiter 00:00-05:59 comme "après minuit"
  // Sinon, les items tôt le matin (vol à 4h45, trajet aéroport à 5h) restent en début de journée
  if (treatEarlyAsAfterMidnight && hours < 6) {
    return totalMinutes + 1440;
  }

  return totalMinutes;
}

function isHotelBoundaryTransport(item: TripItem): boolean {
  return item.type === 'transport' &&
    (item.id.startsWith('hotel-depart-') || item.id.startsWith('hotel-return-'));
}

function formatBoundaryDistance(distanceKm?: number): string | null {
  if (!distanceKm || distanceKm <= 0.05) return null;
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(1)} km`;
}

function HotelBoundaryMiniConnector({
  type,
  fromLabel,
  toLabel,
  duration,
  distance,
}: {
  type: 'depart' | 'return';
  fromLabel: string;
  toLabel: string;
  duration?: number;
  distance?: number;
}) {
  const distanceLabel = formatBoundaryDistance(distance);

  return (
    <div className="my-1 ml-2 flex items-center gap-2 rounded-xl border border-[#1e3a5f]/15 bg-gradient-to-r from-[#1e3a5f]/5 to-[#d4a853]/5 px-3 py-1.5 text-xs text-muted-foreground">
      <Bed className="h-3.5 w-3.5 shrink-0 text-[#b8923d]" />
      <span className="rounded-full bg-[#102a45]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#102a45] dark:text-[#f4d03f]">
        {type === 'depart' ? 'Aller' : 'Retour'}
      </span>
      <span className="truncate">
        {fromLabel} → {toLabel}
      </span>
      {(duration || distanceLabel) && (
        <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground/85">
          {duration ? (
            <span className="inline-flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {duration} min
            </span>
          ) : null}
          {distanceLabel ? (
            <span className="inline-flex items-center gap-0.5">
              <Navigation className="h-2.5 w-2.5" />
              {distanceLabel}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
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
  onSelectRestaurantAlternative,
  onSelectSelfMeal,
}: DayTimelineProps) {
  // Sort by startTime with smart handling for early morning vs after-midnight times
  // Déterminer si ce jour a des items de fin de soirée (après 22h = nightlife)
  // Si oui → les items 00:00-05:59 sont "après minuit" (triés après 22h)
  // Si non → les items 00:00-05:59 sont des matins tôt (ex: trajet aéroport à 4h45)
  const hasLateNightItems = day.items.some(item => {
    const [h] = item.startTime.split(':').map(Number);
    return h >= 22;
  });
  const sortedItems = [...day.items]
    .sort((a, b) => timeToSortableMinutes(a.startTime, hasLateNightItems) - timeToSortableMinutes(b.startTime, hasLateNightItems));

  const boundaryItems = sortedItems.filter(isHotelBoundaryTransport);
  const visibleItems = sortedItems.filter((item) => !isHotelBoundaryTransport(item));

  const departurePrefix = `hotel-depart-${day.dayNumber}-`;
  const returnPrefix = `hotel-return-${day.dayNumber}-`;
  const departureByTargetId = new Map<string, TripItem>();
  const returnBySourceId = new Map<string, TripItem>();

  for (const boundary of boundaryItems) {
    if (boundary.id.startsWith(departurePrefix)) {
      departureByTargetId.set(boundary.id.slice(departurePrefix.length), boundary);
    } else if (boundary.id.startsWith(returnPrefix)) {
      returnBySourceId.set(boundary.id.slice(returnPrefix.length), boundary);
    }
  }

  return (
    <div className="space-y-5">
      {/* Day header */}
      <motion.div
        className="flex items-center justify-between rounded-2xl border border-[#1e3a5f]/12 bg-background/75 p-3 backdrop-blur-sm"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold">
            {day.dayNumber}
          </div>
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              Jour {day.dayNumber}
              {day.weatherForecast && (
                <span className="text-sm font-normal text-muted-foreground" title={day.weatherForecast.condition}>
                  {day.weatherForecast.icon} {day.weatherForecast.tempMin}°/{day.weatherForecast.tempMax}°
                </span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {format(new Date(day.date), 'EEEE d MMMM', { locale: fr })}
              {day.weatherForecast && (
                <span className="ml-1 opacity-70">
                  — {day.weatherForecast.condition}
                </span>
              )}
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
      </motion.div>

      {/* Timeline */}
      <motion.div
        className="relative space-y-3 rounded-2xl border border-[#1e3a5f]/10 bg-background/65 p-3 pl-6 shadow-sm"
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              staggerChildren: 0.08,
            },
          },
        }}
      >
        {/* Vertical line */}
        <div className="absolute bottom-4 left-[11px] top-4 w-0.5 bg-border/80" />

        {visibleItems.map((item, index) => {
          const nextItem = index < visibleItems.length - 1 ? visibleItems[index + 1] : null;
          const departureBoundary = departureByTargetId.get(item.id);
          const returnBoundary = returnBySourceId.get(item.id);

          const isFirst = index === 0;
          const isLast = index === visibleItems.length - 1;

          return (
            <motion.div
              key={item.id}
              className="relative group/item"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: {
                    duration: 0.4,
                    ease: 'easeOut',
                  },
                },
              }}
            >
              {/* Timeline dot */}
              <div className="absolute -left-6 top-5 w-3 h-3 rounded-full bg-background border-2 border-primary" />

              {departureBoundary && (
                <HotelBoundaryMiniConnector
                  type="depart"
                  fromLabel="Hôtel"
                  toLabel={item.locationName || item.title}
                  duration={departureBoundary.duration}
                  distance={departureBoundary.distanceFromPrevious}
                />
              )}

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
                onSelectRestaurantAlternative={onSelectRestaurantAlternative}
                onSelectSelfMeal={onSelectSelfMeal}
              />

              {/* Sélecteur d'hôtel inline après le check-in */}
              {item.type === 'hotel' && hotelSelectorData && hotelSelectorData.hotels.length > 0 && (
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

              {returnBoundary && (
                <HotelBoundaryMiniConnector
                  type="return"
                  fromLabel={item.locationName || item.title}
                  toLabel={returnBoundary.locationName || "Hôtel"}
                  duration={returnBoundary.duration}
                  distance={returnBoundary.distanceFromPrevious}
                />
              )}
            </motion.div>
          );
        })}

        {visibleItems.length === 0 && (
          <motion.div
            className="text-center py-8 text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
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
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
