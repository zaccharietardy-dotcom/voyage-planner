'use client';

import { useState, useCallback } from 'react';
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
  findItemById,
  findDropPosition,
  generateMoveDescription,
} from '@/lib/services/itineraryCalculator';
import { createMoveActivityChange, ProposedChange } from '@/lib/types/collaboration';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, Sun, Moon, Sunrise } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface DraggableTimelineProps {
  days: TripDay[];
  isEditable: boolean;
  isOwner: boolean;
  onDirectUpdate?: (updatedDays: TripDay[]) => void;
  onProposalCreate?: (change: ProposedChange) => void;
}

// Composant pour un jour droppable
function DroppableDay({
  day,
  isEditable,
  children,
}: {
  day: TripDay;
  isEditable: boolean;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${day.dayNumber}`,
    disabled: !isEditable,
  });

  const getDayPeriodIcon = () => {
    const firstItem = day.items[0];
    if (!firstItem) return <Sun className="h-4 w-4" />;

    const hour = parseInt(firstItem.startTime.split(':')[0], 10);
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
      </CardHeader>
      <CardContent>
        <SortableContext
          items={day.items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2 min-h-[100px]">
            {day.items.length === 0 ? (
              <div className="h-[100px] flex items-center justify-center border-2 border-dashed rounded-lg text-muted-foreground text-sm">
                Glissez une activité ici
              </div>
            ) : (
              children
            )}
          </div>
        </SortableContext>
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
}: DraggableTimelineProps) {
  const [activeItem, setActiveItem] = useState<TripItem | null>(null);
  const [localDays, setLocalDays] = useState(days);

  // Mettre à jour les jours locaux quand les props changent
  if (days !== localDays && !activeItem) {
    setLocalDays(days);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Minimum de 8px de déplacement pour activer
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const found = findItemById(localDays, active.id as string);
      if (found) {
        setActiveItem(found.item);
      }
    },
    [localDays]
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    // Prévisualisation pendant le drag (optionnel)
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveItem(null);

      if (!over || active.id === over.id) return;

      const activeFound = findItemById(localDays, active.id as string);
      const overPosition = findDropPosition(localDays, over.id as string);

      if (!activeFound || !overPosition) return;

      const { dayIndex: fromDayIndex, itemIndex: fromItemIndex, item } = activeFound;
      const { dayIndex: toDayIndex, itemIndex: toItemIndex } = overPosition;

      // Déplacer l'item
      const newDays = moveItem(
        localDays,
        fromDayIndex,
        fromItemIndex,
        toDayIndex,
        toItemIndex
      );

      // Recalculer les horaires
      const recalculatedDays = recalculateTimes(newDays);

      // Si owner, appliquer directement
      if (isOwner && onDirectUpdate) {
        onDirectUpdate(recalculatedDays);
        setLocalDays(recalculatedDays);
      }
      // Sinon, créer une proposition
      else if (onProposalCreate) {
        const change = createMoveActivityChange(
          fromDayIndex + 1,
          toDayIndex + 1,
          fromItemIndex,
          toItemIndex,
          item.title
        );
        onProposalCreate(change);
        // Revenir à l'état initial
        setLocalDays(days);
      }
    },
    [localDays, days, isOwner, onDirectUpdate, onProposalCreate]
  );

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
    setLocalDays(days);
  }, [days]);

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
        {localDays.map((day) => (
          <DroppableDay key={day.dayNumber} day={day} isEditable={isEditable}>
            {day.items.map((item) => (
              <DraggableActivity
                key={item.id}
                item={item}
                isEditable={isEditable}
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
