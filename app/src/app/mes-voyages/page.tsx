'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth';
import { Trip } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, MapPin, Calendar, Users, Plane, Loader2, Globe, Lock, Users2, ChevronDown, Camera } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { fr, enUS, es, de, it, pt } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useConnectivity } from '@/hooks/useConnectivity';
import { cacheTripsList, readCachedTripsList } from '@/lib/mobile/offline-cache';
import { useTranslation } from '@/lib/i18n';

type TripVisibility = 'public' | 'friends' | 'private';
type MemberRole = 'owner' | 'editor' | 'viewer';

interface TripListItem extends Trip {
  userRole?: MemberRole;
  isInvited?: boolean;
  member_joined_at?: string | null;
}

const dateFnsLocales = { fr, en: enUS, es, de, it, pt };

export default function MesVoyagesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const { isOffline } = useConnectivity();
  const { t, locale } = useTranslation();

  const VISIBILITY_OPTIONS = useMemo(() => [
    { value: 'public' as TripVisibility, label: t('myTrips.public'), icon: <Globe className="h-4 w-4" />, description: t('myTrips.visibleAll') },
    { value: 'friends' as TripVisibility, label: t('myTrips.friends'), icon: <Users2 className="h-4 w-4" />, description: t('myTrips.visibleFriends') },
    { value: 'private' as TripVisibility, label: t('myTrips.private'), icon: <Lock className="h-4 w-4" />, description: t('myTrips.visibleMe') },
  ], [t]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/mes-voyages');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    async function fetchTrips() {
      if (!user) {
        setIsLoading(false);
        return;
      }

      setError(null);
      try {
        // Use API route (server-side) to avoid RLS issues
        const res = await fetch('/api/trips');
        if (!res.ok) {
          console.error('Error fetching trips:', res.status, await res.text());
          setError('Impossible de charger vos voyages. V\u00e9rifiez votre connexion.');
          const cached = readCachedTripsList<TripListItem>();
          setTrips(cached);
          return;
        }
        const tripsData = await res.json() as TripListItem[];
        setTrips(tripsData || []);
        cacheTripsList<TripListItem>(tripsData || []);
      } catch (err) {
        console.error('Error fetching trips:', err);
        setError('Impossible de charger vos voyages. V\u00e9rifiez votre connexion.');
        const cached = readCachedTripsList<TripListItem>();
        if (cached.length > 0) {
          setTrips(cached);
        }
      } finally {
        setIsLoading(false);
      }
    }

    // Ne fetch que quand authLoading est terminé
    if (!authLoading) {
      fetchTrips();
    }
  }, [user, authLoading, retryCount]);

  const updateVisibility = async (tripId: string, visibility: TripVisibility) => {
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur');
      }

      // Update local state
      setTrips(prev =>
        prev.map(trip =>
          trip.id === tripId ? { ...trip, visibility } : trip
        )
      );

      const option = VISIBILITY_OPTIONS.find(o => o.value === visibility);
      toast.success(`${t('myTrips.nowVisibility')} ${option?.label.toLowerCase()}`);
    } catch (error) {
      console.error('Error updating visibility:', error);
      toast.error(t('myTrips.visibilityError'));
    }
  };

  // Afficher le loader seulement pendant le chargement initial de l'auth
  // Une fois l'auth terminée, on affiche la page même si les trips chargent encore
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Si pas connecté après le chargement de l'auth, ne rien afficher (la redirection va se faire)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">{t('myTrips.title')}</h1>
            <p className="text-muted-foreground">
              {t('myTrips.subtitle')}
            </p>
            {isOffline && (
              <p className="text-xs text-amber-600 mt-2">
                {t('myTrips.offlineNotice')}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/journal/new">
                <Camera className="h-4 w-4 mr-2" />
                {t('myTrips.pastTrip')}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/plan">
                <Plus className="h-4 w-4 mr-2" />
                {t('myTrips.newTrip')}
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(null); setIsLoading(true); setRetryCount(c => c + 1); }} className="ml-4 shrink-0">
              R&eacute;essayer
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="pb-2">
                  <div className="h-5 bg-muted rounded w-1/3" />
                  <div className="h-4 bg-muted rounded w-1/4 mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-4 bg-muted rounded w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : trips.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Plane className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">{t('myTrips.empty')}</h3>
              <p className="text-muted-foreground mb-4">
                {t('myTrips.emptyDesc')}
              </p>
              <Button asChild>
                <Link href="/plan">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('myTrips.planFirst')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {trips.map((trip) => {
              const tripData = trip.data as Record<string, unknown>;
              const prefs = (trip.preferences || tripData?.preferences || {}) as Record<string, unknown>;
              const isPastTrip = prefs.tripType === 'past';
              const visibility = (trip as Trip & { visibility?: TripVisibility }).visibility || 'private';
              const visibilityOption = VISIBILITY_OPTIONS.find(o => o.value === visibility) || VISIBILITY_OPTIONS[2];
              const userRole = trip.userRole || 'owner';
              const isInvitedTrip = userRole !== 'owner' || trip.isInvited === true;

              return (
                <Card key={trip.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <Link href={`/trip/${trip.id}`} className="flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg hover:text-primary transition-colors">
                            {trip.title}
                          </CardTitle>
                          {isInvitedTrip && (
                            <Badge variant="outline" className="text-xs">
                              {t('myTrips.invited')} {userRole === 'editor' ? `· ${t('myTrips.editor')}` : `· ${t('myTrips.reader')}`}
                            </Badge>
                          )}
                          {isPastTrip && (
                            <Badge variant="secondary" className="text-xs">
                              <Camera className="h-3 w-3 mr-1" />
                              {t('myTrips.journal')}
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {trip.destination}
                        </CardDescription>
                      </Link>
                      <div className="flex items-center gap-2">
                        {/* Visibility dropdown (owner only) */}
                        {userRole === 'owner' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="gap-1 h-8">
                                {visibilityOption.icon}
                                <span className="hidden sm:inline text-xs">{visibilityOption.label}</span>
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {VISIBILITY_OPTIONS.map((option) => (
                                <DropdownMenuItem
                                  key={option.value}
                                  onClick={() => updateVisibility(trip.id, option.value)}
                                  className={cn(
                                    'flex items-center gap-2',
                                    visibility === option.value && 'bg-primary/10'
                                  )}
                                >
                                  {option.icon}
                                  <div>
                                    <div className="font-medium">{option.label}</div>
                                    <div className="text-xs text-muted-foreground">{option.description}</div>
                                  </div>
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <Link href={`/trip/${trip.id}`}>
                    <CardContent className="cursor-pointer">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(trip.start_date), 'd MMM yyyy', { locale: dateFnsLocales[locale as keyof typeof dateFnsLocales] || fr })}
                        </span>
                        <span>
                          {trip.duration_days} {trip.duration_days > 1 ? t('common.days') : t('common.day')}
                        </span>
                        {!isPastTrip && prefs.groupSize ? (
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            {String(prefs.groupSize)} {t('common.persons')}
                          </span>
                        ) : null}
                        {!isPastTrip && prefs.budgetLevel ? (
                          <Badge variant="outline" className="ml-auto">
                            {prefs.budgetLevel === 'budget' ? t('plan.budgetLevels.budget') : prefs.budgetLevel === 'moderate' ? t('plan.budgetLevels.moderate') : prefs.budgetLevel === 'comfort' ? t('plan.budgetLevels.comfort') : t('plan.budgetLevels.luxury')}
                          </Badge>
                        ) : null}
                      </div>
                    </CardContent>
                  </Link>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
