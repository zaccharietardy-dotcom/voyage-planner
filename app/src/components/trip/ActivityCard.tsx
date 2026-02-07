'use client';

import { useState } from 'react';
import { TripItem, Flight, TRIP_ITEM_COLORS } from '@/lib/types';
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
  Map,
  TrainFront,
  TramFront,
  Ship,
  Briefcase,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Search,
  ArrowRight,
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
  swapButton?: React.ReactNode; // Bouton swap avec alternatives du pool
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
  luggage: 'Consigne bagages',
};

// Icônes pour les modes de transport
const TRANSIT_MODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  bus: Bus,
  metro: TrainFront,
  train: TrainFront,
  tram: TramFront,
  ferry: Ship,
};

// Couleurs par défaut si non fournies
const TRANSIT_MODE_COLORS: Record<string, string> = {
  bus: '#0074D9',
  metro: '#FF4136',
  train: '#2ECC40',
  tram: '#FF851B',
  ferry: '#39CCCC',
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
}: ActivityCardProps) {
  const Icon = TYPE_ICONS[item.type];
  const color = TRIP_ITEM_COLORS[item.type];

  return (
    <Card
      className={cn(
        'relative group transition-all cursor-pointer',
        'hover:shadow-md hover:border-primary/50',
        isSelected && 'ring-2 ring-primary border-primary',
        isDragging && 'shadow-lg rotate-1 scale-105'
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
            className="flex items-center justify-center w-8 bg-muted/50 cursor-grab active:cursor-grabbing hover:bg-muted"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        {/* Order number indicator */}
        {orderNumber !== undefined ? (
          <div
            className="w-8 self-stretch flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${color}15` }}
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {orderNumber}
            </span>
          </div>
        ) : (
          <div className="w-1 self-stretch" style={{ backgroundColor: color }} />
        )}

        {/* Activity image */}
        {item.imageUrl && item.type === 'activity' && (
          <div className="w-20 self-stretch shrink-0 overflow-hidden">
            <img
              src={item.imageUrl}
              alt={item.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Time + type */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                <Clock className="h-3 w-3" />
                <span>
                  {item.startTime} - {item.endTime}
                </span>
                <span
                  className="px-1.5 py-0 rounded-full text-[10px] font-medium"
                  style={{ backgroundColor: `${color}20`, color }}
                >
                  {TYPE_LABELS[item.type]}
                </span>
              </div>

              {/* Title */}
              <h4 className="font-semibold text-sm mb-0.5 truncate">{item.title}</h4>

              {/* Description */}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {item.description}
              </p>
              {item.type === 'flight' && (
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 italic">
                  Prix indicatif — cliquez pour voir les tarifs actuels
                </p>
              )}

              {/* Location */}
              {item.locationName && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span className="truncate">{item.locationName}</span>
                </div>
              )}

              {/* Additional info row */}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {/* Rating */}
                {item.rating && (
                  <div className="flex items-center gap-1 text-xs">
                    <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                    <span className="font-medium">{item.rating.toFixed(1)}</span>
                  </div>
                )}

                {/* Distance from previous */}
                {item.timeFromPrevious && item.timeFromPrevious > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Navigation className="h-3 w-3" />
                    <span>{item.timeFromPrevious} min</span>
                    {item.distanceFromPrevious && item.distanceFromPrevious > 0.1 && (
                      <span>({item.distanceFromPrevious.toFixed(1)} km)</span>
                    )}
                  </div>
                )}

                {/* Cost (masqué pour transport car affiché dans TransportCard) */}
                {item.estimatedCost && item.estimatedCost > 0 && item.type !== 'transport' && (
                  <div className="text-xs">
                    <span className="font-medium text-primary">
                      ~{item.estimatedCost}€
                    </span>
                    {item.type !== 'flight' && item.type !== 'parking' && (
                      <span className="text-muted-foreground"> / pers.</span>
                    )}
                  </div>
                )}
              </div>

              {/* Transit lines (masqué pour transport avec bookingUrl car affiché dans TransportCard) */}
              {item.transitInfo?.lines && item.transitInfo.lines.length > 0 && !(item.type === 'transport' && item.bookingUrl) && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {item.transitInfo.lines.map((line, idx) => {
                    const ModeIcon = TRANSIT_MODE_ICONS[line.mode] || Bus;
                    const bgColor = line.color || TRANSIT_MODE_COLORS[line.mode] || '#666';
                    return (
                      <span
                        key={`${line.mode}-${line.number}-${idx}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: bgColor }}
                      >
                        <ModeIcon className="h-3 w-3" />
                        {line.number}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Transport card - mini-widget Omio */}
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
                  className="flex items-center gap-2.5 mt-2 p-2 rounded-lg border bg-muted/30 hover:bg-muted/60 transition-colors"
                >
                  <img
                    src={item.viatorImageUrl}
                    alt={item.viatorTitle || item.title}
                    className="w-14 h-14 rounded-md object-cover shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium line-clamp-2">{item.viatorTitle || item.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.viatorRating && (
                        <span className="flex items-center gap-0.5 text-[10px]">
                          <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                          {item.viatorRating.toFixed(1)}
                          {item.viatorReviewCount && <span className="text-muted-foreground">({item.viatorReviewCount})</span>}
                        </span>
                      )}
                      {(item.viatorPrice || item.estimatedCost) && (item.viatorPrice || item.estimatedCost)! > 0 && (
                        <span className="text-[10px] font-medium text-green-600">dès {item.viatorPrice || item.estimatedCost}€</span>
                      )}
                    </div>
                  </div>
                </a>
              )}

              {/* Booking buttons row - Gros boutons colorés visibles */}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <BookingButtons item={item} />
              </div>
            </div>

            {/* Icon */}
            <div
              className="p-2 rounded-lg shrink-0"
              style={{ backgroundColor: `${color}15` }}
            >
              <Icon className="h-5 w-5" style={{ color }} />
            </div>
          </div>

          {/* Flight alternatives - scrollable horizontal */}
          {item.type === 'flight' && item.flightAlternatives && item.flightAlternatives.length > 0 && (
            <FlightAlternatives alternatives={item.flightAlternatives} />
          )}

          {/* Bouton monter - centré en haut */}
          {onMoveUp && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full shadow-md"
                disabled={!canMoveUp}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
                title="Déplacer vers le haut"
              >
                <ChevronUp className="h-5 w-5" />
              </Button>
            </div>
          )}

          {/* Bouton descendre - centré en bas */}
          {onMoveDown && (
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
              <Button
                size="icon"
                variant="secondary"
                className="h-8 w-8 rounded-full shadow-md"
                disabled={!canMoveDown}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown();
                }}
                title="Déplacer vers le bas"
              >
                <ChevronDown className="h-5 w-5" />
              </Button>
            </div>
          )}

          {/* Action buttons (swap/edit/delete) */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            {swapButton && item.type === 'activity' && swapButton}
            {onEdit && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
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
 * Composant BookingButtons - Affiche des boutons de réservation colorés
 * Détecte automatiquement le provider depuis l'URL
 */
function BookingButtons({ item }: { item: TripItem }) {
  const buttons: { label: string; url: string; bgColor: string; icon: React.ReactNode }[] = [];

  // Détecter le provider depuis l'URL du bookingUrl principal
  const bookingUrl = item.bookingUrl || '';

  // Vol - Aviasales
  if (item.type === 'flight' && bookingUrl) {
    if (bookingUrl.includes('aviasales.com')) {
      buttons.push({
        label: 'Aviasales',
        url: bookingUrl,
        bgColor: 'bg-orange-500 hover:bg-orange-600',
        icon: <Plane className="h-3.5 w-3.5" />,
      });
    } else {
      buttons.push({
        label: 'Réserver vol',
        url: bookingUrl,
        bgColor: 'bg-blue-500 hover:bg-blue-600',
        icon: <Plane className="h-3.5 w-3.5" />,
      });
    }
    // Ajouter aussi Aviasales si disponible séparément
    if (item.aviasalesUrl && item.aviasalesUrl !== bookingUrl) {
      buttons.push({
        label: 'Aviasales',
        url: item.aviasalesUrl,
        bgColor: 'bg-orange-500 hover:bg-orange-600',
        icon: <Plane className="h-3.5 w-3.5" />,
      });
    }
  }

  // Hôtel - Booking.com ou Airbnb
  if ((item.type === 'hotel' || item.type === 'checkout') && bookingUrl) {
    if (bookingUrl.includes('booking.com')) {
      buttons.push({
        label: 'Booking',
        url: bookingUrl,
        bgColor: 'bg-blue-600 hover:bg-blue-700',
        icon: <Bed className="h-3.5 w-3.5" />,
      });
    } else if (bookingUrl.includes('airbnb.com')) {
      buttons.push({
        label: 'Airbnb',
        url: bookingUrl,
        bgColor: 'bg-pink-500 hover:bg-pink-600',
        icon: <Bed className="h-3.5 w-3.5" />,
      });
    } else {
      buttons.push({
        label: 'Réserver',
        url: bookingUrl,
        bgColor: 'bg-blue-600 hover:bg-blue-700',
        icon: <Bed className="h-3.5 w-3.5" />,
      });
    }
  }

  // Transport - Omio, Trainline, FlixBus
  if (item.type === 'transport' && bookingUrl) {
    if (bookingUrl.includes('omio.fr') || bookingUrl.includes('omio.com') || bookingUrl.includes('omio.sjv.io')) {
      buttons.push({
        label: 'Omio',
        url: bookingUrl,
        bgColor: 'bg-blue-500 hover:bg-blue-600',
        icon: <TrainFront className="h-3.5 w-3.5" />,
      });
    } else if (bookingUrl.includes('trainline')) {
      buttons.push({
        label: 'Trainline',
        url: bookingUrl,
        bgColor: 'bg-blue-500 hover:bg-blue-600',
        icon: <TrainFront className="h-3.5 w-3.5" />,
      });
    } else if (bookingUrl.includes('flixbus')) {
      buttons.push({
        label: 'FlixBus',
        url: bookingUrl,
        bgColor: 'bg-green-500 hover:bg-green-600',
        icon: <Bus className="h-3.5 w-3.5" />,
      });
    } else {
      buttons.push({
        label: 'Réserver transport',
        url: bookingUrl,
        bgColor: 'bg-blue-500 hover:bg-blue-600',
        icon: <TrainFront className="h-3.5 w-3.5" />,
      });
    }
  }

  // Activité - Site officiel ou Viator
  if (item.type === 'activity' && bookingUrl) {
    if (bookingUrl.includes('viator.com')) {
      buttons.push({
        label: 'Viator',
        url: bookingUrl,
        bgColor: 'bg-green-600 hover:bg-green-700',
        icon: <ExternalLink className="h-3.5 w-3.5" />,
      });
    } else {
      // URL officielle (rijksmuseum.nl, annefrank.org, etc.)
      buttons.push({
        label: 'Site officiel',
        url: bookingUrl,
        bgColor: 'bg-indigo-600 hover:bg-indigo-700',
        icon: <ExternalLink className="h-3.5 w-3.5" />,
      });
    }
  }

  // Viator alternatif (quand bookingUrl est un site officiel)
  if (item.viatorUrl && !bookingUrl.includes('viator.com') && !item.viatorImageUrl) {
    buttons.push({
      label: 'Viator',
      url: item.viatorUrl,
      bgColor: 'bg-green-600 hover:bg-green-700',
      icon: <ExternalLink className="h-3.5 w-3.5" />,
    });
  }

  // Google Maps - toujours en dernier
  const mapsUrl = item.googleMapsPlaceUrl ||
    item.googleMapsUrl ||
    (item.latitude && item.longitude ? `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}` : null);

  if (mapsUrl) {
    buttons.push({
      label: 'Maps',
      url: mapsUrl,
      bgColor: 'bg-gray-500 hover:bg-gray-600',
      icon: <Map className="h-3.5 w-3.5" />,
    });
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
            btn.bgColor,
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors shadow-sm'
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

  // Extraire origin/destination du title
  const parts = item.title?.match(/(.+?)\s*[→>–\-]\s*(.+)/);
  const origin = parts?.[1]?.replace(/^(Train|Bus|Vol|Ferry)\s+/i, '').trim() || '';
  const destination = parts?.[2]?.trim() || '';

  // Mode de transport
  const isBus = item.title?.toLowerCase().includes('bus');
  const ModeIcon = isBus ? Bus : TrainFront;

  // Données DB HAFAS réelles
  const legs = item.transitLegs;
  const hasRealData = legs && legs.length > 0;
  const isRealTime = item.transitDataSource === 'api';

  // Formatter un horaire ISO en HH:mm
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  // Formatter la durée
  const formatDuration = (min: number) => {
    if (min >= 60) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
    }
    return `${min}min`;
  };

  return (
    <a
      href={bookingUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="block mt-3 rounded-xl border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 hover:shadow-md transition-all overflow-hidden"
    >
      {/* Header avec gradient */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 flex items-center gap-2">
        <ModeIcon className="h-4 w-4 text-white" />
        <span className="text-white font-medium text-sm truncate">
          {origin && destination ? `${origin} → ${destination}` : item.title}
        </span>
        {isRealTime && (
          <span className="ml-auto text-[10px] bg-white/20 text-white px-1.5 py-0.5 rounded-full">
            Horaires réels
          </span>
        )}
      </div>

      {/* Contenu */}
      <div className="px-4 py-3 space-y-2.5">

        {/* Legs détaillés DB HAFAS */}
        {hasRealData ? (
          <div className="space-y-1.5">
            {legs.map((leg, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                {/* Horaires */}
                <div className="flex items-center gap-1 text-muted-foreground min-w-[90px]">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="font-mono text-xs">
                    {formatTime(leg.departure)} → {formatTime(leg.arrival)}
                  </span>
                </div>
                {/* Ligne / opérateur */}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-white dark:bg-gray-800 border font-medium">
                  {leg.mode === 'bus' ? <Bus className="h-3 w-3" /> : <TrainFront className="h-3 w-3" />}
                  {leg.line || leg.operator || 'Train'}
                </span>
                {/* Durée */}
                <span className="text-xs text-muted-foreground">
                  {formatDuration(leg.duration)}
                </span>
                {/* Correspondance */}
                {idx < legs.length - 1 && (
                  <span className="text-[10px] text-orange-600 dark:text-orange-400 ml-auto">
                    ↓ correspondance
                  </span>
                )}
              </div>
            ))}
            {/* Résumé : durée totale + correspondances */}
            {legs.length > 1 && (
              <div className="text-xs text-muted-foreground pt-0.5">
                {legs.length - 1} correspondance{legs.length > 2 ? 's' : ''} · durée totale ~{item.duration ? formatDuration(item.duration) : ''}
              </div>
            )}
          </div>
        ) : (
          /* Fallback : ancien affichage si pas de données DB */
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {item.startTime && item.endTime && (
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {item.startTime} → {item.endTime}
              </span>
            )}
            {item.duration && item.duration > 0 && (
              <span className="text-xs">
                ~{formatDuration(item.duration)}
              </span>
            )}
          </div>
        )}

        {/* Prix estimé */}
        {item.estimatedCost != null && item.estimatedCost > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm text-blue-600 dark:text-blue-400">
              {isRealTime ? '' : 'à partir de ~'}{item.estimatedCost}€
            </span>
            {!isRealTime && (
              <span className="text-[10px] text-muted-foreground">(estimé)</span>
            )}
          </div>
        )}

        {/* Transit lines from transitInfo (Eurostar, Thalys badges - si pas de legs DB) */}
        {!hasRealData && item.transitInfo?.lines && item.transitInfo.lines.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.transitInfo.lines.map((line, idx) => {
              const LineIcon = TRANSIT_MODE_ICONS[line.mode] || Bus;
              return (
                <span
                  key={`${line.mode}-${line.number}-${idx}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-white dark:bg-gray-800 border text-muted-foreground"
                >
                  <LineIcon className="h-3 w-3" />
                  {line.number}
                </span>
              );
            })}
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground italic">
            {isRealTime ? 'Réserver sur' : 'Prix et horaires exacts sur'} {isOmio ? 'Omio' : 'le site'}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-600 text-white text-xs font-medium">
            <Search className="h-3 w-3" />
            {isRealTime ? 'Réserver' : `Voir les ${isBus ? 'bus' : 'trains'}`}
          </span>
        </div>
      </div>
    </a>
  );
}

function FlightAlternatives({ alternatives }: { alternatives: Flight[] }) {
  const [expanded, setExpanded] = useState(false);

  if (alternatives.length === 0) return null;

  return (
    <div className="mt-2 border-t pt-2" onClick={(e) => e.stopPropagation()}>
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
              className="flex-shrink-0 border rounded-lg p-2 text-xs hover:border-primary/50 hover:bg-muted/50 transition-colors min-w-[140px]"
            >
              <div className="font-medium">{alt.airline}</div>
              <div className="text-muted-foreground">{alt.flightNumber}</div>
              <div className="mt-1">
                {alt.departureTimeDisplay || alt.departureTime?.split('T')[1]?.slice(0, 5)} → {alt.arrivalTimeDisplay || alt.arrivalTime?.split('T')[1]?.slice(0, 5)}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-semibold text-primary">{alt.pricePerPerson || alt.price}€</span>
                <span className="text-muted-foreground">
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
