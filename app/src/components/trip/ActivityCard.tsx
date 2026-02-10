'use client';

import { useState } from 'react';
import { TripItem, Flight, TRIP_ITEM_COLORS } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  MapPin,
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
  Map,
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
  activity: 'Activite',
  restaurant: 'Restaurant',
  hotel: 'Hotel',
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

/** Types that can display a thumbnail */
const IMAGE_TYPES: TripItemType[] = ['activity', 'restaurant', 'hotel', 'checkin', 'checkout'];

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
}: ActivityCardProps) {
  const Icon = TYPE_ICONS[item.type];
  const color = TRIP_ITEM_COLORS[item.type];
  const hasImage = item.imageUrl && IMAGE_TYPES.includes(item.type);
  const [imgError, setImgError] = useState(false);
  const showImage = hasImage && !imgError;

  return (
    <Card
      className={cn(
        'relative group transition-all duration-200 cursor-pointer overflow-hidden !p-0 !gap-0 rounded-xl',
        'border-transparent bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)]',
        'dark:bg-card dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)] dark:hover:shadow-[0_6px_20px_rgba(0,0,0,0.4)]',
        isSelected && 'ring-2 ring-primary/70 shadow-[0_4px_16px_rgba(212,168,83,0.12)]',
        isDragging && 'shadow-2xl scale-[1.02] rotate-[0.5deg]',
        item.type === 'free_time' && 'bg-emerald-50/20 dark:bg-emerald-950/10',
      )}
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex">
        {/* Drag handle */}
        {dragHandleProps && (
          <div
            {...dragHandleProps}
            className="flex items-center justify-center w-6 bg-muted/20 cursor-grab active:cursor-grabbing hover:bg-muted/40 transition-colors"
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
          </div>
        )}

        {/* Color accent strip */}
        <div className="w-[3px] self-stretch shrink-0 rounded-l-[inherit]" style={{ backgroundColor: color }} />

        {/* Thumbnail */}
        {showImage && (
          <div className="w-16 self-stretch shrink-0 overflow-hidden bg-muted/10">
            <img
              src={item.imageUrl}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => setImgError(true)}
            />
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 py-2.5 px-3 min-w-0">
          {/* Row 1: Time + Title */}
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[11px] tabular-nums text-muted-foreground/70 font-medium shrink-0">
              {item.startTime}
            </span>
            <h4 className="font-semibold text-[13px] leading-tight truncate">
              {item.title}
            </h4>
          </div>

          {/* Row 2: Description (1 line max) */}
          {item.description && (
            <p className="text-[11px] text-muted-foreground/70 leading-snug line-clamp-1 mb-1">
              {item.description}
            </p>
          )}
          {item.type === 'flight' && (
            <p className="text-[10px] text-muted-foreground/40 italic mb-1">
              Prix indicatif
            </p>
          )}

          {/* Row 3: Pills — location, rating, cost */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Type pill */}
            <span
              className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full text-[10px] font-medium"
              style={{ backgroundColor: `${color}10`, color }}
            >
              <Icon className="h-2.5 w-2.5" />
              {TYPE_LABELS[item.type]}
            </span>

            {item.locationName && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60 truncate max-w-[140px]">
                <MapPin className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{item.locationName}</span>
              </span>
            )}
            {item.rating && item.rating > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-500">
                <Star className="h-2.5 w-2.5 fill-current" />
                {item.rating.toFixed(1)}
              </span>
            )}
            {/* Duration */}
            {item.duration && item.duration > 0 && item.type !== 'transport' && (
              <span className="text-[10px] text-muted-foreground/50">
                {formatDuration(item.duration)}
              </span>
            )}
            {/* Cost */}
            {item.type !== 'transport' && (
              <>
                {item.estimatedCost != null && item.estimatedCost > 0 ? (
                  <span className="text-[10px] font-semibold text-primary">
                    {item.estimatedCost}€
                    {item.type !== 'flight' && item.type !== 'parking' && (
                      <span className="font-normal text-muted-foreground/50">/p.</span>
                    )}
                  </span>
                ) : item.type === 'activity' ? (
                  <span className="text-[10px] font-medium text-emerald-500">Gratuit</span>
                ) : null}
              </>
            )}
          </div>

          {/* Transit lines */}
          {item.transitInfo?.lines && item.transitInfo.lines.length > 0 && !(item.type === 'transport' && item.bookingUrl) && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {item.transitInfo.lines.map((line, idx) => {
                const ModeIcon = TRANSIT_MODE_ICONS[line.mode] || Bus;
                const bgColor = line.color || TRANSIT_MODE_COLORS[line.mode] || '#666';
                return (
                  <span
                    key={`${line.mode}-${line.number}-${idx}`}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold text-white"
                    style={{ backgroundColor: bgColor }}
                  >
                    <ModeIcon className="h-2 w-2" />
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
              className="flex items-center gap-2 mt-2 p-1.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              <img
                src={item.viatorImageUrl}
                alt=""
                className="w-10 h-10 rounded-md object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium line-clamp-1">{item.viatorTitle || item.title}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {item.viatorRating && (
                    <span className="flex items-center gap-0.5 text-[9px]">
                      <Star className="h-2 w-2 fill-amber-400 text-amber-400" />
                      {item.viatorRating.toFixed(1)}
                    </span>
                  )}
                  {(item.viatorPrice || item.estimatedCost) && (item.viatorPrice || item.estimatedCost)! > 0 && (
                    <span className="text-[9px] font-semibold text-primary">des {item.viatorPrice || item.estimatedCost}€</span>
                  )}
                </div>
              </div>
            </a>
          )}

          {/* Booking links — inline minimal */}
          <BookingButtons item={item} />
        </div>

        {/* Order number badge — right side */}
        {orderNumber !== undefined && (
          <div className="flex items-start pt-2.5 pr-2.5 shrink-0">
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {orderNumber}
            </span>
          </div>
        )}
      </div>

      {/* Flight alternatives */}
      {item.type === 'flight' && item.flightAlternatives && item.flightAlternatives.length > 0 && (
        <FlightAlternatives alternatives={item.flightAlternatives} />
      )}

      {/* Move buttons — appear on hover */}
      {onMoveUp && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <Button
            size="icon"
            variant="secondary"
            className="h-5 w-5 rounded-full shadow-md"
            disabled={!canMoveUp}
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          >
            <ChevronUp className="h-3 w-3" />
          </Button>
        </div>
      )}
      {onMoveDown && (
        <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <Button
            size="icon"
            variant="secondary"
            className="h-5 w-5 rounded-full shadow-md"
            disabled={!canMoveDown}
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Action buttons — top right hover */}
      <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10">
        {swapButton && (item.type === 'activity' || item.type === 'free_time') && swapButton}
        {onEdit && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 rounded-full bg-background/90 backdrop-blur-sm shadow-sm hover:bg-background"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
          >
            <Pencil className="h-2.5 w-2.5" />
          </Button>
        )}
        {onDelete && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 rounded-full bg-background/90 backdrop-blur-sm shadow-sm hover:bg-background text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/**
 * Booking buttons — minimal inline links
 */
function BookingButtons({ item }: { item: TripItem }) {
  const links: { label: string; url: string; icon: React.ReactNode; primary?: boolean }[] = [];
  const bookingUrl = item.bookingUrl || '';

  // Flight
  if (item.type === 'flight' && bookingUrl) {
    links.push({
      label: bookingUrl.includes('aviasales.com') ? 'Aviasales' : 'Reserver',
      url: bookingUrl,
      primary: true,
      icon: <Plane className="h-3 w-3" />,
    });
    if (item.aviasalesUrl && item.aviasalesUrl !== bookingUrl) {
      links.push({ label: 'Aviasales', url: item.aviasalesUrl, icon: <Plane className="h-3 w-3" /> });
    }
    if (item.omioFlightUrl) {
      links.push({ label: 'Omio', url: item.omioFlightUrl, icon: <Plane className="h-3 w-3" /> });
    }
  }

  // Hotel
  if ((item.type === 'hotel' || item.type === 'checkout') && bookingUrl) {
    const label = bookingUrl.includes('airbnb.com') ? 'Airbnb' : bookingUrl.includes('booking.com') ? 'Booking' : 'Reserver';
    links.push({ label, url: bookingUrl, primary: true, icon: <Bed className="h-3 w-3" /> });
  }

  // Transport
  if (item.type === 'transport' && bookingUrl) {
    const label = bookingUrl.includes('omio') || bookingUrl.includes('sjv.io') ? 'Omio'
      : bookingUrl.includes('trainline') ? 'Trainline'
      : bookingUrl.includes('flixbus') ? 'FlixBus'
      : 'Reserver';
    links.push({ label, url: bookingUrl, primary: true, icon: <TrainFront className="h-3 w-3" /> });
  }

  // Activity
  if (item.type === 'activity' && bookingUrl) {
    if (bookingUrl.includes('viator.com')) {
      links.push({ label: 'Viator', url: bookingUrl, primary: true, icon: <Ticket className="h-3 w-3" /> });
    } else {
      links.push({ label: 'Site officiel', url: bookingUrl, primary: true, icon: <Globe className="h-3 w-3" /> });
    }
  }

  // Viator alt
  if (item.viatorUrl && !bookingUrl.includes('viator.com') && !item.viatorImageUrl) {
    links.push({ label: 'Viator', url: item.viatorUrl, icon: <Ticket className="h-3 w-3" /> });
  }

  // Google Maps
  const mapsUrl = item.googleMapsPlaceUrl || item.googleMapsUrl ||
    (item.latitude && item.longitude ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : null);
  if (mapsUrl) {
    links.push({ label: 'Maps', url: mapsUrl, icon: <Map className="h-3 w-3" /> });
  }

  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-1 mt-2 flex-wrap">
      {links.map((link, i) => (
        <a
          key={`${link.label}-${i}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[10px] font-medium transition-colors',
            link.primary
              ? 'bg-primary/10 text-primary hover:bg-primary/20'
              : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/40',
          )}
        >
          {link.icon}
          {link.label}
        </a>
      ))}
    </div>
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
    <div className="mt-2 space-y-1.5 p-2 rounded-lg bg-muted/10" onClick={(e) => e.stopPropagation()}>
      {hasRealData ? (
        <div className="space-y-1">
          {legs.map((leg, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-[11px]">
              <span className="font-mono text-foreground/80 font-medium min-w-[78px]">
                {formatTime(leg.departure)} → {formatTime(leg.arrival)}
              </span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[9px] font-semibold bg-primary/8 text-primary">
                {leg.mode === 'bus' ? <Bus className="h-2.5 w-2.5" /> : <TrainFront className="h-2.5 w-2.5" />}
                {cleanLineName(leg)}
              </span>
              <span className="text-muted-foreground/50 text-[10px]">{fmtDur(leg.duration)}</span>
            </div>
          ))}
          {legs.length > 1 && (
            <div className="text-[9px] text-muted-foreground/50">
              {legs.length - 1} corresp. · {item.duration ? fmtDur(item.duration) : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
          {item.startTime && item.endTime && (
            <span>{item.startTime} → {item.endTime}</span>
          )}
          {item.duration && item.duration > 0 && <span>{fmtDur(item.duration)}</span>}
        </div>
      )}

      {!hasRealData && item.transitInfo?.lines && item.transitInfo.lines.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {item.transitInfo.lines.map((line, idx) => {
            const LineIcon = TRANSIT_MODE_ICONS[line.mode] || Bus;
            return (
              <span
                key={`${line.mode}-${line.number}-${idx}`}
                className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded-full text-[9px] font-medium bg-primary/8 text-muted-foreground"
              >
                <LineIcon className="h-2 w-2" />
                {line.number}
              </span>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between pt-0.5">
        <div>
          {item.priceRange ? (
            <span className="text-[11px]">
              <span className="font-semibold text-primary">{item.priceRange[0]}€ – {item.priceRange[1]}€</span>
              <span className="text-muted-foreground/50 ml-0.5">/p.</span>
            </span>
          ) : item.estimatedCost != null && item.estimatedCost > 0 ? (
            <span className="text-[11px]">
              <span className="font-semibold text-primary">~{item.estimatedCost}€</span>
            </span>
          ) : null}
        </div>
        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2 py-[3px] rounded-full bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 transition-colors"
        >
          <ExternalLink className="h-2.5 w-2.5" />
          {isRealTime ? 'Reserver' : `${isOmio ? 'Omio' : 'Voir'}`}
        </a>
      </div>
    </div>
  );
}

function FlightAlternatives({ alternatives }: { alternatives: Flight[] }) {
  const [expanded, setExpanded] = useState(false);
  if (alternatives.length === 0) return null;

  return (
    <div className="mx-3 mb-2 border-t border-border/30 pt-2" onClick={(e) => e.stopPropagation()}>
      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
        {alternatives.length} autre{alternatives.length > 1 ? 's' : ''} vol{alternatives.length > 1 ? 's' : ''}
      </button>
      {expanded && (
        <div className="flex gap-1.5 mt-1.5 overflow-x-auto pb-1.5 -mx-0.5 px-0.5">
          {alternatives.map((alt) => (
            <a
              key={alt.id}
              href={alt.bookingUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 rounded-lg p-2 text-[11px] hover:bg-muted/40 transition-all min-w-[120px] bg-muted/15"
            >
              <div className="font-medium text-foreground/80">{alt.airline}</div>
              <div className="text-muted-foreground/50 text-[9px]">{alt.flightNumber}</div>
              <div className="mt-1 font-mono text-[10px] text-foreground/70">
                {alt.departureTimeDisplay || alt.departureTime?.split('T')[1]?.slice(0, 5)} → {alt.arrivalTimeDisplay || alt.arrivalTime?.split('T')[1]?.slice(0, 5)}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-semibold text-primary text-[10px]">{alt.pricePerPerson || alt.price}€</span>
                <span className="text-muted-foreground/40 text-[9px]">
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
