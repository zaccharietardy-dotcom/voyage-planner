'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, MapPin, ChevronDown, ChevronUp, AlertCircle, Navigation } from 'lucide-react';
import { LiveTripState } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getTimeUntilNext } from '@/lib/services/liveTripService';
import { Trip } from '@/lib/types';

interface LiveTripBannerProps {
  liveState: LiveTripState;
  trip: Trip;
  onShowMap?: () => void;
  onReportIssue?: () => void;
}

export function LiveTripBanner({
  liveState,
  trip,
  onShowMap,
  onReportIssue,
}: LiveTripBannerProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const timeUntilNext = getTimeUntilNext(trip);

  // Calculer la progression de l'activité en cours
  const activityProgress = liveState.currentActivity
    ? calculateActivityProgress(liveState.currentActivity.startTime, liveState.currentActivity.endTime)
    : 0;

  return (
    <motion.div
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-4xl px-4"
    >
      <div className="relative">
        {/* Animated gradient border */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500 via-blue-500 to-purple-500 opacity-75 blur-sm animate-pulse" />

        <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-purple-200 dark:border-purple-800 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950 dark:to-blue-950">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Voyage en cours</h3>
                <p className="text-sm text-muted-foreground">
                  Jour {liveState.currentDay} • {trip.preferences?.destination}
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="ml-2"
            >
              {isExpanded ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </Button>
          </div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="p-4 space-y-4">
                  {/* Current Activity */}
                  {liveState.currentActivity ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="default" className="bg-green-500 text-white">
                          En cours
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {liveState.currentActivity.startTime} - {liveState.currentActivity.endTime}
                        </span>
                      </div>

                      <div>
                        <h4 className="font-semibold text-lg">
                          {liveState.currentActivity.title}
                        </h4>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <MapPin className="w-4 h-4" />
                          <span>{liveState.currentActivity.locationName}</span>
                        </div>
                      </div>

                      <Progress value={activityProgress} className="h-2" />
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground py-4">
                      <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>Pas d&apos;activité en cours</p>
                    </div>
                  )}

                  {/* Next Activity */}
                  {liveState.nextActivity && (
                    <div className="border-t pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-blue-500" />
                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                          Ensuite
                        </span>
                        {timeUntilNext !== null && (
                          <span className="text-sm text-muted-foreground">
                            dans {formatTimeUntil(timeUntilNext)}
                          </span>
                        )}
                      </div>

                      <div className="pl-6">
                        <p className="font-medium">{liveState.nextActivity.title}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <span>{liveState.nextActivity.startTime}</span>
                          <span>•</span>
                          <span>{liveState.nextActivity.locationName}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex gap-2 border-t pt-4">
                    {onShowMap && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onShowMap}
                        className="flex-1"
                      >
                        <Navigation className="w-4 h-4 mr-2" />
                        Voir sur la carte
                      </Button>
                    )}
                    {onReportIssue && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onReportIssue}
                        className="flex-1"
                      >
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Signaler un problème
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Calcule la progression d'une activité en cours (0-100)
 */
function calculateActivityProgress(startTime: string, endTime: string): number {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);

  const startTotalMinutes = startHours * 60 + startMinutes;
  const endTotalMinutes = endHours * 60 + endMinutes;

  const totalDuration = endTotalMinutes - startTotalMinutes;
  const elapsed = currentMinutes - startTotalMinutes;

  return Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));
}

/**
 * Formate le temps restant en texte lisible
 */
function formatTimeUntil(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h${remainingMinutes.toString().padStart(2, '0')}`;
}
