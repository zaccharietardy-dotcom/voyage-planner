'use client';

import { motion } from 'framer-motion';
import {
  Clock,
  MapPin,
  CheckCircle2,
  Circle,
  Navigation,
  Phone,
  Thermometer,
  Activity,
  Car,
  Map,
} from 'lucide-react';
import { LiveTripState, Trip } from '@/lib/types';
import { useTranslation, type TranslationKey } from '@/lib/i18n';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getDayStats } from '@/lib/services/liveTripService';

interface LiveTripDashboardProps {
  liveState: LiveTripState;
  trip: Trip;
  onNavigateToActivity?: (activityId: string) => void;
}

export function LiveTripDashboard({
  liveState,
  trip,
  onNavigateToActivity,
}: LiveTripDashboardProps) {
  const { t } = useTranslation();
  const dayStats = getDayStats(trip);
  const emergencyNumbers = trip.travelTips?.emergency;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Progress Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('dashboard.progress')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{t('dashboard.day').replace('{n}', String(liveState.currentDay))}</span>
                <span className="text-muted-foreground">
                  {t('dashboard.outOf').replace('{n}', String(trip.preferences?.durationDays))}
                </span>
              </div>
              <Progress value={liveState.dayProgress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {t('dashboard.percentComplete').replace('{n}', String(liveState.dayProgress))}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Activities Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('dashboard.activitiesToday')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                <Activity className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dayStats?.activitiesRemaining || 0}</p>
                <p className="text-xs text-muted-foreground">{t('dashboard.remaining')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Distance Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('dashboard.distance')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
                <Map className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{dayStats?.totalDistance || 0} km</p>
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.walkingTime').replace('{n}', String(dayStats?.estimatedWalkingTime || 0))}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('dashboard.yourDay')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {liveState.timeline.map((event, index) => (
                <TimelineItem
                  key={event.id}
                  event={event}
                  isLast={index === liveState.timeline.length - 1}
                  onNavigate={
                    onNavigateToActivity
                      ? () => onNavigateToActivity(event.id)
                      : undefined
                  }
                  t={t}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Right Sidebar */}
        <div className="space-y-6">
          {/* Weather Widget */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Thermometer className="w-4 h-4" />
                {t('dashboard.weather')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-4">
                <div className="text-5xl mb-2">☀️</div>
                <p className="text-2xl font-bold">24°C</p>
                <p className="text-sm text-muted-foreground">{t('dashboard.sunny')}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Min 18° • Max 26°
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Transport Info */}
          {liveState.nextActivity?.transportToPrevious && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Car className="w-4 h-4" />
                  {t('dashboard.nextTrip')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <p className="font-medium">
                    {formatTransportMode(liveState.nextActivity.transportToPrevious, t)}
                  </p>
                  {liveState.nextActivity.timeFromPrevious && (
                    <p className="text-sm text-muted-foreground">
                      {t('dashboard.minutes').replace('{n}', String(liveState.nextActivity.timeFromPrevious))}
                    </p>
                  )}
                  {liveState.nextActivity.distanceFromPrevious && (
                    <p className="text-sm text-muted-foreground">
                      {liveState.nextActivity.distanceFromPrevious.toFixed(1)} km
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Emergency Contacts */}
          {emergencyNumbers && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2 text-red-600 dark:text-red-400">
                  <Phone className="w-4 h-4" />
                  {t('dashboard.emergency')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {emergencyNumbers.generalEmergency && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('dashboard.emergencyLabel')}</span>
                      <a
                        href={`tel:${emergencyNumbers.generalEmergency}`}
                        className="font-medium hover:underline"
                      >
                        {emergencyNumbers.generalEmergency}
                      </a>
                    </div>
                  )}
                  {emergencyNumbers.police && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('dashboard.police')}</span>
                      <a
                        href={`tel:${emergencyNumbers.police}`}
                        className="font-medium hover:underline"
                      >
                        {emergencyNumbers.police}
                      </a>
                    </div>
                  )}
                  {emergencyNumbers.ambulance && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('dashboard.ambulance')}</span>
                      <a
                        href={`tel:${emergencyNumbers.ambulance}`}
                        className="font-medium hover:underline"
                      >
                        {emergencyNumbers.ambulance}
                      </a>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Composant TimelineItem pour afficher un événement
 */
interface TimelineItemProps {
  event: {
    id: string;
    type: 'activity' | 'transport' | 'meal' | 'free_time';
    title: string;
    startTime: string;
    endTime: string;
    status: 'completed' | 'in_progress' | 'upcoming';
    activity?: any;
  };
  isLast: boolean;
  onNavigate?: () => void;
  t: (key: TranslationKey) => string;
}

function TimelineItem({ event, isLast, onNavigate, t }: TimelineItemProps) {
  const statusConfig = {
    completed: {
      icon: CheckCircle2,
      color: 'text-green-500',
      bgColor: 'bg-green-100 dark:bg-green-900',
      lineColor: 'bg-green-300 dark:bg-green-700',
    },
    in_progress: {
      icon: Circle,
      color: 'text-blue-500 animate-pulse',
      bgColor: 'bg-blue-100 dark:bg-blue-900',
      lineColor: 'bg-blue-300 dark:bg-blue-700',
    },
    upcoming: {
      icon: Circle,
      color: 'text-gray-400',
      bgColor: 'bg-gray-100 dark:bg-gray-800',
      lineColor: 'bg-gray-200 dark:bg-gray-700',
    },
  };

  const config = statusConfig[event.status];
  const Icon = config.icon;

  return (
    <div className="flex gap-4">
      {/* Timeline indicator */}
      <div className="flex flex-col items-center">
        <div className={`p-2 rounded-full ${config.bgColor}`}>
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        {!isLast && <div className={`w-0.5 h-full min-h-[40px] ${config.lineColor}`} />}
      </div>

      {/* Content */}
      <motion.div
        className="flex-1 pb-6"
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {event.startTime}
            </span>
            <Badge variant={event.status === 'in_progress' ? 'default' : 'outline'}>
              {event.status === 'completed' && t('dashboard.status.completed')}
              {event.status === 'in_progress' && t('dashboard.status.inProgress')}
              {event.status === 'upcoming' && t('dashboard.status.upcoming')}
            </Badge>
          </div>
          <span className="text-sm text-muted-foreground">{event.endTime}</span>
        </div>

        <h4 className="font-semibold mb-1">{event.title}</h4>

        {event.activity?.locationName && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <MapPin className="w-3 h-3" />
            <span>{event.activity.locationName}</span>
          </div>
        )}

        {onNavigate && event.status !== 'completed' && (
          <button
            onClick={onNavigate}
            className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-2"
          >
            <Navigation className="w-3 h-3" />
            {t('dashboard.navigate')}
          </button>
        )}
      </motion.div>
    </div>
  );
}

/**
 * Formate le mode de transport
 */
function formatTransportMode(mode: string, t: (key: TranslationKey) => string): string {
  const modeKeys: Record<string, TranslationKey> = {
    walk: 'dashboard.transport.walk',
    car: 'dashboard.transport.car',
    public: 'dashboard.transport.public',
    taxi: 'dashboard.transport.taxi',
    bus: 'dashboard.transport.bus',
    metro: 'dashboard.transport.metro',
    train: 'dashboard.transport.train',
  };

  const key = modeKeys[mode] ?? 'dashboard.transport.default' as const;
  return t(key);
}
