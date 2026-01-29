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
  ChevronDown,
  ChevronUp,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

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

function ScoreBar({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-12">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score * 10}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-medium w-6 text-right">{score.toFixed(1)}</span>
    </div>
  );
}

function TransportOptionCard({
  option,
  isSelected,
  isExpanded,
  onToggleExpand,
  onSelect,
}: {
  option: TransportOptionSummary;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect?: () => void;
}) {
  const Icon = MODE_ICONS[option.mode] || Plane;
  const color = MODE_COLORS[option.mode] || '#666';

  return (
    <Card
      className={cn(
        'p-4 cursor-pointer transition-all hover:shadow-md',
        isSelected && 'ring-2 ring-primary',
        option.recommended && !isSelected && 'ring-1 ring-green-500'
      )}
      onClick={onToggleExpand}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: `${color}15`, color }}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{MODE_LABELS[option.mode]}</span>
              {option.recommended && (
                <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                  Recommandé
                </Badge>
              )}
              {isSelected && (
                <Badge className="bg-primary text-primary-foreground text-xs">
                  <Check className="h-3 w-3 mr-1" />
                  Sélectionné
                </Badge>
              )}
              {option.dataSource === 'api' && (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-xs">
                  Prix réel
                </Badge>
              )}
              {option.dataSource === 'estimated' && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                  Estimé
                </Badge>
              )}
            </div>
            {option.recommendationReason && (
              <p className="text-xs text-muted-foreground">{option.recommendationReason}</p>
            )}
          </div>
        </div>

        {/* Score badge */}
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 px-2 py-1 rounded-full text-white font-bold text-sm"
            style={{ backgroundColor: option.score >= 7 ? '#22C55E' : option.score >= 5 ? '#F59E0B' : '#EF4444' }}
          >
            <Star className="h-3 w-3" />
            {option.score.toFixed(1)}
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex items-center gap-4 mt-3 text-sm">
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{formatDuration(option.totalDuration)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Euro className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{option.totalPrice}€</span>
        </div>
        <div className="flex items-center gap-1">
          <Leaf className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{option.totalCO2} kg CO₂</span>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t space-y-4">
          {/* Score breakdown */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase">Scores détaillés</p>
            <ScoreBar score={option.scoreDetails.priceScore} label="Prix" color="#22C55E" />
            <ScoreBar score={option.scoreDetails.timeScore} label="Temps" color="#3B82F6" />
            <ScoreBar score={option.scoreDetails.co2Score} label="CO₂" color="#10B981" />
          </div>

          {/* Segments */}
          {option.segments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase">Itinéraire</p>
              <div className="space-y-2">
                {option.segments.map((segment, idx) => {
                  const SegmentIcon = MODE_ICONS[segment.mode] || Plane;
                  return (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <SegmentIcon className="h-4 w-4 text-muted-foreground" />
                      <span>{segment.from} → {segment.to}</span>
                      <span className="text-muted-foreground">({formatDuration(segment.duration)})</span>
                      {segment.operator && (
                        <Badge variant="outline" className="text-xs">{segment.operator}</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            {option.bookingUrl && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(option.bookingUrl, '_blank');
                }}
              >
                <ExternalLink className="h-3 w-3" />
                Réserver
              </Button>
            )}
            {onSelect && !isSelected && (
              <Button
                size="sm"
                className="gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect();
                }}
              >
                <Check className="h-3 w-3" />
                Choisir
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function TransportOptions({
  options,
  selectedId,
  onSelect,
  className,
}: TransportOptionsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(
    options.find(o => o.recommended)?.id || options[0]?.id || null
  );

  if (options.length === 0) {
    return (
      <Card className={cn('p-4', className)}>
        <p className="text-muted-foreground text-center">Aucune option de transport disponible</p>
      </Card>
    );
  }

  // Sort by score descending
  const sortedOptions = [...options].sort((a, b) => b.score - a.score);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Options de transport</h3>
        <span className="text-xs text-muted-foreground">{options.length} options comparées</span>
      </div>

      {sortedOptions.map((option) => (
        <TransportOptionCard
          key={option.id}
          option={option}
          isSelected={option.id === selectedId}
          isExpanded={option.id === expandedId}
          onToggleExpand={() => setExpandedId(expandedId === option.id ? null : option.id)}
          onSelect={onSelect ? () => onSelect(option) : undefined}
        />
      ))}

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-2">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>Score ≥ 7</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span>Score 5-7</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>Score &lt; 5</span>
        </div>
      </div>
    </div>
  );
}
