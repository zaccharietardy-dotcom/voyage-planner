'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, AlertTriangle, Lightbulb, Sparkles } from 'lucide-react';
import { Trip } from '@/lib/types';
import { UserPreferences } from '@/lib/supabase/types';
import { personalizeTrip } from '@/lib/services/styleRecommendations';
import { cn } from '@/lib/utils';

interface TripPersonalizationInsightsProps {
  trip: Trip;
  preferences: UserPreferences;
  className?: string;
}

export function TripPersonalizationInsights({
  trip,
  preferences,
  className,
}: TripPersonalizationInsightsProps) {
  const insights = useMemo(
    () => personalizeTrip(trip, preferences),
    [trip, preferences]
  );

  const { suggestions, warnings, strengths } = insights;

  const hasInsights = suggestions.length > 0 || warnings.length > 0 || strengths.length > 0;

  if (!hasInsights) {
    return null;
  }

  return (
    <Card className={cn('border-primary/20', className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Insights personnalisés</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Strengths */}
        {strengths.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Points forts</span>
            </div>
            <div className="space-y-1.5">
              {strengths.map((strength, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground bg-green-50 dark:bg-green-950/20 p-2.5 rounded-lg"
                >
                  <div className="flex-shrink-0 w-1 h-1 bg-green-500 rounded-full mt-2" />
                  <span>{strength}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-orange-700 dark:text-orange-400">
              <AlertTriangle className="h-4 w-4" />
              <span>Points d&apos;attention</span>
            </div>
            <div className="space-y-1.5">
              {warnings.map((warning, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground bg-orange-50 dark:bg-orange-950/20 p-2.5 rounded-lg"
                >
                  <div className="flex-shrink-0 w-1 h-1 bg-orange-500 rounded-full mt-2" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-400">
              <Lightbulb className="h-4 w-4" />
              <span>Suggestions</span>
            </div>
            <div className="space-y-1.5">
              {suggestions.map((suggestion, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/20 p-2.5 rounded-lg"
                >
                  <div className="flex-shrink-0 w-1 h-1 bg-blue-500 rounded-full mt-2" />
                  <span>{suggestion}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer note */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground italic">
            Ces insights sont générés automatiquement en fonction de vos préférences de voyage.
            Vous pouvez les ignorer ou les appliquer via le chatbot.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
