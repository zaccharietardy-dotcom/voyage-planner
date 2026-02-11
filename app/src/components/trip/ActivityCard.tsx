'use client';

import { useState } from 'react';
import { TripItem, Flight, Restaurant, TRIP_ITEM_COLORS } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  MapPin,
  Clock,
  Utensils,
  Bed,
  Bus,
  Pencil,
  Trash2,
  GripVertical,
  Plane,
  ParkingCircle,
  LogIn,
  LogOut,
  ExternalLink,
  Star,
  Navigation,
  Map as MapIcon,
  TrainFront,
  TramFront,
  Ship,
  Briefcase,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Coffee,
  Ticket,
  Globe,
  ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TripItemType } from '@/lib/types';

interface ActivityCardProps {
  item: TripItem;
  orderNumber?: number;
  isSelected?: boolean;
  isDragging?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  swapButton?: React.ReactNode;
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: Restaurant) => void;
  onSelectSelfMeal?: (item: TripItem) => void;
}

const TYPE_ICONS: Record<TripItemType, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  activity: MapPin,
  restaurant: Utensils,
  hotel: Bed,
  transport: Bus,
  flight: Plane,
  parking: ParkingCircle,
  checkin: LogIn,
  checkout: LogOut,
  luggage: Briefcase,
  free_time: Coffee,
};

const TYPE_LABELS: Record<TripItemType, string> = {
  activity: 'Activité',
  restaurant: 'Restaurant',
  hotel: 'Hébergement',
  transport: 'Transport',
  flight: 'Vol',
  parking: 'Parking',
  checkin: 'Check-in',
  checkout: 'Check-out',
  luggage: 'Consigne',
  free_time: 'Temps libre',
};

const TRANSIT_MODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bus: Bus,
  metro: TrainFront,
  train: TrainFront,
  tram: TramFront,
  ferry: Ship,
};

const TRANSIT_MODE_COLORS: Record<string, string> = {
  bus: '#0074D9',
  metro: '#FF4136',
  train: '#2ECC40',
  tram: '#FF851B',
  ferry: '#39CCCC',
};

/** Types that can display a hero image */
const IMAGE_TYPES: TripItemType[] = ['activity', 'restaurant', 'hotel', 'checkin', 'checkout', 'flight', 'transport'];

/** Gradient backgrounds per type (used when no image available) — dark, muted tones */
const TYPE_GRADIENTS: Record<string, string> = {
  activity: 'from-slate-700 to-slate-900',
  restaurant: 'from-stone-700 to-stone-900',
  hotel: 'from-slate-600 to-slate-800',
  checkin: 'from-slate-600 to-slate-800',
  checkout: 'from-slate-600 to-slate-800',
  flight: 'from-slate-700 to-slate-900',
  transport: 'from-slate-700 to-slate-900',
};

