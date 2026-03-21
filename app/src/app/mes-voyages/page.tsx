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

const DESTINATION_IMAGES: Record<string, string> = {
  'paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&h=300&fit=crop',
  'tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=300&fit=crop',
  'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=600&h=300&fit=crop',
  'london': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&h=300&fit=crop',
  'londres': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&h=300&fit=crop',
  'rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&h=300&fit=crop',
  'barcelone': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=600&h=300&fit=crop',
  'lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=600&h=300&fit=crop',
  'amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=600&h=300&fit=crop',
  'marrakech': 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=600&h=300&fit=crop',
  'madrid': 'https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=600&h=300&fit=crop',
};

function getDestinationImage(destination: string): string {
  const normalized = destination.toLowerCase();
  for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
    if (normalized.includes(key)) return url;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&h=300&fit=crop';
}

function getTripStatus(startDate: string, durationDays: number): { label: string; color: string } {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + durationDays);
  const now = new Date();

  if (now < start) return { label: '\u00c0 venir', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
  if (now >= start && now <= end) return { label: 'En cours', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
  return { label: 'Pass\u00e9', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' };
}

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

    // Ne fetch que quand authLoading est termin\u00e9
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
  // Une fois l'auth termin\u00e9e, on affiche la page m\u00eame si les trips chargent encore
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Si pas connect\u00e9 apr\u00e8s le chargement de l'auth, ne rien afficher (la redirection va se faire)
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-serif font-bold">{t('myTrips.title')}</h1>
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
              R\u00e9essayer
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
          <div className="grid gap-6 md:grid-cols-2">
            {trips.map((trip) => {
              const tripData = trip.data as Record<string, unknown>;
              const prefs = (trip.preferences || tripData?.preferences || {}) as Record<string, unknown>;
              const isPastTrip = prefs.tripType === 'past';
              const visibility = (trip as Trip & { visibility?: TripVisibility }).visibility || 'private';
              const visibilityOption = VISIBILITY_OPTIONS.find(o => o.value === visibility) || VISIBILITY_OPTIONS[2];
              const userRole = trip.userRole || 'owner';
              const isInvitedTrip = userRole !== 'owner' || trip.isInvited === true;
              const status = getTripStatus(trip.start_date, trip.duration_days);

              return (
                <Card key={trip.id} className="overflow-hidden hover:shadow-lg transition-shadow group">
                  {/* Destination photo */}
                  <Link href={`/trip/${trip.id}`}>
                    <div className="relative h-40 overflow-hidden">
                      <img
                        src={getDestinationImage(trip.destination)}
                        alt={trip.destination}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                      <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-white font-serif text-xl font-bold">{trip.title}</h3>
                            {isInvitedTrip && (
                              <Badge variant="outline" className="text-xs bg-white/20 text-white border-white/30">
                                {t('myTrips.invited')} {userRole === 'editor' ? `\u00b7 ${t('myTrips.editor')}` : `\u00b7 ${t('myTrips.reader')}`}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 text-white/80 text-sm">
                            <MapPin className="h-3.5 w-3.5" />
                            {trip.destination}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isPastTrip && (
                            <Badge variant="secondary" className="text-xs">
                              <Camera className="h-3 w-3 mr-1" />
                              {t('myTrips.journal')}
                            </Badge>
                          )}
                          <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', status.color)}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>

                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-lg font-semibold">
                          {format(new Date(trip.start_date), 'd MMM yyyy', { locale: dateFnsLocales[locale as keyof typeof dateFnsLocales] || fr })}
                        </span>
                        <span className="text-muted-foreground">
                          {trip.duration_days} {trip.duration_days > 1 ? t('common.days') : t('common.day')}
                        </span>
                        {!isPastTrip && prefs.groupSize ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            {String(prefs.groupSize)}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        {/* Visibility dropdown (owner only) */}
                        {userRole === 'owner' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="gap-1 h-8">
                                {visibilityOption.icon}
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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
