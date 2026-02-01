'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, MapPin, Calendar } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { Traveler, TripArc } from '@/lib/v2/mockData';

const CesiumGlobe = dynamic(
  () => import('@/components/v2/globe/CesiumGlobe').then((mod) => mod.CesiumGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    ),
  }
);

interface GlobeTrip {
  id: string;
  title: string;
  destination: string;
  ownerId: string;
  isOwn: boolean;
  owner?: { display_name: string; avatar_url: string; username: string };
  points: { lat: number; lng: number; name: string; type: string }[];
  photos: any[];
}

export default function GlobePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [globeTrips, setGlobeTrips] = useState<GlobeTrip[]>([]);
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [arcs, setArcs] = useState<TripArc[]>([]);
  const [selectedTraveler, setSelectedTraveler] = useState<Traveler | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load Cesium CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/cesium/Widgets/widgets.css';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  useEffect(() => {
    fetchGlobeData();
  }, [user]);

  const fetchGlobeData = async () => {
    try {
      const res = await fetch('/api/globe');
      if (!res.ok) return;
      const data = await res.json();
      const trips: GlobeTrip[] = data.trips || [];
      setGlobeTrips(trips);

      // Transform trips into Traveler[] format for CesiumGlobe
      const newTravelers: Traveler[] = [];
      const newArcs: TripArc[] = [];

      trips.forEach((trip) => {
        if (trip.points.length === 0) return;

        const mainPoint = trip.points[0];
        newTravelers.push({
          id: trip.id,
          name: trip.title || trip.destination,
          avatar: trip.owner?.avatar_url || '',
          location: {
            lat: mainPoint.lat,
            lng: mainPoint.lng,
            name: trip.destination,
            country: '',
          },
          tripDates: '',
          rating: 0,
          itinerary: [],
          isOnline: false,
        });

        // Create arcs between consecutive points
        for (let i = 0; i < trip.points.length - 1; i++) {
          const from = trip.points[i];
          const to = trip.points[i + 1];
          // Only create arc if points are far enough apart (> ~10km)
          const dist = Math.abs(from.lat - to.lat) + Math.abs(from.lng - to.lng);
          if (dist > 0.1) {
            newArcs.push({
              id: `${trip.id}-arc-${i}`,
              travelerId: trip.id,
              from: { lat: from.lat, lng: from.lng, name: from.name },
              to: { lat: to.lat, lng: to.lng, name: to.name },
            });
          }
        }
      });

      setTravelers(newTravelers);
      setArcs(newArcs);
    } catch (e) {
      console.error('Globe data error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleTravelerSelect = useCallback((traveler: Traveler | null) => {
    setSelectedTraveler(traveler);
  }, []);

  const selectedTrip = selectedTraveler
    ? globeTrips.find(t => t.id === selectedTraveler.id)
    : null;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b bg-background/95 backdrop-blur z-10">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/explore">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Globe</h1>
          <p className="text-xs text-muted-foreground">
            {globeTrips.length} voyage{globeTrips.length > 1 ? 's' : ''} sur la carte
          </p>
        </div>
      </div>

      {/* Globe */}
      <div className="flex-1 relative">
        {!loading && (
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
            </div>
          }>
            <CesiumGlobe
              travelers={travelers}
              arcs={arcs}
              selectedTraveler={selectedTraveler}
              onTravelerSelect={handleTravelerSelect}
            />
          </Suspense>
        )}

        {/* Selected trip overlay */}
        {selectedTrip && (
          <div className="absolute bottom-6 left-4 right-4 z-10">
            <button
              onClick={() => router.push(`/trip/${selectedTrip.id}`)}
              className="w-full bg-background/95 backdrop-blur-xl rounded-xl border shadow-lg p-4 text-left hover:bg-accent transition-colors"
            >
              <h3 className="font-semibold text-base mb-1">
                {selectedTrip.title || selectedTrip.destination}
              </h3>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {selectedTrip.destination}
                </span>
                {selectedTrip.isOwn ? (
                  <span className="text-primary text-xs font-medium">Mon voyage</span>
                ) : selectedTrip.owner?.display_name ? (
                  <span className="text-xs">par {selectedTrip.owner.display_name}</span>
                ) : null}
              </div>
            </button>
          </div>
        )}

        {/* Login prompt */}
        {!user && !loading && (
          <div className="absolute bottom-6 left-4 right-4 z-10">
            <div className="bg-background/95 backdrop-blur-xl rounded-xl border shadow-lg p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Connectez-vous pour voir vos voyages sur le globe
              </p>
              <Button size="sm" asChild>
                <Link href="/login?redirect=/globe">Se connecter</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
