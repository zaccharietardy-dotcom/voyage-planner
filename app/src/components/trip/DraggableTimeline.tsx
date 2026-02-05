'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { TripDay, TripItem, Accommodation } from '@/lib/types';
import { HotelCarouselSelector } from './HotelCarouselSelector';
import type { HotelSelectorData } from './DayTimeline';
import { DraggableActivity, ActivityOverlay } from './DraggableActivity';
import {
  recalculateTimes,
  moveItem,
  moveItemInDay,
  removeItem,
  swapDays,
  findItemById,
  findDropPosition,
  isLockedItem,
  isDayLocked,
} from '@/lib/services/itineraryCalculator';
import { createMoveActivityChange, ProposedChange } from '@/lib/types/collaboration';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Calendar,
  Sun,
  Moon,
  Sunrise,
  Plus,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Lock,
  GripVertical,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface DraggableTimelineProps {
  days: TripDay[];
  isEditable: boolean;
  isOwner: boolean;
  onDirectUpdate?: (updatedDays: TripDay[]) => void;
  onProposalCreate?: (change: ProposedChange) => void;
  onEditItem?: (item: TripItem) => void;
  onAddItem?: (dayNumber: number) => void;
  hotelSelectorData?: HotelSelectorData;
}

// Day summary for reorder panel
function getDaySummary(day: TripDay): string {
  if (day.theme) return day.theme;
  const types = day.items.map((i) => i.type);
  if (types.includes('checkin')) return 'Arrivée & Check-in';
  if (types.includes('checkout')) return 'Check-out & Départ';
  if (types.includes('flight')) return 'Vol';
  const activities = day.items.filter((i) => i.type === 'activity').length;
  const restaurants = day.items.filter((i) => i.type === 'restaurant').length;
  const parts: string[] = [];
  if (activities > 0) parts.push(`${activities} activité${activities > 1 ? 's' : ''}`);
  if (restaurants > 0) parts.push(`${restaurants} restaurant${restaurants > 1 ? 's' : ''}`);
  return parts.join(', ') || `${day.items.length} items`;
}

