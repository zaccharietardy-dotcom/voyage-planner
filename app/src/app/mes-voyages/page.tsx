'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth';
import { getSupabaseClient, Trip } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, MapPin, Calendar, Users, Plane, Loader2, Globe, Lock, Users2, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type TripVisibility = 'public' | 'friends' | 'private';

const VISIBILITY_OPTIONS: { value: TripVisibility; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'public', label: 'Public', icon: <Globe className="h-4 w-4" />, description: 'Visible par tous' },
  { value: 'friends', label: 'Amis', icon: <Users2 className="h-4 w-4" />, description: 'Visible par mes amis' },
  { value: 'private', label: 'Privé', icon: <Lock className="h-4 w-4" />, description: 'Visible par moi seul' },
];

export default function MesVoyagesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

      try {
        // Use API route (server-side) to avoid RLS issues
        const res = await fetch('/api/trips');
        if (!res.ok) {
          console.error('Error fetching trips:', res.status, await res.text());
          setTrips([]);
          return;
        }
        const tripsData = await res.json();
        setTrips(tripsData || []);
      } catch (error) {
        console.error('Error fetching trips:', error);
      } finally {
        setIsLoading(false);
      }
    }

    // Ne fetch que quand authLoading est terminé
    if (!authLoading) {
      fetchTrips();
    }
  }, [user, authLoading]);

  const updateVisibility = async (tripId: string, visibility: TripVisibility) => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('trips')
      .update({ visibility })
      .eq('id', tripId);

    if (error) {
      console.error('Error updating visibility:', error);
      toast.error('Erreur lors de la mise à jour de la visibilité');
      return;
    }

    // Update local state
    setTrips(prev =>
      prev.map(trip =>
        trip.id === tripId ? { ...trip, visibility } : trip
      )
    );

    const option = VISIBILITY_OPTIONS.find(o => o.value === visibility);
    toast.success(`Voyage maintenant ${option?.label.toLowerCase()}`);
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
            <h1 className="text-2xl font-bold">Mes voyages</h1>
            <p className="text-muted-foreground">
              Retrouvez tous vos voyages planifiés
            </p>
          </div>
          <Button asChild>
            <Link href="/plan">
              <Plus className="h-4 w-4 mr-2" />
              Nouveau voyage
            </Link>
          </Button>
        </div>

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
              <h3 className="text-lg font-semibold mb-2">Aucun voyage</h3>
              <p className="text-muted-foreground mb-4">
                Vous n'avez pas encore planifié de voyage.
              </p>
              <Button asChild>
                <Link href="/plan">
                  <Plus className="h-4 w-4 mr-2" />
                  Planifier mon premier voyage
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {trips.map((trip) => {
              const tripData = trip.data as Record<string, unknown>;
              const prefs = (trip.preferences || tripData?.preferences || {}) as Record<string, unknown>;
              const visibility = (trip as Trip & { visibility?: TripVisibility }).visibility || 'private';
              const visibilityOption = VISIBILITY_OPTIONS.find(o => o.value === visibility) || VISIBILITY_OPTIONS[2];

              return (
                <Card key={trip.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <Link href={`/trip/${trip.id}`} className="flex-1">
                        <CardTitle className="text-lg hover:text-primary transition-colors">
                          {trip.title}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {trip.destination}
                        </CardDescription>
                      </Link>
                      <div className="flex items-center gap-2">
                        {/* Visibility dropdown */}
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
                      </div>
                    </div>
                  </CardHeader>
                  <Link href={`/trip/${trip.id}`}>
                    <CardContent className="cursor-pointer">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(trip.start_date), 'd MMM yyyy', { locale: fr })}
                        </span>
                        <span>
                          {trip.duration_days} jour{trip.duration_days > 1 ? 's' : ''}
                        </span>
                        {prefs.groupSize ? (
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            {String(prefs.groupSize)} pers.
                          </span>
                        ) : null}
                        {prefs.budgetLevel ? (
                          <Badge variant="outline" className="ml-auto">
                            {prefs.budgetLevel === 'budget' ? 'Économique' : prefs.budgetLevel === 'moderate' ? 'Modéré' : prefs.budgetLevel === 'comfort' ? 'Confort' : 'Luxe'}
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
