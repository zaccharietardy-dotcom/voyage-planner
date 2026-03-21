'use client';

import { memo, useEffect, useRef } from 'react';
import { TripDay, TripItem, Accommodation } from '@/lib/types';
import { ActivityCard } from './ActivityCard';
import { HotelCarouselSelector } from './HotelCarouselSelector';
import { ItineraryConnector } from './ItineraryConnector';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, Bed, Clock, Navigation, Route } from 'lucide-react';
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
  onDurationChange?: (item: TripItem, newDuration: number) => void;
  onTransportModeChange?: (item: TripItem, newMode: string) => void;
  onOptimizeDay?: (dayNumber: number) => void;
  getVoteData?: (itemId: string) => { wantCount: number; skipCount: number; userVote: 'want' | 'skip' | null };
  onVote?: (itemId: string, vote: 'want' | 'skip' | null) => void;
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

function isInterItemTransport(item: TripItem): boolean {
  return item.type === 'transport' && item.id.startsWith('travel-');
}

/** Parse transport mode from travel item title (e.g. "Marche — 2.4km" → "walk") */
function parseTravelMode(title: string): 'walk' | 'car' | 'public' | 'taxi' | undefined {
  const lower = (title || '').toLowerCase();
  if (lower.startsWith('marche') || lower.includes('à pied')) return 'walk';
  if (lower.includes('transport en commun') || lower.includes('métro') || lower.includes('bus') || lower.includes('tram')) return 'public';
  if (lower.includes('voiture') || lower.includes('trajet')) return 'car';
  return undefined;
}

