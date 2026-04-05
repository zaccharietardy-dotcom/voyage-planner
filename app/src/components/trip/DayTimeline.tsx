'use client';

import { memo, useEffect, useRef } from 'react';
import { useTranslation } from '@/lib/i18n';
import { TripDay, TripItem, Accommodation } from '@/lib/types';
import { FeedbackCard } from '@/lib/types/pipelineQuestions';
import { ActivityCard } from './ActivityCard';
import { HotelCarouselSelector } from './HotelCarouselSelector';
import { ItineraryConnector } from './ItineraryConnector';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, Bed, Clock, Navigation, Route } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { shouldShowItinerary } from '@/lib/services/itineraryValidator';
import { motion } from 'framer-motion';
import { hapticImpactLight } from '@/lib/mobile/haptics';

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
  onSwapClick?: (item: TripItem) => void;
  onEditTime?: (item: TripItem, start: string, end: string) => void;
  hotelSelectorData?: HotelSelectorData;
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: NonNullable<TripItem['restaurant']>) => void;
  onSelectSelfMeal?: (item: TripItem) => void;
  onDurationChange?: (item: TripItem, newDuration: number) => void;
  onTransportModeChange?: (item: TripItem, newMode: string) => void;
  onOptimizeDay?: (dayNumber: number) => void;
  getVoteData?: (itemId: string) => { wantCount: number; skipCount: number; userVote: 'want' | 'skip' | null };
  onVote?: (itemId: string, vote: 'want' | 'skip' | null) => void;
  feedbackCards?: FeedbackCard[];
  onSwapAlternative?: (card: FeedbackCard) => void;
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
  const { t } = useTranslation();
  const distanceLabel = formatBoundaryDistance(distance);

  return (
    <div className="my-2 ml-2 flex items-center gap-3 rounded-2xl border border-gold/20 bg-white/40 dark:bg-white/5 px-4 py-2 text-[11px] font-bold text-muted-foreground backdrop-blur-sm shadow-sm">
      <Bed className="h-4 w-4 shrink-0 text-gold" />
      <span className="rounded-lg bg-gold/10 px-2 py-0.5 text-[9px] font-bold text-gold uppercase tracking-widest border border-gold/20">
        {type === 'depart' ? t('trip.hotelOutbound') : t('trip.hotelReturn')}
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
  onSwapClick,
  onEditTime,
  hotelSelectorData,
  onSelectRestaurantAlternative,
  onSelectSelfMeal,
  onDurationChange,
  onTransportModeChange,
  onOptimizeDay,
  getVoteData,
  onVote,
  feedbackCards,
  onSwapAlternative,
}: DayTimelineProps) {
  const { t } = useTranslation();
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
    <div ref={timelineRef} className="space-y-4">
      {/* Day header */}
      <motion.div
        className="flex items-center justify-between rounded-[2.5rem] border border-white/5 bg-black/40 p-5 backdrop-blur-3xl shadow-[0_15px_35px_rgba(0,0,0,0.3)]"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 rounded-[1.5rem] bg-gold-gradient flex items-center justify-center text-black font-black text-2xl shadow-[0_10px_20px_rgba(197,160,89,0.3)] border border-white/20">
            {day.dayNumber}
          </div>
          <div>
            <h3 className="font-black text-2xl text-white tracking-tight flex items-center gap-3">
              Jour {day.dayNumber}
              {day.weatherForecast && (
                <span className="text-xs font-black text-gold bg-gold/10 px-3 py-1 rounded-full border border-gold/20 uppercase tracking-widest">
                  {day.weatherForecast.icon} {day.weatherForecast.tempMax}\u00b0
                </span>
              )}
            </h3>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60 flex items-center gap-2 mt-1.5">
              <Calendar className="h-3.5 w-3.5 text-gold" />
              {format(new Date(day.date), 'EEEE d MMMM', { locale: fr })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {onAddItem && (
            <Button
              size="icon"
              className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 text-gold hover:bg-white/10 shadow-inner"
              onClick={() => { hapticImpactLight(); onAddItem(day.dayNumber); }}
            >
              <Plus className="h-6 w-6" />
            </Button>
          )}
        </div>
      </motion.div>

      {/* Timeline Container */}
      <motion.div
        className="relative space-y-1"
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: {
              staggerChildren: 0.05,
            },
          },
        }}
      >
        {/* Animated vertical filament line */}
        <motion.div 
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 1, ease: "easeInOut" }}
          className="absolute left-[18px] top-12 bottom-12 w-[1px] bg-gradient-to-b from-gold/60 via-gold/10 to-transparent origin-top" 
        />

        {visibleItems.map((item, index) => {
          const nextItem = index < visibleItems.length - 1 ? visibleItems[index + 1] : null;
          const departureBoundary = departureByTargetId.get(item.id);
          const returnBoundary = returnBySourceId.get(item.id);

          const isFirst = index === 0;
          const isLast = index === visibleItems.length - 1;
          const altCard = feedbackCards?.find(c => c.targetItemId === item.id);

          return (
            <motion.div
              key={item.id}
              data-item-id={item.id}
              className="relative pl-10"
              variants={{
                hidden: { opacity: 0, x: -4, scale: 0.99 },
                visible: {
                  opacity: 1,
                  x: 0,
                  scale: 1,
                  transition: {
                    duration: 0.4,
                    ease: [0.22, 1, 0.36, 1],
                  },
                },
              }}
            >
              {/* Point de connexion (Timeline Dot) */}
              <div className="absolute left-[13px] top-8 w-3 h-3 rounded-full bg-gold shadow-[0_0_15px_rgba(197,160,89,0.5)] border-[3px] border-black z-10" />

              {departureBoundary && (
                <div className="mb-4 -ml-2">
                  <HotelBoundaryMiniConnector
                    type="depart"
                    fromLabel={t('trip.hotel')}
                    toLabel={item.locationName || item.title}
                    duration={departureBoundary.duration}
                    distance={departureBoundary.distanceFromPrevious}
                  />
                </div>
              )}

              <ActivityCard
                item={item}
                alternative={altCard}
                onSwapAlternative={onSwapAlternative}
                orderNumber={mapNumbers?.get(item.id) ?? (globalIndexOffset + index + 1)}
                isSelected={selectedItemId === item.id}
                onSelect={() => { hapticImpactLight(); onSelectItem?.(item); }}
                onEdit={() => onEditItem?.(item)}
                onDelete={() => onDeleteItem?.(item)}
                onMoveUp={showMoveButtons && onMoveItem ? () => onMoveItem(item, 'up') : undefined}
                onMoveDown={showMoveButtons && onMoveItem ? () => onMoveItem(item, 'down') : undefined}
                canMoveUp={!isFirst}
                canMoveDown={!isLast}
                onMouseEnter={() => onHoverItem?.(item.id)}
                onMouseLeave={() => onHoverItem?.(null)}
                onSwapClick={onSwapClick ? () => onSwapClick(item) : undefined}
                onEditTime={onEditTime}
                onSelectRestaurantAlternative={onSelectRestaurantAlternative}
                onSelectSelfMeal={onSelectSelfMeal}
                onDurationChange={onDurationChange}
                voteData={getVoteData ? getVoteData(item.id) : undefined}
                onVote={onVote ? (vote) => onVote(item.id, vote) : undefined}
              />

              {/* Sélecteur d'hôtel inline après le check-in */}
              {(item.type === 'hotel' || item.type === 'checkin') && hotelSelectorData && hotelSelectorData.hotels.length > 0 && (
                <div className="mt-4 mb-2">
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
              {nextItem && shouldShowItinerary(item, nextItem) && (
                <div className="my-1">
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
                </div>
              )}

              {returnBoundary && (
                <div className="mt-4 -ml-2">
                  <HotelBoundaryMiniConnector
                    type="return"
                    fromLabel={item.locationName || item.title}
                    toLabel={returnBoundary.locationName || t('trip.hotel')}
                    duration={returnBoundary.duration}
                    distance={returnBoundary.distanceFromPrevious}
                  />
                </div>
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
            <p>{t('trip.noActivity')}</p>
            {onAddItem && (
              <Button
                variant="link"
                className="mt-2"
                onClick={() => onAddItem(day.dayNumber)}
              >
                {t('trip.addActivity')}
              </Button>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
});
