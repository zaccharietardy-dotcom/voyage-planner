'use client';

import { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Camera, Loader2, MapPin, Route } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { GlobeWaypoint, Traveler, TripArc } from '@/lib/globe/types';

const CesiumGlobe = dynamic(
  () => import('@/components/globe/CesiumGlobe').then((mod) => mod.CesiumGlobe),
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
  owner?: { display_name: string; avatar_url: string; username: string } | null;
  points: GlobeWaypoint[];
  cover_url: string | null;
}

const ARC_COLORS = ['#f59e0b', '#38bdf8', '#34d399', '#f97316', '#a78bfa', '#f43f5e'];

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function calculateKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat))
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return r * c;
}

function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return ARC_COLORS[Math.abs(hash) % ARC_COLORS.length];
}

function isValidPoint(point: GlobeWaypoint | null | undefined): point is GlobeWaypoint {
  if (!point) return false;
  return Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90
    && Math.abs(point.lng) <= 180;
}

export default function GlobePage() {
  const router = useRouter();
  const { user } = useAuth();

  const [globeTrips, setGlobeTrips] = useState<GlobeTrip[]>([]);
  const [travelers, setTravelers] = useState<Traveler[]>([]);
  const [arcs, setArcs] = useState<TripArc[]>([]);
  const [selectedTraveler, setSelectedTraveler] = useState<Traveler | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<GlobeWaypoint | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/cesium/Widgets/widgets.css';
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  useEffect(() => {
    fetchGlobeData();
  }, [user]);

  const fetchGlobeData = async () => {
    try {
      const res = await fetch('/api/globe');
      if (!res.ok) return;

      const data = await res.json();
      const trips: GlobeTrip[] = (data.trips || [])
        .map((trip: GlobeTrip) => ({
          ...trip,
          points: (trip.points || []).filter(isValidPoint),
        }))
        .filter((trip: GlobeTrip) => trip.points.length > 0);

      setGlobeTrips(trips);

      const newTravelers: Traveler[] = [];
      const newArcs: TripArc[] = [];

      trips.forEach((trip) => {
        const routePoints = trip.points;
        const mainPoint = routePoints.find((point) => point.type === 'destination') || routePoints[0];
        if (!mainPoint) return;

        newTravelers.push({
          id: trip.id,
          name: trip.title || trip.destination,
          avatar: trip.owner?.avatar_url || '',
          location: {
            lat: mainPoint.lat,
            lng: mainPoint.lng,
            name: trip.destination || mainPoint.name,
            country: '',
          },
          tripDates: '',
          rating: 0,
          itinerary: routePoints.slice(0, 8).map((point) => point.name),
          routePoints,
          destination: trip.destination,
          ownerName: trip.owner?.display_name || trip.owner?.username || '',
          isOnline: false,
          imageUrl: trip.cover_url || undefined,
        });

        for (let i = 0; i < routePoints.length - 1; i += 1) {
          const from = routePoints[i];
          const to = routePoints[i + 1];
          const distanceKm = calculateKm(from, to);
          if (distanceKm < 0.08) continue;

          newArcs.push({
            id: `${trip.id}-arc-${i}`,
            travelerId: trip.id,
            from: { lat: from.lat, lng: from.lng, name: from.name },
            to: { lat: to.lat, lng: to.lng, name: to.name },
            color: colorFromId(trip.id),
            distanceKm,
            isLongHaul: distanceKm > 1200,
          });
        }
      });

      setTravelers(newTravelers);
      setArcs(newArcs);

      setSelectedTraveler((prev) => {
        if (!newTravelers.length) return null;
        if (!prev) return newTravelers[0];
        return newTravelers.find((traveler) => traveler.id === prev.id) || newTravelers[0];
      });
    } catch (e) {
      console.error('Globe data error:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleTravelerSelect = useCallback((traveler: Traveler | null) => {
    setSelectedTraveler(traveler);
    setSelectedWaypoint(null);
  }, []);

  const selectedTrip = useMemo(() => {
    if (!selectedTraveler) return null;
    return globeTrips.find((trip) => trip.id === selectedTraveler.id) || null;
  }, [globeTrips, selectedTraveler]);

  useEffect(() => {
    if (!selectedTrip) {
      setSelectedWaypoint(null);
      return;
    }

    if (selectedWaypoint && !selectedTrip.points.some((point) => point.id === selectedWaypoint.id)) {
      setSelectedWaypoint(null);
    }
  }, [selectedTrip, selectedWaypoint]);

  const selectTripById = (tripId: string) => {
    const traveler = travelers.find((candidate) => candidate.id === tripId);
    if (!traveler) return;
    setSelectedTraveler(traveler);
    setSelectedWaypoint(null);
  };

  const selectedTripPhotoPoints = useMemo(() => {
    if (!selectedTrip) return [];
    return selectedTrip.points.filter((point) => point.imageUrl).slice(0, 8);
  }, [selectedTrip]);

  const selectedTripTotalDistance = useMemo(() => {
    if (!selectedTrip) return 0;
    return arcs
      .filter((arc) => arc.travelerId === selectedTrip.id)
      .reduce((sum, arc) => sum + (arc.distanceKm || 0), 0);
  }, [arcs, selectedTrip]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="flex items-center gap-4 px-4 py-3 border-b bg-background/95 backdrop-blur z-20">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/explore">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Globe</h1>
          <p className="text-xs text-muted-foreground">
            {globeTrips.length} voyage{globeTrips.length > 1 ? 's' : ''} et leurs itinéraires
          </p>
        </div>
      </div>

      <div className="flex-1 relative">
        {!loading && (
          <Suspense
            fallback={(
              <div className="w-full h-full flex items-center justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
            )}
          >
            <CesiumGlobe
              travelers={travelers}
              arcs={arcs}
              selectedTraveler={selectedTraveler}
              selectedTripPoints={selectedTrip?.points || []}
              selectedWaypointId={selectedWaypoint?.id || null}
              onTravelerSelect={handleTravelerSelect}
              onWaypointSelect={setSelectedWaypoint}
            />
          </Suspense>
        )}

        {user && globeTrips.length > 0 && (
          <>
            <div className="hidden md:block absolute left-4 top-4 z-20 w-[330px] max-h-[calc(100%-2rem)] overflow-hidden rounded-2xl border bg-background/92 backdrop-blur-xl shadow-xl">
              <div className="p-3 border-b">
                <p className="text-sm font-semibold">Voyages de tes amis</p>
                <p className="text-xs text-muted-foreground">Clique pour centrer le globe et afficher la route</p>
              </div>
              <div className="max-h-[420px] overflow-y-auto p-2 space-y-2">
                {globeTrips.map((trip) => {
                  const isActive = trip.id === selectedTrip?.id;
                  const stopCount = trip.points.length;
                  const owner = trip.owner?.display_name || trip.owner?.username || 'Voyageur';

                  return (
                    <button
                      key={trip.id}
                      type="button"
                      onClick={() => selectTripById(trip.id)}
                      className={`w-full rounded-xl border p-2 text-left transition-colors ${
                        isActive ? 'border-primary/60 bg-primary/10' : 'hover:bg-accent/50'
                      }`}
                    >
                      <div className="flex gap-2 items-center">
                        {trip.cover_url ? (
                          <img
                            src={trip.cover_url}
                            alt={trip.destination || trip.title}
                            className="h-12 w-12 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="h-12 w-12 rounded-lg bg-muted shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{trip.title || trip.destination}</p>
                          <p className="text-xs text-muted-foreground truncate">{owner}</p>
                          <p className="text-xs text-muted-foreground">{stopCount} étapes</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:hidden absolute top-4 left-4 right-16 z-20 overflow-x-auto">
              <div className="flex gap-2 w-max">
                {globeTrips.map((trip) => (
                  <button
                    key={trip.id}
                    type="button"
                    onClick={() => selectTripById(trip.id)}
                    className={`rounded-full border px-3 py-1 text-xs backdrop-blur ${
                      selectedTrip?.id === trip.id ? 'bg-primary/90 text-primary-foreground' : 'bg-background/85'
                    }`}
                  >
                    {trip.destination || trip.title}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {selectedTrip && (
          <div className="absolute bottom-4 left-4 right-4 z-20 space-y-2">
            <button
              type="button"
              onClick={() => router.push(`/trip/${selectedTrip.id}`)}
              className="w-full bg-background/95 backdrop-blur-xl rounded-2xl border shadow-lg p-3 text-left hover:bg-accent transition-colors"
            >
              <div className="flex gap-3 items-center">
                {selectedTrip.cover_url ? (
                  <img
                    src={selectedTrip.cover_url}
                    alt={selectedTrip.destination}
                    className="w-16 h-16 rounded-xl object-cover shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-muted shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-base mb-1 truncate">
                    {selectedTrip.title || selectedTrip.destination}
                  </h3>
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {selectedTrip.destination}
                    </span>
                    <span className="flex items-center gap-1">
                      <Route className="h-3.5 w-3.5" />
                      {Math.round(selectedTripTotalDistance)} km
                    </span>
                    <span>{selectedTrip.points.length} étapes</span>
                  </div>
                </div>
              </div>
            </button>

            {selectedTripPhotoPoints.length > 0 && (
              <div className="bg-background/95 backdrop-blur-xl rounded-2xl border shadow-lg p-3">
                <p className="text-xs font-medium mb-2 flex items-center gap-1">
                  <Camera className="h-3.5 w-3.5" />
                  Spots photo du voyage
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selectedTripPhotoPoints.map((point) => (
                    <button
                      key={point.id}
                      type="button"
                      onClick={() => setSelectedWaypoint(point)}
                      className={`shrink-0 w-28 rounded-lg border text-left overflow-hidden ${
                        selectedWaypoint?.id === point.id ? 'border-primary' : ''
                      }`}
                    >
                      {point.imageUrl ? (
                        <img
                          src={point.imageUrl}
                          alt={point.name}
                          className="w-full h-16 object-cover"
                        />
                      ) : (
                        <div className="w-full h-16 bg-muted" />
                      )}
                      <div className="p-1.5">
                        <p className="text-[11px] leading-tight overflow-hidden text-ellipsis whitespace-nowrap">{point.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedWaypoint && (
              <div className="bg-background/95 backdrop-blur-xl rounded-xl border shadow-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Point sélectionné</p>
                <p className="text-sm font-medium">{selectedWaypoint.name}</p>
                <p className="text-xs text-muted-foreground">{selectedWaypoint.type}</p>
              </div>
            )}
          </div>
        )}

        {!user && !loading && (
          <div className="absolute bottom-6 left-4 right-4 z-20">
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
