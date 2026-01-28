'use client';

import { TripItem, TRIP_ITEM_COLORS } from '@/lib/types';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TripItemType } from '@/lib/types';

interface ActivityCardProps {
  item: TripItem;
  isSelected?: boolean;
  isDragging?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
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
  isSelected,
  isDragging,
  onSelect,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  dragHandleProps,
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

        {/* Time indicator */}
        <div
          className="w-1 self-stretch"
          style={{ backgroundColor: color }}
        />

        {/* Content */}
        <div className="flex-1 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Time */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {item.startTime} - {item.endTime}
                </span>
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${color}20`, color }}
                >
                  {TYPE_LABELS[item.type]}
                </span>
              </div>

              {/* Title */}
              <h4 className="font-semibold text-base mb-1 truncate">{item.title}</h4>

              {/* Description */}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {item.description}
              </p>

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

                {/* Cost */}
                {item.estimatedCost && item.estimatedCost > 0 && (
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

              {/* Transit lines */}
              {item.transitInfo?.lines && item.transitInfo.lines.length > 0 && (
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

              {/* Links row */}
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {/* Booking link */}
                {item.bookingUrl && (
                  <a
                    href={item.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Réserver
                  </a>
                )}

                {/* Google Maps - PRIORITÉ au lien par nom (plus fiable que GPS) */}
                {item.googleMapsPlaceUrl && (
                  <a
                    href={item.googleMapsPlaceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-green-600 hover:underline"
                  >
                    <Map className="h-3 w-3" />
                    Voir sur Maps
                  </a>
                )}

                {/* Google Maps itinerary link (if there's travel info) */}
                {item.googleMapsUrl && !item.googleMapsPlaceUrl && (
                  <a
                    href={item.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                  >
                    <Navigation className="h-3 w-3" />
                    Itinéraire
                  </a>
                )}

                {/* Google Maps location link (fallback GPS - moins fiable) */}
                {!item.googleMapsUrl && !item.googleMapsPlaceUrl && item.latitude && item.longitude && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 hover:underline"
                    title="Coordonnées GPS (peut être imprécis)"
                  >
                    <Map className="h-3 w-3" />
                    Voir sur Maps
                  </a>
                )}
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

          {/* Action buttons */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            {/* Move buttons */}
            {onMoveUp && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={!canMoveUp}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveUp();
                }}
                title="Déplacer vers le haut"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
            {onMoveDown && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={!canMoveDown}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveDown();
                }}
                title="Déplacer vers le bas"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            )}
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
