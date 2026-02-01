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
import { TripDay, TripItem } from '@/lib/types';
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
  ChevronLeft,
  ChevronRight,
  Plus,
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
}

// Composant pour un jour droppable
function DroppableDay({
  day,
  dayIndex,
  totalDays,
  isEditable,
  children,
  onSwapLeft,
  onSwapRight,
  onAddItem,
}: {
  day: TripDay;
  dayIndex: number;
  totalDays: number;
  isEditable: boolean;
  children: React.ReactNode;
  onSwapLeft?: () => void;
  onSwapRight?: () => void;
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
          <div className="flex items-center gap-1">
            {/* Swap day left */}
            {isEditable && dayIndex > 0 && onSwapLeft && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onSwapLeft}
                title="Permuter avec le jour précédent"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Jour {day.dayNumber}
            </CardTitle>
            {/* Swap day right */}
            {isEditable && dayIndex < totalDays - 1 && onSwapRight && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onSwapRight}
                title="Permuter avec le jour suivant"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
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

        {/* Add activity button */}
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
}: DraggableTimelineProps) {
  const [activeItem, setActiveItem] = useState<TripItem | null>(null);
  const filteredDays = useMemo(() => days.map(day => ({ ...day, items: [...day.items] })), [days]);
  const [localDays, setLocalDays] = useState(filteredDays);

  // Sync local days when props change
  useEffect(() => {
    if (!activeItem) {
      setLocalDays(filteredDays);
    }
  }, [filteredDays, activeItem]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Apply update (owner = direct, editor = proposal)
  const applyUpdate = useCallback((newDays: TripDay[]) => {
    const recalculated = recalculateTimes(newDays);
    if (isOwner && onDirectUpdate) {
      onDirectUpdate(recalculated);
      setLocalDays(recalculated);
    }
  }, [isOwner, onDirectUpdate]);

  // Move item up/down within same day
  const handleMoveInDay = useCallback((dayIndex: number, itemIndex: number, direction: 'up' | 'down') => {
    try {
      const newDays = moveItemInDay(localDays, dayIndex, itemIndex, direction);
      applyUpdate(newDays);
    } catch (err) {
      console.error('Move error:', err);
    }
  }, [localDays, applyUpdate]);

  // Delete item
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

  // Swap days
  const handleSwapDays = useCallback((dayIndexA: number, dayIndexB: number) => {
    try {
      const newDays = swapDays(localDays, dayIndexA, dayIndexB);
      applyUpdate(newDays);
      toast.success(`Jour ${dayIndexA + 1} et Jour ${dayIndexB + 1} permutés`);
    } catch (err) {
      console.error('Swap error:', err);
    }
  }, [localDays, applyUpdate]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const found = findItemById(localDays, active.id as string);
      if (found) {
        // Don't allow dragging locked items
        if (isLockedItem(found.item)) {
          return;
        }
        setActiveItem(found.item);
      }
    },
    [localDays]
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    // Preview during drag (optional)
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveItem(null);

      if (!over || active.id === over.id) return;

      try {
        const activeFound = findItemById(localDays, active.id as string);
        const overPosition = findDropPosition(localDays, over.id as string);

        if (!activeFound || !overPosition) return;

        // Don't move locked items
        if (isLockedItem(activeFound.item)) return;

        const { dayIndex: fromDayIndex, itemIndex: fromItemIndex, item } = activeFound;
        const { dayIndex: toDayIndex, itemIndex: toItemIndex } = overPosition;

        const newDays = moveItem(
          localDays,
          fromDayIndex,
          fromItemIndex,
          toDayIndex,
          toItemIndex
        );

        const recalculatedDays = recalculateTimes(newDays);

        if (isOwner && onDirectUpdate) {
          onDirectUpdate(recalculatedDays);
          setLocalDays(recalculatedDays);
        } else if (onProposalCreate) {
          const change = createMoveActivityChange(
            fromDayIndex + 1,
            toDayIndex + 1,
            fromItemIndex,
            toItemIndex,
            item.title
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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-4">
        {localDays.map((day, dayIndex) => (
          <DroppableDay
            key={day.dayNumber}
            day={day}
            dayIndex={dayIndex}
            totalDays={localDays.length}
            isEditable={isEditable}
            onSwapLeft={dayIndex > 0 ? () => handleSwapDays(dayIndex, dayIndex - 1) : undefined}
            onSwapRight={dayIndex < localDays.length - 1 ? () => handleSwapDays(dayIndex, dayIndex + 1) : undefined}
            onAddItem={onAddItem ? () => onAddItem(day.dayNumber) : undefined}
          >
            {day.items.map((item, itemIndex) => (
              <DraggableActivity
                key={item.id}
                item={item}
                isEditable={isEditable}
                isFirst={itemIndex === 0}
                isLast={itemIndex === day.items.length - 1}
                onMoveUp={() => handleMoveInDay(dayIndex, itemIndex, 'up')}
                onMoveDown={() => handleMoveInDay(dayIndex, itemIndex, 'down')}
                onDelete={() => handleDeleteItem(dayIndex, itemIndex, item.title)}
                onEdit={onEditItem ? () => onEditItem(item) : undefined}
              />
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