export function ActivityCard({
  item,
  orderNumber,
  isSelected,
  isDragging,
  onSelect,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  onMouseEnter,
  onMouseLeave,
  dragHandleProps,
  swapButton,
  onSelectRestaurantAlternative,
  onSelectSelfMeal,
}: ActivityCardProps) {
  const Icon = TYPE_ICONS[item.type];
  const color = TRIP_ITEM_COLORS[item.type];
  const hasImage = item.imageUrl && IMAGE_TYPES.includes(item.type);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const showImage = hasImage && !imgError;
  const isHeroType = IMAGE_TYPES.includes(item.type);
  // Hero cards always use the "image" style (white text, overlay) — either with a real image or a gradient fallback
  const useHeroStyle = isHeroType;

  return (
    <Card
      className={cn(
        'relative group transition-all duration-200 cursor-pointer overflow-hidden',
        'border-border/60 hover:border-primary/40 hover:shadow-lg',
        isSelected && 'ring-2 ring-primary/80 border-primary shadow-lg',
        isDragging && 'shadow-xl rotate-1 scale-[1.03]',
        item.type === 'free_time' && 'bg-emerald-50/40 border-emerald-200/50 dark:bg-emerald-950/15 dark:border-emerald-800/30',
      )}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Background: gradient base (always visible) + image on top with fade-in */}
      {isHeroType && (
        <>
          {/* Gradient is always rendered as the base layer / loading placeholder */}
          <div className={cn("absolute inset-0 bg-gradient-to-br", TYPE_GRADIENTS[item.type] || 'from-gray-600/90 to-gray-800/95')} />
          {!showImage && <Icon className="absolute right-3 bottom-3 h-16 w-16 text-white/10" />}

          {/* Image fades in over the gradient once loaded */}
          {showImage && (
            <>
              <img
                src={item.imageUrl}
                alt={item.title}
                className={cn(
                  "absolute inset-0 w-full h-full object-cover transition-opacity duration-500",
                  imgLoaded ? "opacity-100" : "opacity-0"
                )}
                loading="lazy"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
              {/* Dark gradient overlay for text readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/30" />
            </>
          )}
        </>
      )}

      <div className={cn("flex", useHeroStyle ? "relative z-10" : "")}>
        {/* Drag handle */}
        {dragHandleProps && (
          <div
            {...dragHandleProps}
            className={cn(
              "flex items-center justify-center w-7 cursor-grab active:cursor-grabbing transition-colors",
              useHeroStyle ? "hover:bg-white/10" : "bg-muted/30 hover:bg-muted/60"
            )}
          >
            <GripVertical className={cn("h-3.5 w-3.5", useHeroStyle ? "text-white/60" : "text-muted-foreground/60")} />
          </div>
        )}

        {/* Color accent stripe + order number (non-hero types only: transport, flight, etc.) */}
        {!isHeroType && (
          orderNumber !== undefined ? (
            <div
              className="w-9 self-stretch flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${color}10` }}
            >
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm"
                style={{ backgroundColor: color }}
              >
                {orderNumber}
              </span>
            </div>
          ) : (
            <div className="w-1 self-stretch rounded-l-md" style={{ backgroundColor: color }} />
          )
        )}

        {/* Content */}
        <div className={cn("flex-1 min-w-0", useHeroStyle ? "p-4" : "p-3.5")}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {/* Time row */}
              <div className={cn("flex items-center gap-2", useHeroStyle ? "mb-2" : "mb-1")}>
                {/* Order number badge (inline on hero cards) */}
                {useHeroStyle && orderNumber !== undefined && (
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md shrink-0 bg-white/20"
                  >
                    {orderNumber}
                  </span>
                )}
                <span className={cn(
                  "inline-flex items-center gap-1 font-medium",
                  useHeroStyle ? "text-sm text-white/90" : "text-xs text-muted-foreground"
                )}>
                  <Clock className={cn(useHeroStyle ? "h-3.5 w-3.5" : "h-3 w-3")} />
                  {item.startTime} – {item.endTime}
                </span>
                {/* Type badge */}
                <span
                  className={cn(
                    "font-semibold leading-none rounded",
                    useHeroStyle ? "px-2 py-1 text-xs bg-white/20 text-white/90" : "px-1.5 py-0.5 text-[10px]"
                  )}
                  style={!useHeroStyle ? { backgroundColor: `${color}12`, color } : undefined}
                >
                  {TYPE_LABELS[item.type]}
                </span>
              </div>

              {/* Title */}
              <h4 className={cn(
                "font-semibold leading-snug mb-0 line-clamp-2",
                useHeroStyle ? "text-base text-white drop-shadow-md" : "text-[13px]"
              )}>
                {item.title}
              </h4>

              {/* Description */}
              {item.description && (
                <p className={cn(
                  "leading-relaxed line-clamp-2 mb-1.5",
                  useHeroStyle ? "text-sm text-white/70" : "text-xs text-muted-foreground"
                )}>
                  {item.description}
                </p>
              )}
              {/* Meta row: rating, cost */}
              <div className={cn(
                "flex items-center gap-2.5 flex-wrap",
                useHeroStyle ? "text-sm text-white/80 mt-1" : "text-xs text-muted-foreground"
              )}>
                {item.rating && item.rating > 0 && (
                  <span className="inline-flex items-center gap-0.5 font-medium">
                    <Star className={cn(useHeroStyle ? "h-3.5 w-3.5" : "h-3 w-3", "fill-amber-400 text-amber-400")} />
                    {item.rating.toFixed(1)}
                  </span>
                )}
                {item.timeFromPrevious && item.timeFromPrevious > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Navigation className={cn(useHeroStyle ? "h-3.5 w-3.5" : "h-3 w-3")} />
                    {item.timeFromPrevious} min
                    {item.distanceFromPrevious && item.distanceFromPrevious > 0.1 && (
                      <span className={useHeroStyle ? "text-white/50" : "text-muted-foreground/60"}>({item.distanceFromPrevious.toFixed(1)} km)</span>
                    )}
                  </span>
                )}
                {/* Cost */}
                {item.type !== 'transport' && (
                  <>
                    {item.estimatedCost != null && item.estimatedCost > 0 ? (
                      <span className={cn("font-semibold", useHeroStyle ? "text-white" : "text-primary")}>
                        ~{item.estimatedCost}€
                        {item.type !== 'parking' && (
                          <span className={cn("font-normal", useHeroStyle ? "text-white/60" : "text-muted-foreground")}> / pers.</span>
                        )}
                      </span>
                    ) : item.type === 'activity' ? (
                      <span className={cn("font-medium", useHeroStyle ? "text-emerald-300" : "text-emerald-600 dark:text-emerald-400")}>Gratuit</span>
                    ) : null}
                  </>
                )}
              </div>

              {/* Transit lines */}
              {item.transitInfo?.lines && item.transitInfo.lines.length > 0 && !(item.type === 'transport' && item.bookingUrl) && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {item.transitInfo.lines.map((line, idx) => {
                    const ModeIcon = TRANSIT_MODE_ICONS[line.mode] || Bus;
                    const bgColor = line.color || TRANSIT_MODE_COLORS[line.mode] || '#666';
                    return (
                      <span
                        key={`${line.mode}-${line.number}-${idx}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: bgColor }}
                      >
                        <ModeIcon className="h-2.5 w-2.5" />
                        {line.number}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Transport card */}
              {item.type === 'transport' && item.bookingUrl && (
                <TransportCard item={item} />
              )}

              {/* Viator product card */}
              {item.viatorImageUrl && (item.bookingUrl?.includes('viator.com') || item.viatorUrl) && (
                <a
                  href={item.viatorUrl || item.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-2.5 mt-2.5 p-2 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors"
                >
                  <img
                    src={item.viatorImageUrl}
                    alt={item.viatorTitle || item.title}
                    className="w-12 h-12 rounded-md object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium line-clamp-2 leading-snug">{item.viatorTitle || item.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.viatorRating && (
                        <span className="flex items-center gap-0.5 text-[10px]">
                          <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                          {item.viatorRating.toFixed(1)}
                          {item.viatorReviewCount && <span className="text-muted-foreground">({item.viatorReviewCount})</span>}
                        </span>
                      )}
                      {item.viatorDuration && item.viatorDuration > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDuration(item.viatorDuration)}
                        </span>
                      )}
                      {(item.viatorPrice || item.estimatedCost) && (item.viatorPrice || item.estimatedCost)! > 0 && (
                        <span className="text-[10px] font-semibold text-primary">dès {item.viatorPrice || item.estimatedCost}€</span>
                      )}
                    </div>
                  </div>
                </a>
              )}

              {/* Booking buttons — clean pill style */}
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                <BookingButtons item={item} />
              </div>
            </div>

            {/* Type icon (non-hero types only) */}
            {!isHeroType && (
              <div
                className="p-2 rounded-lg shrink-0"
                style={{ backgroundColor: `${color}10` }}
              >
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
            )}
          </div>

          {/* Flight alternatives */}
          {item.type === 'flight' && item.flightAlternatives && item.flightAlternatives.length > 0 && (
            <FlightAlternatives alternatives={item.flightAlternatives} />
          )}

          {/* Restaurant top-3 suggestions */}
          {item.type === 'restaurant' && item.restaurant && item.restaurantAlternatives && item.restaurantAlternatives.length > 0 && (
            <RestaurantSuggestions
              item={item}
              onSelectRestaurantAlternative={onSelectRestaurantAlternative}
              onSelectSelfMeal={onSelectSelfMeal}
            />
          )}
        </div>
      </div>

      {/* Move buttons */}
      {onMoveUp && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7 rounded-full shadow-md"
            disabled={!canMoveUp}
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            title="Déplacer vers le haut"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
        </div>
      )}
      {onMoveDown && (
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7 rounded-full shadow-md"
            disabled={!canMoveDown}
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            title="Déplacer vers le bas"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Action buttons (swap/edit/delete) */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10">
        {swapButton && (item.type === 'activity' || item.type === 'free_time') && swapButton}
        {onEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 bg-background/80 backdrop-blur-sm hover:bg-background"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
        {onDelete && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 bg-background/80 backdrop-blur-sm hover:bg-background text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/**
 * Booking buttons — Clean, subtle style with branded accents
 */
function BookingButtons({ item }: { item: TripItem }) {
  const buttons: { label: string; url: string; variant: 'primary' | 'secondary' | 'ghost'; icon: React.ReactNode }[] = [];
  const bookingUrl = item.bookingUrl || '';

  // Flight
  if (item.type === 'flight' && bookingUrl) {
    buttons.push({
      label: bookingUrl.includes('aviasales.com') ? 'Aviasales' : 'Réserver vol',
      url: bookingUrl,
      variant: 'primary',
      icon: <Plane className="h-3 w-3" />,
    });
    if (item.aviasalesUrl && item.aviasalesUrl !== bookingUrl) {
      buttons.push({ label: 'Aviasales', url: item.aviasalesUrl, variant: 'secondary', icon: <Plane className="h-3 w-3" /> });
    }
    if (item.omioFlightUrl) {
      buttons.push({ label: 'Omio', url: item.omioFlightUrl, variant: 'secondary', icon: <Plane className="h-3 w-3" /> });
    }
  }

  // Hotel
  if ((item.type === 'hotel' || item.type === 'checkin' || item.type === 'checkout') && bookingUrl) {
    const label = bookingUrl.includes('airbnb.com') ? 'Airbnb' : bookingUrl.includes('booking.com') ? 'Booking' : 'Réserver';
    buttons.push({ label, url: bookingUrl, variant: 'primary', icon: <Bed className="h-3 w-3" /> });
  }

  // Transport
  if (item.type === 'transport' && bookingUrl) {
    const label = bookingUrl.includes('omio') || bookingUrl.includes('sjv.io') ? 'Omio'
      : bookingUrl.includes('trainline') ? 'Trainline'
      : bookingUrl.includes('flixbus') ? 'FlixBus'
      : 'Réserver';
    buttons.push({ label, url: bookingUrl, variant: 'primary', icon: <TrainFront className="h-3 w-3" /> });
  }

  // Activity
  if (item.type === 'activity' && bookingUrl) {
    if (bookingUrl.includes('viator.com')) {
      buttons.push({ label: 'Viator', url: bookingUrl, variant: 'primary', icon: <Ticket className="h-3 w-3" /> });
    } else {
      buttons.push({ label: 'Site officiel', url: bookingUrl, variant: 'primary', icon: <Globe className="h-3 w-3" /> });
    }
  }

  // Viator alt
  if (item.viatorUrl && !bookingUrl.includes('viator.com') && !item.viatorImageUrl) {
    buttons.push({ label: 'Viator', url: item.viatorUrl, variant: 'secondary', icon: <Ticket className="h-3 w-3" /> });
  }

  // Google Maps
  const mapsUrl = item.googleMapsPlaceUrl || item.googleMapsUrl ||
    (item.latitude && item.longitude ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : null);
  if (mapsUrl) {
    buttons.push({ label: 'Maps', url: mapsUrl, variant: 'ghost', icon: <MapIcon className="h-3 w-3" /> });
  }

  if (buttons.length === 0) return null;

  return (
    <>
      {buttons.map((btn, i) => (
        <a
          key={`${btn.label}-${i}`}
          href={btn.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
            btn.variant === 'primary' && 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm',
            btn.variant === 'secondary' && 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border/50',
            btn.variant === 'ghost' && 'text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-transparent hover:border-border/40',
          )}
        >
          {btn.icon}
          {btn.label}
        </a>
      ))}
    </>
  );
}

function TransportCard({ item }: { item: TripItem }) {
  if (item.type !== 'transport' || !item.bookingUrl) return null;

  const bookingUrl = item.bookingUrl;
  const isOmio = bookingUrl.includes('omio') || bookingUrl.includes('sjv.io');
  const legs = item.transitLegs;
  const hasRealData = legs && legs.length > 0;
  const isRealTime = item.transitDataSource === 'api';

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const fmtDur = (min: number) => {
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
    }
    return `${min}min`;
  };

  const cleanLineName = (leg: { line?: string; operator?: string }) => {
    const raw = leg.line || leg.operator || 'Train';
    if (raw.includes('->') || /^[A-Z]{3,}[0-9]*$/.test(raw)) return leg.operator || 'Train';
    return raw;
  };

  return (
    <div className="mt-2.5 space-y-2 p-2.5 rounded-lg bg-muted/20 border border-border/40" onClick={(e) => e.stopPropagation()}>
      {hasRealData ? (
        <div className="space-y-1.5">
          {legs.map((leg, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-primary font-semibold min-w-[90px]">
                {formatTime(leg.departure)} → {formatTime(leg.arrival)}
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-primary/20 bg-primary/5 font-medium">
                {leg.mode === 'bus' ? <Bus className="h-2.5 w-2.5 text-primary" /> : <TrainFront className="h-2.5 w-2.5 text-primary" />}
                {cleanLineName(leg)}
              </span>
              <span className="text-muted-foreground">{fmtDur(leg.duration)}</span>
              {idx < legs.length - 1 && (
                <span className="text-[10px] text-primary/50 ml-auto">↓ corresp.</span>
              )}
            </div>
          ))}
          {legs.length > 1 && (
            <div className="text-[10px] text-muted-foreground">
              {legs.length - 1} correspondance{legs.length > 2 ? 's' : ''} · ~{item.duration ? fmtDur(item.duration) : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {item.startTime && item.endTime && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {item.startTime} → {item.endTime}
            </span>
          )}
          {item.duration && item.duration > 0 && <span>~{fmtDur(item.duration)}</span>}
        </div>
      )}

      {!hasRealData && item.transitInfo?.lines && item.transitInfo.lines.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.transitInfo.lines.map((line, idx) => {
            const LineIcon = TRANSIT_MODE_ICONS[line.mode] || Bus;
            return (
              <span
                key={`${line.mode}-${line.number}-${idx}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-primary/20 bg-primary/5 text-muted-foreground"
              >
                <LineIcon className="h-2.5 w-2.5" />
                {line.number}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <div>
          {item.priceRange ? (
            <span className="text-xs">
              <span className="font-semibold text-primary">{item.priceRange[0]}€ – {item.priceRange[1]}€</span>
              <span className="text-muted-foreground ml-1">/ pers.</span>
            </span>
          ) : item.estimatedCost != null && item.estimatedCost > 0 ? (
            <span className="text-xs">
              <span className="font-semibold text-primary">~{item.estimatedCost}€</span>
              <span className="text-muted-foreground ml-1">(estimé)</span>
            </span>
          ) : null}
        </div>
        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity"
        >
          <ExternalLink className="h-3 w-3" />
          {isRealTime ? 'Réserver' : `Voir sur ${isOmio ? 'Omio' : 'le site'}`}
        </a>
      </div>
    </div>
  );
}

function FlightAlternatives({ alternatives }: { alternatives: Flight[] }) {
  const [expanded, setExpanded] = useState(false);
  if (alternatives.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border/40 pt-2.5" onClick={(e) => e.stopPropagation()}>
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        {alternatives.length} autre{alternatives.length > 1 ? 's' : ''} vol{alternatives.length > 1 ? 's' : ''}
      </button>
      {expanded && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-2 -mx-1 px-1">
          {alternatives.map((alt) => (
            <a
              key={alt.id}
              href={alt.bookingUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 border border-border/50 rounded-lg p-2.5 text-xs hover:border-primary/40 hover:shadow-sm transition-all min-w-[140px] bg-card"
            >
              <div className="font-medium">{alt.airline}</div>
              <div className="text-muted-foreground text-[10px]">{alt.flightNumber}</div>
              <div className="mt-1.5 font-mono text-[11px]">
                {alt.departureTimeDisplay || alt.departureTime?.split('T')[1]?.slice(0, 5)} → {alt.arrivalTimeDisplay || alt.arrivalTime?.split('T')[1]?.slice(0, 5)}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="font-semibold text-primary">{alt.pricePerPerson || alt.price}€</span>
                <span className="text-muted-foreground text-[10px]">
                  {formatDuration(alt.duration)} · {alt.stops === 0 ? 'Direct' : `${alt.stops} esc.`}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function RestaurantSuggestions({
  item,
  onSelectRestaurantAlternative,
  onSelectSelfMeal,
}: {
  item: TripItem;
  onSelectRestaurantAlternative?: (item: TripItem, restaurant: Restaurant) => void;
  onSelectSelfMeal?: (item: TripItem) => void;
}) {
  const current = item.restaurant;
  if (!current) return null;

  const uniqueById = new Map<string, Restaurant>();
  [current, ...(item.restaurantAlternatives || [])].forEach((r) => {
    if (r?.id) uniqueById.set(r.id, r);
  });
  const rankRestaurant = (r: Restaurant): number => {
    const ratingScore = (r.rating || 0) * 22;
    const reviewScore = Math.min(Math.log10((r.reviewCount || 0) + 1) * 10, 25);
    const distancePenalty = Math.min((r.distance || 0) * 12, 28);
    const fallbackPenalty = r.latitude === 0 || r.longitude === 0 ? 6 : 0;
    return ratingScore + reviewScore - distancePenalty - fallbackPenalty;
  };

  const suggestions = Array.from(uniqueById.values())
    .sort((a, b) => rankRestaurant(b) - rankRestaurant(a))
    .slice(0, 3);
  if (suggestions.length <= 1) return null;

  const getCuisineLabel = (r: Restaurant): string => {
    const raw = r.cuisineTypes?.[0] || 'Cuisine locale';
    return raw
      .replace(/^restaurant\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Cuisine locale';
  };

  const getRestaurantImage = (r: Restaurant): string => {
    const candidate = r.photos?.[0];
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
    return `https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=500&fit=crop&q=80&auto=format`;
  };

  return (
    <div className="mt-3 border-t border-border/40 pt-2.5" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-medium text-muted-foreground mb-2">Top 3 restaurants suggérés</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {suggestions.map((option) => {
          const isSelected = option.id === current.id;
          const bookingUrl = option.reservationUrl || option.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(option.name)}`;
          const imageUrl = getRestaurantImage(option);

          return (
            <div
              key={option.id}
              className={cn(
                "relative overflow-hidden rounded-xl border p-2.5 min-h-[170px]",
                isSelected ? "border-primary/60 shadow-sm" : "border-border/50"
              )}
            >
              <img
                src={imageUrl}
                alt={option.name}
                className="absolute inset-0 h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/25" />
              <div className="relative z-10 text-white">
                <div className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm">
                  {getCuisineLabel(option)}
                </div>
                <div className="font-semibold text-sm mt-1.5 line-clamp-2">{option.name}</div>
              </div>
              <div className="relative z-10 flex items-center justify-between mt-2 text-[10px] text-white/90">
                {option.rating > 0 ? <span className="font-semibold text-primary">⭐ {option.rating.toFixed(1)}</span> : <span />}
                {option.distance != null && (
                  <span>
                    {option.distance < 1 ? `${Math.round(option.distance * 1000)}m` : `${option.distance.toFixed(1)}km`}
                  </span>
                )}
              </div>
              <div className="relative z-10 flex items-center gap-1.5 mt-2">
                {isSelected ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/25 text-emerald-200 text-[10px] font-medium">
                    Sélectionné
                  </span>
                ) : (
                  <button
                    className="inline-flex items-center px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:opacity-90"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRestaurantAlternative?.(item, option);
                    }}
                  >
                    Choisir
                  </button>
                )}
                <a
                  href={bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-2 py-0.5 rounded border border-white/40 text-[10px] text-white/90 hover:text-white"
                  onClick={(e) => e.stopPropagation()}
                >
                  Voir
                </a>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onSelectSelfMeal?.(item);
          }}
        >
          Manger par ses moyens (pique-nique / maison / libre)
        </button>
      </div>
    </div>
  );
}
