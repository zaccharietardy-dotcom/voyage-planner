'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth';
import { getSupabaseClient, Trip } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, MapPin, Calendar, Users, Plane, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

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
      if (!user) return;

      const supabase = getSupabaseClient();

      // Get trips where user is owner or member
      const { data: memberTrips } = await supabase
        .from('trip_members')
        .select('trip_id')
        .eq('user_id', user.id);

      const tripIds = memberTrips?.map((m) => m.trip_id) || [];

      if (tripIds.length > 0) {
        const { data: tripsData } = await supabase
          .from('trips')
          .select('*')
          .in('id', tripIds)
          .order('created_at', { ascending: false });

        setTrips(tripsData || []);
      }

      setIsLoading(false);
    }

    if (user) {
      fetchTrips();
    }
  }, [user]);

  if (authLoading || isLoading) {
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

        {trips.length === 0 ? (
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
              const tripData = trip.data as any;
              return (
                <Link key={trip.id} href={`/trip/${trip.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{trip.title}</CardTitle>
                          <CardDescription className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {trip.destination}
                          </CardDescription>
                        </div>
                        {tripData?.outboundFlight && (
                          <div className="text-right text-sm text-muted-foreground">
                            <Plane className="h-4 w-4 inline mr-1" />
                            {tripData.outboundFlight.airline}
                          </div>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(new Date(trip.start_date), 'd MMM yyyy', { locale: fr })}
                        </span>
                        <span>
                          {trip.duration_days} jour{trip.duration_days > 1 ? 's' : ''}
                        </span>
                        {tripData?.preferences?.groupSize && (
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            {tripData.preferences.groupSize} pers.
                          </span>
                        )}
                        {tripData?.totalEstimatedCost && (
                          <span className="ml-auto font-medium text-foreground">
                            {Math.round(tripData.totalEstimatedCost)}€
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
