'use client';

import { useRef, useCallback, useState } from 'react';
import { TripItem, TRIP_ITEM_COLORS } from '@/lib/types';
import { isLockedItem } from '@/lib/services/itineraryCalculator';
import { cn } from '@/lib/utils';
import { Lock, GripHorizontal } from 'lucide-react';

interface CalendarActivityBlockProps {
  item: TripItem;
  isEditable: boolean;
  rowStart: number;
  rowSpan: number;
  column?: number;
  totalColumns?: number;
  slotHeight: number;
  onUpdate?: (item: TripItem) => void;
  onClick?: () => void;
  onInteraction?: () => void;
}

function parseMinutes(time: string | undefined | null): number {
  if (!time) return 9 * 60;
  const [h, m] = time.split(':').map(Number);
  return (isNaN(h) ? 9 : h) * 60 + (isNaN(m!) ? 0 : m!);
}

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export function CalendarActivityBlock({
  item,
  isEditable,
  rowStart,
  rowSpan,
  column = 0,
  totalColumns = 1,
  slotHeight,
  onUpdate,
  onClick,
  onInteraction,
}: CalendarActivityBlockProps) {
  const locked = isLockedItem(item);
  const canResize = isEditable && !locked;
  const color = TRIP_ITEM_COLORS[item.type] || '#6B7280';

  // Visual-only drag state: delta in slots from the original position
  const [dragState, setDragState] = useState<{
    edge: 'top' | 'bottom';
    deltaSlots: number;
  } | null>(null);

  // Snapshot of item at drag start (immune to re-renders)
  const dragItemRef = useRef(item);
  const startYRef = useRef(0);
  const slotHeightRef = useRef(slotHeight);
  const rowStartRef = useRef(rowStart);
  const rowSpanRef = useRef(rowSpan);

  const handleResizeStart = useCallback(
    (edge: 'top' | 'bottom', e: React.MouseEvent) => {
      if (!canResize) return;
      e.preventDefault();
      e.stopPropagation();

      // Snapshot everything at drag start
      dragItemRef.current = item;
      startYRef.current = e.clientY;
      slotHeightRef.current = slotHeight;
      rowStartRef.current = rowStart;
      rowSpanRef.current = rowSpan;
      setDragState({ edge, deltaSlots: 0 });

      const handleMouseMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        setDragState({ edge, deltaSlots });
      };

      const handleMouseUp = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);

        const dy = ev.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        const snap = dragItemRef.current;

        // Compute final item
        if (edge === 'bottom') {
          const newSpan = Math.max(1, rowSpanRef.current + deltaSlots);
          const newDuration = newSpan * 15;
          const newEndTime = formatTime(parseMinutes(snap.startTime) + newDuration);
          if (newDuration !== snap.duration) {
            onUpdate?.({ ...snap, duration: newDuration, endTime: newEndTime });
          }
        } else {
          const newRowStart = Math.max(1, rowStartRef.current + deltaSlots);
          const newStartMinutes = (newRowStart - 1) * 15;
          const endMinutes = parseMinutes(snap.endTime);
          const newDuration = endMinutes - newStartMinutes;
          if (newDuration >= 15) {
            onUpdate?.({
              ...snap,
              startTime: formatTime(newStartMinutes),
              duration: newDuration,
            });
          }
        }

        setDragState(null);
        onInteraction?.();
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [canResize, item, slotHeight, rowStart, rowSpan, onUpdate, onInteraction]
  );

  // Touch resize
  const handleTouchResizeStart = useCallback(
    (edge: 'top' | 'bottom', e: React.TouchEvent) => {
      if (!canResize) return;
      e.preventDefault();
      e.stopPropagation();

      const touch = e.touches[0];
      dragItemRef.current = item;
      startYRef.current = touch.clientY;
      slotHeightRef.current = slotHeight;
      rowStartRef.current = rowStart;
      rowSpanRef.current = rowSpan;
      setDragState({ edge, deltaSlots: 0 });

      const handleTouchMove = (ev: TouchEvent) => {
        const t = ev.touches[0];
        const dy = t.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        setDragState({ edge, deltaSlots });
      };

      const handleTouchEnd = (ev: TouchEvent) => {
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);

        // Use last known position from changedTouches
        const t = ev.changedTouches[0];
        const dy = t.clientY - startYRef.current;
        const deltaSlots = Math.round(dy / slotHeightRef.current);
        const snap = dragItemRef.current;

        if (edge === 'bottom') {
          const newSpan = Math.max(1, rowSpanRef.current + deltaSlots);
          const newDuration = newSpan * 15;
          const newEndTime = formatTime(parseMinutes(snap.startTime) + newDuration);
          if (newDuration !== snap.duration) {
            onUpdate?.({ ...snap, duration: newDuration, endTime: newEndTime });
          }
        } else {
          const newRowStart = Math.max(1, rowStartRef.current + deltaSlots);
          const newStartMinutes = (newRowStart - 1) * 15;
          const endMinutes = parseMinutes(snap.endTime);
          const newDuration = endMinutes - newStartMinutes;
          if (newDuration >= 15) {
            onUpdate?.({
              ...snap,
              startTime: formatTime(newStartMinutes),
              duration: newDuration,
            });
          }
        }

        setDragState(null);
        onInteraction?.();
      };

      window.addEventListener('touchmove', handleTouchMove, { passive: false });
      window.addEventListener('touchend', handleTouchEnd);
    },
    [canResize, item, slotHeight, rowStart, rowSpan, onUpdate, onInteraction]
  );

  // Visual position: apply drag delta for smooth preview
  const visualRowStart = dragState?.edge === 'top'
    ? Math.max(1, rowStart + dragState.deltaSlots)
    : rowStart;
  const visualRowSpan = dragState?.edge === 'bottom'
    ? Math.max(1, rowSpan + dragState.deltaSlots)
    : dragState?.edge === 'top'
      ? Math.max(1, rowSpan - dragState.deltaSlots)
      : rowSpan;

  const widthPercent = totalColumns > 1 ? `${100 / totalColumns}%` : '100%';
  const leftPercent = totalColumns > 1 ? `${(column / totalColumns) * 100}%` : '0%';

  const visualTop = (visualRowStart - 1) * slotHeight;
  const visualHeight = visualRowSpan * slotHeight;
  const showDuration = visualHeight >= 40;
  const showTitle = visualHeight >= 24;

  // Compute displayed times during drag
  const displayStartTime = dragState?.edge === 'top'
    ? formatTime(Math.max(0, (visualRowStart - 1) * 15))
    : item.startTime;
  const displayEndTime = dragState?.edge === 'bottom'
    ? formatTime((rowStart - 1) * 15 + visualRowSpan * 15)
    : dragState?.edge === 'top'
      ? item.endTime
      : item.endTime;

  return (
    <div
      className={cn(
        'absolute rounded-md border overflow-hidden select-none',
        canResize && 'cursor-pointer hover:shadow-md',
        locked && 'border-dashed opacity-80',
        dragState && 'shadow-lg ring-2 ring-primary z-50',
        dragState && 'transition-none'
      )}
      style={{
        top: visualTop,
        height: visualHeight,
        left: `calc(${leftPercent} + 2px)`,
        width: `calc(${widthPercent} - 4px)`,
        backgroundColor: `${color}18`,
        borderColor: `${color}60`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onInteraction?.();
        if (!dragState) {
          onClick?.();
        }
      }}
    >
      {/* Color stripe left */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: color }}
      />

      {/* Content */}
      <div className="pl-2.5 pr-1 py-0.5 h-full flex flex-col justify-center overflow-hidden">
        {showTitle && (
          <div className="flex items-center gap-1">
            {locked && <Lock className="h-3 w-3 flex-shrink-0 text-muted-foreground" />}
            <span
              className="text-xs font-medium truncate"
              style={{ color }}
            >
              {item.title}
            </span>
          </div>
        )}
        {showDuration && (
          <span className="text-[10px] text-muted-foreground truncate">
            {displayStartTime} – {displayEndTime}
          </span>
        )}
      </div>

      {/* Resize handles */}
      {canResize && (
        <>
          <div
            className="absolute top-0 left-0 right-0 h-2 cursor-row-resize hover:bg-foreground/10 flex items-center justify-center"
            onMouseDown={(e) => handleResizeStart('top', e)}
            onTouchStart={(e) => handleTouchResizeStart('top', e)}
          >
            <GripHorizontal className="h-2.5 w-2.5 text-muted-foreground/50" />
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 h-2 cursor-row-resize hover:bg-foreground/10 flex items-center justify-center"
            onMouseDown={(e) => handleResizeStart('bottom', e)}
            onTouchStart={(e) => handleTouchResizeStart('bottom', e)}
          >
            <GripHorizontal className="h-2.5 w-2.5 text-muted-foreground/50" />
          </div>
        </>
      )}
    </div>
  );
}
