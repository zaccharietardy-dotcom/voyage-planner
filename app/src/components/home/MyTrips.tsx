'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { MapPin, Calendar, ChevronRight, LogIn } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Button } from '@/components/ui/button';

interface TripSummary {
  id: string;
  destination?: string;
  title?: string;
  startDate?: string;
  durationDays?: number;
  imageUrl?: string;
}

const PRESET_IMAGES: Record<string, string> = {
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=300&h=200&fit=crop',
  'Barcelona': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=300&h=200&fit=crop',
  'Tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=300&h=200&fit=crop',
  'Rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=300&h=200&fit=crop',
  'Amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=300&h=200&fit=crop',
  'London': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=300&h=200&fit=crop',
  'New York': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=300&h=200&fit=crop',
  'Lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=300&h=200&fit=crop',
  'Marrakech': 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=300&h=200&fit=crop',
  'Nice': 'https://images.unsplash.com/photo-1491166617655-0723a0999cfc?w=300&h=200&fit=crop',
  'Madrid': 'https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=300&h=200&fit=crop',
};

function getImageForDestination(destination?: string): string {
  if (!destination) return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=300&h=200&fit=crop';
  for (const [city, url] of Object.entries(PRESET_IMAGES)) {
    if (destination.toLowerCase().includes(city.toLowerCase())) return url;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=300&h=200&fit=crop';
}

export function MyTrips() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchTrips = async () => {
      try {
        const res = await fetch('/api/trips');
        if (res.ok) {
          const data = await res.json();
          const mapped = (data.trips || data || []).slice(0, 5).map((t: Record<string, unknown>) => ({
            id: t.id as string,
            destination: (t.destination as string) || (t.preferences as Record<string, string>)?.destination,
            title: t.title as string,
            startDate: (t.preferences as Record<string, string>)?.startDate || (t.start_date as string),
            durationDays: (t.preferences as Record<string, number>)?.durationDays || (t.duration_days as number),
          }));
          setTrips(mapped);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    };

    fetchTrips();
  }, [user]);

  if (!user) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-4">Mes voyages</h2>
        <div className="rounded-2xl border border-border/60 bg-card/80 p-6 text-center">
          <LogIn className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-3">Connectez-vous pour retrouver vos voyages</p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/login">Se connecter</Link>
          </Button>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-4">Mes voyages</h2>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (trips.length === 0) {
    return (
      <section>
        <h2 className="text-lg font-semibold mb-4">Mes voyages</h2>
        <div className="rounded-2xl border border-border/60 bg-card/80 p-6 text-center">
          <MapPin className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-3">Aucun voyage pour le moment</p>
          <Button size="sm" asChild>
            <Link href="/plan">Créer un voyage</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Mes voyages</h2>
        <Link href="/mes-voyages" className="text-xs text-primary font-medium">
          Voir tout
        </Link>
      </div>
      <div className="space-y-2.5">
        {trips.map((trip) => {
          const imageUrl = getImageForDestination(trip.destination);
          const dateStr = trip.startDate
            ? format(new Date(trip.startDate), 'd MMM yyyy', { locale: fr })
            : '';

          return (
            <Link
              key={trip.id}
              href={`/trip/${trip.id}`}
              className="group flex items-center gap-3 rounded-2xl border border-border/50 bg-card/80 p-2.5 transition-all hover:shadow-soft hover:border-primary/20 active:scale-[0.99]"
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl">
                <img
                  src={imageUrl}
                  alt={trip.destination || 'Trip'}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {trip.title || trip.destination || 'Voyage'}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  {dateStr && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {dateStr}
                    </span>
                  )}
                  {trip.durationDays && (
                    <span>{trip.durationDays}j</span>
                  )}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
