'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { useAuth } from '@/components/auth';
import { Map, Plus, MapPin, Calendar, Users, Wallet, Loader2, Globe, Lock, Users2 } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

interface TripSummary {
  id: string;
  name: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  visibility: 'public' | 'friends' | 'private';
  created_at: string;
  data: any;
  preferences: any;
}

const VISIBILITY_ICONS: Record<string, React.ReactNode> = {
  public: <Globe className="w-3 h-3" />,
  friends: <Users2 className="w-3 h-3" />,
  private: <Lock className="w-3 h-3" />,
};

export default function TripsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?redirect=/v2/trips');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    async function fetchTrips() {
      if (!user) return;
      try {
        const response = await fetch('/api/trips');
        if (response.ok) {
          const data = await response.json();
          setTrips(data);
        }
      } catch (e) {
        console.error('Erreur chargement des voyages:', e);
      } finally {
        setIsLoading(false);
      }
    }
    if (user) fetchTrips();
  }, [user]);

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const handleTripClick = (trip: TripSummary) => {
    // Cache le trip dans localStorage pour un chargement rapide
    if (trip.data) {
      const tripObj = typeof trip.data === 'object'
        ? { ...trip.data, id: trip.id }
        : trip;
      localStorage.setItem('currentTrip', JSON.stringify(tripObj));
    }
    router.push(`/v2/trip/${trip.id}`);
  };

  if (authLoading || isLoading) {
    return (
      <V2Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </V2Layout>
    );
  }

  return (
    <V2Layout>
      <div className="min-h-screen p-4 pt-12 pb-24 safe-area-top">
        <h1 className="text-2xl font-bold text-white mb-6">Mes Voyages</h1>

        {trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-full bg-[#1a1a24] flex items-center justify-center mb-4">
              <Map className="w-10 h-10 text-gray-500" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">
              Pas encore de voyages
            </h2>
            <p className="text-gray-400 text-center mb-6 max-w-xs">
              Commence à planifier ton premier voyage avec l&apos;aide de l&apos;IA
            </p>
            <Link
              href="/v2/create"
              className="flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-medium"
            >
              <Plus className="w-5 h-5" />
              Créer un voyage
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {trips.map((trip, index) => (
              <motion.button
                key={trip.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => handleTripClick(trip)}
                className="w-full bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4 text-left hover:border-indigo-500/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-white font-semibold text-lg">
                      {trip.title || trip.name}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-sm text-gray-400">{trip.destination}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-gray-500 text-xs bg-[#1a1a24] px-2 py-1 rounded-lg">
                    {VISIBILITY_ICONS[trip.visibility] || VISIBILITY_ICONS.private}
                    <span className="capitalize">{trip.visibility === 'public' ? 'Public' : trip.visibility === 'friends' ? 'Amis' : 'Privé'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(trip.start_date)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>{trip.duration_days}j</span>
                  </div>
                  {trip.preferences?.groupSize && (
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      <span>{trip.preferences.groupSize}</span>
                    </div>
                  )}
                  {trip.preferences?.budgetLevel && (
                    <div className="flex items-center gap-1.5">
                      <Wallet className="w-3.5 h-3.5" />
                      <span className="capitalize">{trip.preferences.budgetLevel}</span>
                    </div>
                  )}
                </div>
              </motion.button>
            ))}

            <Link
              href="/v2/create"
              className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl border-2 border-dashed border-[#2a2a38] text-gray-400 hover:border-indigo-500/50 hover:text-indigo-400 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Nouveau voyage
            </Link>
          </div>
        )}
      </div>
    </V2Layout>
  );
}