/** Parse distance in km from travel item title (e.g. "Marche — 2.4km" → 2.4) */
function parseTravelDistance(title: string): number | undefined {
  const kmMatch = title.match(/([\d.]+)\s*km/i);
  if (kmMatch) return parseFloat(kmMatch[1]);
  const mMatch = title.match(/([\d]+)\s*m\b/i);
  if (mMatch) return parseInt(mMatch[1], 10) / 1000;
  return undefined;
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
    <div className="my-2 ml-2 flex items-center gap-3 rounded-2xl border border-gold/20 bg-white/40 dark:bg-white/5 px-4 py-2 text-[11px] font-bold text-muted-foreground backdrop-blur-sm shadow-sm">
      <Bed className="h-4 w-4 shrink-0 text-gold" />
      <span className="rounded-lg bg-gold/10 px-2 py-0.5 text-[9px] font-bold text-gold uppercase tracking-widest border border-gold/20">
        {type === 'depart' ? 'Aller' : 'Retour'}
      </span>
      <span className="truncate text-foreground/80">
        {fromLabel} → {toLabel}
      </span>
      {(duration || distanceLabel) && (
        <span className="ml-auto inline-flex shrink-0 items-center gap-3 text-[10px] font-bold uppercase tracking-wider opacity-60">
          {duration ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-gold" />
              {duration} min
            </span>
          ) : null}
          {distanceLabel ? (
            <span className="inline-flex items-center gap-1">
              <Navigation className="h-3 w-3 text-gold" />
              {distanceLabel}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
}

export const DayTimeline = memo(function DayTimeline({
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
  onDurationChange,
  onTransportModeChange,
  onOptimizeDay,
  getVoteData,
  onVote,
}: DayTimelineProps) {
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedItemId || !timelineRef.current) return;
    const el = timelineRef.current.querySelector(`[data-item-id="${selectedItemId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedItemId]);

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

  // Propagate travel data from travel-* items to the next visible item,
  // so ItineraryConnector renders with proper info instead of full cards
  const nonBoundaryItems = sortedItems.filter((item) => !isHotelBoundaryTransport(item));
  for (let i = 0; i < nonBoundaryItems.length; i++) {
    const item = nonBoundaryItems[i];
    if (isInterItemTransport(item)) {
      // Find next non-travel item and propagate travel data to it
      const nextVisible = nonBoundaryItems.slice(i + 1).find(it => !isInterItemTransport(it));
      if (nextVisible) {
        nextVisible.timeFromPrevious = item.duration;
        nextVisible.distanceFromPrevious = parseTravelDistance(item.title);
        nextVisible.transportToPrevious = parseTravelMode(item.title);
      }
    }
  }
  const visibleItems = nonBoundaryItems.filter((item) => !isInterItemTransport(item));

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
    <div ref={timelineRef} className="space-y-5">
      {/* Day header */}
      <motion.div
        className="flex items-center justify-between rounded-3xl border border-gold/20 bg-white/80 dark:bg-[#020617]/80 p-4 backdrop-blur-xl shadow-xl shadow-gold/5"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gold-gradient flex items-center justify-center text-white font-display font-bold text-xl shadow-lg shadow-gold/20">
            {day.dayNumber}
          </div>
          <div>
            <h3 className="font-display text-xl font-bold flex items-center gap-3">
              Jour {day.dayNumber}
              {day.weatherForecast && (
                <span className="text-sm font-medium text-gold bg-gold/10 px-2 py-0.5 rounded-full" title={day.weatherForecast.condition}>
                  {day.weatherForecast.icon} {day.weatherForecast.tempMin}\u00b0/{day.weatherForecast.tempMax}\u00b0
                </span>
              )}
            </h3>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-2 mt-1">
              <Calendar className="h-3.5 w-3.5 text-gold" />
              {format(new Date(day.date), 'EEEE d MMMM', { locale: fr })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onOptimizeDay && (
            <Button
              variant="outline"
              size="sm"
              className="h-10 rounded-xl border-gold/20 bg-white/50 dark:bg-white/5 hover:bg-gold/5 hover:border-gold/50 transition-all font-bold text-[10px] uppercase tracking-widest gap-2"
              onClick={() => onOptimizeDay(day.dayNumber)}
            >
              <Route className="h-4 w-4 text-gold" />
              Optimiser
            </Button>
          )}
          {onAddItem && (
            <Button
              size="sm"
              className="h-10 rounded-xl bg-gold text-white hover:bg-gold-dark transition-all font-bold text-[10px] uppercase tracking-widest gap-2 shadow-lg shadow-gold/20"
              onClick={() => onAddItem(day.dayNumber)}
            >
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          )}
        </div>
      </motion.div>

      {/* Timeline */}
      <motion.div
        className="relative space-y-4 rounded-[2.5rem] border border-gold/10 bg-white/30 dark:bg-white/5 p-6 pl-10 shadow-sm backdrop-blur-sm"
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              staggerChildren: 0.1,
            },
          },
        }}
      >
        {/* Vertical line with gold gradient */}
        <div className="absolute bottom-10 left-[19px] top-10 w-[2px] bg-gradient-to-b from-gold via-gold/30 to-gold/10" />

        {visibleItems.map((item, index) => {
          const nextItem = index < visibleItems.length - 1 ? visibleItems[index + 1] : null;
          const departureBoundary = departureByTargetId.get(item.id);
          const returnBoundary = returnBySourceId.get(item.id);

          const isFirst = index === 0;
          const isLast = index === visibleItems.length - 1;

          return (
            <motion.div
              key={item.id}
              data-item-id={item.id}
              className="relative"
              variants={{
                hidden: { opacity: 0, x: -10 },
                visible: {
                  opacity: 1,
                  x: 0,
                  transition: {
                    duration: 0.5,
                    ease: [0.22, 1, 0.36, 1],
                  },
                },
              }}
            >
              {/* Timeline dot - Gold Outer, White Inner */}
              <div className="absolute -left-[28px] top-7 w-4 h-4 rounded-full bg-gold flex items-center justify-center shadow-lg shadow-gold/30 border-2 border-white dark:border-[#020617] z-10">
                <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-[#020617]" />
              </div>

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
                onDurationChange={onDurationChange}
                voteData={getVoteData ? getVoteData(item.id) : undefined}
                onVote={onVote ? (vote) => onVote(item.id, vote) : undefined}
              />

              {/* Sélecteur d'hôtel inline après le check-in */}
              {(item.type === 'hotel' || item.type === 'checkin') && hotelSelectorData && hotelSelectorData.hotels.length > 0 && (
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
                  transitLines={nextItem.transitInfo?.lines}
                  isEditable={!!onTransportModeChange}
                  onModeChange={onTransportModeChange ? (newMode) => onTransportModeChange(nextItem, newMode) : undefined}
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
});