// Reorder panel showing all days at once
function DayReorderPanel({
  days,
  onSwap,
  onClose,
}: {
  days: TripDay[];
  onSwap: (a: number, b: number) => void;
  onClose: () => void;
}) {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4" />
            Réorganiser les jours
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {days.map((day, idx) => {
          const locked = isDayLocked(day);
          // Find adjacent unlocked days for swap targets
          const canMoveUp = !locked && idx > 0 && !isDayLocked(days[idx - 1]);
          const canMoveDown = !locked && idx < days.length - 1 && !isDayLocked(days[idx + 1]);

          return (
            <div
              key={day.dayNumber}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
                locked ? 'bg-muted/50 opacity-70' : 'bg-background hover:bg-accent'
              )}
            >
              {/* Lock or grip icon */}
              <div className="w-5 flex-shrink-0">
                {locked ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Day info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">Jour {day.dayNumber}</span>
                  {day.date && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(day.date), 'EEE d MMM', { locale: fr })}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {getDaySummary(day)}
                </p>
              </div>

              {/* Activity count */}
              <Badge variant="secondary" className="text-xs flex-shrink-0">
                {day.items.length}
              </Badge>

              {/* Move buttons */}
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={!canMoveUp}
                  onClick={() => canMoveUp && onSwap(idx, idx - 1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={!canMoveDown}
                  onClick={() => canMoveDown && onSwap(idx, idx + 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground pt-1">
          Les jours avec transport, check-in ou check-out sont verrouillés.
        </p>
      </CardContent>
    </Card>
  );
}

// Composant pour un jour droppable
function DroppableDay({
  day,
  isEditable,
  children,
  onAddItem,
}: {
  day: TripDay;
  isEditable: boolean;
  children: React.ReactNode;
  onAddItem?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${day.dayNumber}`,
    disabled: !isEditable,
  });

  const getDayPeriodIcon = () => {
    const firstItem = day.items[0];
    if (!firstItem) return <Sun className="h-4 w-4" />;

    const hour = parseInt(firstItem.startTime?.split(':')[0] || '12', 10);
    if (hour < 12) return <Sunrise className="h-4 w-4" />;
    if (hour < 18) return <Sun className="h-4 w-4" />;
    return <Moon className="h-4 w-4" />;
  };

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        'transition-all',
        isOver && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Jour {day.dayNumber}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {getDayPeriodIcon()}
              {day.items.length} activité{day.items.length > 1 ? 's' : ''}
            </Badge>
            {day.date && (
              <Badge variant="outline" className="text-xs">
                {format(new Date(day.date), 'EEE d MMM', { locale: fr })}
              </Badge>
            )}
          </div>
        </div>
        {day.theme && (
          <p className="text-xs text-muted-foreground mt-1">{day.theme}</p>
        )}
      </CardHeader>
      <CardContent>
        <SortableContext
          items={day.items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 min-h-[60px]">
            {day.items.length === 0 ? (
              <div className="h-[60px] flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground text-sm">
                Glissez une activité ici
              </div>
            ) : (
              children
            )}
          </div>
        </SortableContext>

        {isEditable && onAddItem && (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3 gap-2 border-dashed"
            onClick={onAddItem}
          >
            <Plus className="h-4 w-4" />
            Ajouter une activité
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function DraggableTimeline({
  days,
  isEditable,
  isOwner,
  onDirectUpdate,
  onProposalCreate,
  onEditItem,
  onAddItem,
  hotelSelectorData,
}: DraggableTimelineProps) {
  const [activeItem, setActiveItem] = useState<TripItem | null>(null);
  const [showReorder, setShowReorder] = useState(false);
  const filteredDays = useMemo(() => days.map(day => ({ ...day, items: [...day.items] })), [days]);
  const [localDays, setLocalDays] = useState(filteredDays);

  useEffect(() => {
    if (!activeItem) {
      setLocalDays(filteredDays);
    }
  }, [filteredDays, activeItem]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const applyUpdate = useCallback((newDays: TripDay[]) => {
    const recalculated = recalculateTimes(newDays);
    if (isOwner && onDirectUpdate) {
      onDirectUpdate(recalculated);
      setLocalDays(recalculated);
    }
  }, [isOwner, onDirectUpdate]);

  const handleMoveInDay = useCallback((dayIndex: number, itemIndex: number, direction: 'up' | 'down') => {
    try {
      const newDays = moveItemInDay(localDays, dayIndex, itemIndex, direction);
      applyUpdate(newDays);
    } catch (err) {
      console.error('Move error:', err);
    }
  }, [localDays, applyUpdate]);

  const handleDeleteItem = useCallback((dayIndex: number, itemIndex: number, itemTitle: string) => {
    if (!confirm(`Supprimer "${itemTitle}" ?`)) return;
    try {
      const newDays = removeItem(localDays, dayIndex, itemIndex);
      applyUpdate(newDays);
      toast.success(`"${itemTitle}" supprimé`);
    } catch (err) {
      console.error('Delete error:', err);
    }
  }, [localDays, applyUpdate]);

  const handleSwapDays = useCallback((dayIndexA: number, dayIndexB: number) => {
    try {
      const newDays = swapDays(localDays, dayIndexA, dayIndexB);
      if (newDays === localDays) {
        toast.error('Ce jour ne peut pas être déplacé (transport/checkin/checkout)');
        return;
      }
      applyUpdate(newDays);
      toast.success(`Jour ${dayIndexA + 1} ↔ Jour ${dayIndexB + 1}`);
    } catch (err) {
      console.error('Swap error:', err);
    }
  }, [localDays, applyUpdate]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const found = findItemById(localDays, active.id as string);
      if (found) {
        if (isLockedItem(found.item)) return;
        setActiveItem(found.item);
      }
    },
    [localDays]
  );

  const handleDragOver = useCallback((_event: DragOverEvent) => {}, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveItem(null);

      if (!over || active.id === over.id) return;

      try {
        const activeFound = findItemById(localDays, active.id as string);
        const overPosition = findDropPosition(localDays, over.id as string);

        if (!activeFound || !overPosition) return;
        if (isLockedItem(activeFound.item)) return;

        const { dayIndex: fromDayIndex, itemIndex: fromItemIndex, item } = activeFound;
        const { dayIndex: toDayIndex, itemIndex: toItemIndex } = overPosition;

        const newDays = moveItem(localDays, fromDayIndex, fromItemIndex, toDayIndex, toItemIndex);
        const recalculatedDays = recalculateTimes(newDays);

        if (isOwner && onDirectUpdate) {
          onDirectUpdate(recalculatedDays);
          setLocalDays(recalculatedDays);
        } else if (onProposalCreate) {
          const change = createMoveActivityChange(
            fromDayIndex + 1, toDayIndex + 1, fromItemIndex, toItemIndex, item.title
          );
          onProposalCreate(change);
          setLocalDays(filteredDays);
        }
      } catch (err) {
        console.error('Drag-and-drop error:', err);
        setLocalDays(filteredDays);
      }
    },
    [localDays, filteredDays, isOwner, onDirectUpdate, onProposalCreate]
  );

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
    setLocalDays(filteredDays);
  }, [filteredDays]);

  // Check if there are swappable days (at least 2 non-locked days)
  const hasSwappableDays = localDays.filter((d) => !isDayLocked(d)).length >= 2;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Reorder days button + panel */}
      {isEditable && hasSwappableDays && (
        <>
          {!showReorder ? (
            <Button
              variant="outline"
              size="sm"
              className="mb-3 gap-2"
              onClick={() => setShowReorder(true)}
            >
              <ArrowUpDown className="h-4 w-4" />
              Réorganiser les jours
            </Button>
          ) : (
            <DayReorderPanel
              days={localDays}
              onSwap={handleSwapDays}
              onClose={() => setShowReorder(false)}
            />
          )}
        </>
      )}

      <div className="space-y-4">
        {localDays.map((day, dayIndex) => (
          <DroppableDay
            key={day.dayNumber}
            day={day}
            isEditable={isEditable}
            onAddItem={onAddItem ? () => onAddItem(day.dayNumber) : undefined}
          >
            {day.items.map((item, itemIndex) => (
              <div key={item.id}>
                <DraggableActivity
                  item={item}
                  isEditable={isEditable}
                  isFirst={itemIndex === 0}
                  isLast={itemIndex === day.items.length - 1}
                  onMoveUp={() => handleMoveInDay(dayIndex, itemIndex, 'up')}
                  onMoveDown={() => handleMoveInDay(dayIndex, itemIndex, 'down')}
                  onDelete={() => handleDeleteItem(dayIndex, itemIndex, item.title)}
                  onEdit={onEditItem ? () => onEditItem(item) : undefined}
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
              </div>
            ))}
          </DroppableDay>
        ))}
      </div>

      <DragOverlay>
        {activeItem && <ActivityOverlay item={activeItem} />}
      </DragOverlay>
    </DndContext>
  );
}
