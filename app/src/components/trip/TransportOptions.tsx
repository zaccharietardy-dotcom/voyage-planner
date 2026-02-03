'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TransportOptionSummary } from '@/lib/types';
import {
  Plane,
  TrainFront,
  Bus,
  Car,
  RefreshCw,
  Clock,
  Leaf,
  Euro,
  Star,
  ExternalLink,
  Check,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface TransportOptionsProps {
  options: TransportOptionSummary[];
  selectedId?: string;
  onSelect?: (option: TransportOptionSummary) => void;
  className?: string;
}

const MODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  plane: Plane,
  train: TrainFront,
  bus: Bus,
  car: Car,
  combined: RefreshCw,
};

const MODE_LABELS: Record<string, string> = {
  plane: 'Avion',
  train: 'Train',
  bus: 'Bus',
  car: 'Voiture',
  combined: 'Combiné',
};

const MODE_COLORS: Record<string, string> = {
  plane: '#EC4899',
  train: '#10B981',
  bus: '#F59E0B',
  car: '#6366F1',
  combined: '#8B5CF6',
};

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h${mins.toString().padStart(2, '0')}`;
}

/**
 * Compact transport selector that shows as a button with popover dropdown.
 * Replaces the old full-page card list.
 */
export function TransportOptions({
  options,
  selectedId,
  onSelect,
  className,
}: TransportOptionsProps) {
  const [open, setOpen] = useState(false);

  if (options.length === 0) return null;

  const sortedOptions = [...options].sort((a, b) => b.score - a.score);
  const selected = options.find(o => o.id === selectedId) || sortedOptions[0];
  const SelectedIcon = MODE_ICONS[selected.mode] || Plane;
  const selectedColor = MODE_COLORS[selected.mode] || '#666';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('gap-2 h-9', className)}
        >
          <div style={{ color: selectedColor }}><SelectedIcon className="h-4 w-4" /></div>
          <span className="font-medium">{MODE_LABELS[selected.mode]}</span>
          <span className="text-muted-foreground text-xs">
            {formatDuration(selected.totalDuration)} · {selected.totalPrice}€
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <div className="p-3 border-b">
          <p className="text-sm font-medium">Options de transport</p>
          <p className="text-xs text-muted-foreground">{options.length} options comparées</p>
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {sortedOptions.map((option) => {
            const Icon = MODE_ICONS[option.mode] || Plane;
            const color = MODE_COLORS[option.mode] || '#666';
            const isSelected = option.id === selectedId;

            return (
              <button
                key={option.id}
                onClick={() => {
                  onSelect?.(option);
                  setOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors border-b last:border-b-0',
                  isSelected && 'bg-primary/5'
                )}
              >
                {/* Icon */}
                <div
                  className="p-1.5 rounded-md shrink-0"
                  style={{ backgroundColor: `${color}15`, color }}
                >
                  <Icon className="h-4 w-4" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{MODE_LABELS[option.mode]}</span>
                    {option.recommended && (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0">
                        Recommandé
                      </Badge>
                    )}
                    {option.dataSource === 'api' && (
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0">
                        Prix réel
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(option.totalDuration)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Euro className="h-3 w-3" />
                      {option.totalPrice}€
                    </span>
                    <span className="flex items-center gap-1">
                      <Leaf className="h-3 w-3" />
                      {option.totalCO2}kg
                    </span>
                  </div>
                </div>

                {/* Score + check */}
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-white text-xs font-bold"
                    style={{ backgroundColor: option.score >= 7 ? '#22C55E' : option.score >= 5 ? '#F59E0B' : '#EF4444' }}
                  >
                    <Star className="h-2.5 w-2.5" />
                    {option.score.toFixed(1)}
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Booking link for selected */}
        {selected.bookingUrl && (
          <div className="p-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                window.open(selected.bookingUrl, '_blank');
              }}
            >
              <ExternalLink className="h-3 w-3" />
              Réserver ({MODE_LABELS[selected.mode]})
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
