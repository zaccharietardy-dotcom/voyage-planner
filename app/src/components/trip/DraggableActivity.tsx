'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TripItem, TRIP_ITEM_COLORS } from '@/lib/types';
import {
  GripVertical,
  MapPin,
  Clock,
  Plane,
  Hotel,
  Utensils,
  Camera,
  Car,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DraggableActivityProps {
  item: TripItem;
  isEditable?: boolean;
  isDragging?: boolean;
}

export function DraggableActivity({
  item,
  isEditable = true,
  isDragging = false,
}: DraggableActivityProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: item.id,
    disabled: !isEditable,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const getTypeIcon = () => {
    switch (item.type) {
      case 'flight':
        return <Plane className="h-4 w-4" />;
      case 'hotel':
      case 'checkin':
      case 'checkout':
        return <Hotel className="h-4 w-4" />;
      case 'restaurant':
        return <Utensils className="h-4 w-4" />;
      case 'activity':
        return <Camera className="h-4 w-4" />;
      case 'transport':
        return <Car className="h-4 w-4" />;
      case 'luggage':
        return <Package className="h-4 w-4" />;
      default:
        return <MapPin className="h-4 w-4" />;
    }
  };

  const getTypeColor = () => {
    return TRIP_ITEM_COLORS[item.type] || '#6B7280';
  };

  const actuallyDragging = isDragging || isSortableDragging;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'transition-all',
        actuallyDragging && 'opacity-50 scale-105 z-50'
      )}
    >
      <Card
        className={cn(
          'p-3 hover:shadow-md transition-shadow',
          isEditable && 'cursor-grab active:cursor-grabbing',
          actuallyDragging && 'shadow-lg ring-2 ring-primary'
        )}
      >
        <div className="flex items-start gap-3">
          {/* Poignée de drag */}
          {isEditable && (
            <div
              {...attributes}
              {...listeners}
              className="mt-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <GripVertical className="h-5 w-5" />
            </div>
          )}

          {/* Indicateur de couleur */}
          <div
            className="w-1 h-12 rounded-full flex-shrink-0"
            style={{ backgroundColor: getTypeColor() }}
          />

          {/* Contenu principal */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="p-1.5 rounded-md"
                  style={{ backgroundColor: `${getTypeColor()}20` }}
                >
                  <span style={{ color: getTypeColor() }}>{getTypeIcon()}</span>
                </div>
                <div>
                  <h4 className="font-medium text-sm truncate">{item.title}</h4>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.locationName}
                  </p>
                </div>
              </div>

              {/* Heure */}
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                <Clock className="h-3 w-3 mr-1" />
                {item.startTime}
              </Badge>
            </div>

            {/* Description */}
            {item.description && (
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {item.description}
              </p>
            )}

            {/* Footer avec coût et durée */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              {item.duration && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {Math.floor(item.duration / 60)}h{item.duration % 60 > 0 ? `${item.duration % 60}min` : ''}
                </span>
              )}
              {item.estimatedCost !== undefined && item.estimatedCost > 0 && (
                <span className="font-medium text-foreground">
                  {item.estimatedCost}€
                </span>
              )}
              {item.distanceFromPrevious !== undefined && item.distanceFromPrevious > 0 && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {item.distanceFromPrevious.toFixed(1)} km
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Version non-draggable pour l'overlay
export function ActivityOverlay({ item }: { item: TripItem }) {
  return <DraggableActivity item={item} isEditable={false} isDragging={true} />;
}
