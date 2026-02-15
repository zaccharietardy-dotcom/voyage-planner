'use client';

import { useState, useEffect, useMemo } from 'react';
import { Trip, LiveTripState } from '@/lib/types';
import {
  isLiveTrip,
  getCurrentDayNumber,
  getCurrentActivity,
  getNextActivity,
  getDayProgress,
  getTripTimeline,
} from '@/lib/services/liveTripService';

/**
 * Hook React pour gérer l'état d'un voyage en cours
 * Auto-actualisation toutes les minutes
 */
export function useLiveTrip(trip: Trip | null): LiveTripState | null {
  const [, setUpdateTrigger] = useState(0);

  // Force un re-render toutes les minutes
  useEffect(() => {
    const interval = setInterval(() => {
      setUpdateTrigger((prev) => prev + 1);
    }, 60 * 1000); // 60 secondes

    return () => clearInterval(interval);
  }, []);

  // Calcul mémorisé de l'état live
  const liveState = useMemo(() => {
    if (!trip) {
      return null;
    }

    const isLive = isLiveTrip(trip);
    if (!isLive) {
      return null;
    }

    const currentDayNumber = getCurrentDayNumber(trip);
    const currentActivity = getCurrentActivity(trip);
    const nextActivity = getNextActivity(trip);
    const dayProgressData = getDayProgress(trip);
    const timeline = getTripTimeline(trip);

    return {
      isLive: true,
      currentDay: currentDayNumber || 1,
      currentActivity,
      nextActivity,
      dayProgress: dayProgressData?.percentComplete || 0,
      timeline,
    };
  }, [trip]);

  return liveState;
}
