'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sparkles } from 'lucide-react';
import { UserPreferences } from '@/lib/supabase/types';
import { getDestinationMatch } from '@/lib/services/styleRecommendations';
import { cn } from '@/lib/utils';

interface StyleMatchBadgeProps {
  destination: string;
  preferences: UserPreferences;
  className?: string;
  showIcon?: boolean;
}

export function StyleMatchBadge({
  destination,
  preferences,
  className,
  showIcon = true,
}: StyleMatchBadgeProps) {
  const matchData = useMemo(
    () => getDestinationMatch(destination, preferences),
    [destination, preferences]
  );

  const { score, breakdown, explanation } = matchData;

  // Determine color based on score
  const getColorClasses = (score: number) => {
    if (score >= 80) {
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400';
    } else if (score >= 60) {
      return 'bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/20 dark:text-green-400';
    } else if (score >= 50) {
      return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:bg-yellow-500/20 dark:text-yellow-400';
    } else {
      return 'bg-orange-500/10 text-orange-700 border-orange-500/20 dark:bg-orange-500/20 dark:text-orange-400';
    }
  };

  // Render stars for category
  const renderStars = (stars: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <span key={i} className={cn('text-sm', i < stars ? 'text-yellow-500' : 'text-gray-300')}>
        ★
      </span>
    ));
  };

  const categoryLabels: Record<string, string> = {
    culture: 'Culture',
    nature: 'Nature',
    gastronomy: 'Gastronomie',
    beach: 'Plage',
    nightlife: 'Vie nocturne',
    shopping: 'Shopping',
  };

  const categoryEmojis: Record<string, string> = {
    culture: '🏛️',
    nature: '🌿',
    gastronomy: '🍽️',
    beach: '🏖️',
    nightlife: '🍸',
    shopping: '🛍️',
  };

  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <Badge
            variant="secondary"
            className={cn(
              'cursor-help border transition-colors',
              getColorClasses(score),
              className
            )}
          >
            {showIcon && <Sparkles className="h-3 w-3 mr-1" />}
            {score}% compatible
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-72 p-4" sideOffset={8}>
          <div className="space-y-3">
            {/* Title */}
            <div className="font-semibold text-sm border-b pb-2">
              Compatibilité avec vos préférences
            </div>

            {/* Explanation */}
            <p className="text-xs leading-relaxed">{explanation}</p>

            {/* Breakdown */}
            <div className="space-y-2 pt-2 border-t">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Détails par catégorie
              </div>
              {Object.entries(breakdown).map(([category, data]) => (
                <div key={category} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-sm">{categoryEmojis[category]}</span>
                    <span className="text-xs truncate">{categoryLabels[category]}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {renderStars(data.stars)}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer hint */}
            <div className="text-xs text-muted-foreground italic pt-2 border-t">
              Basé sur votre style de voyage et activités préférées
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
