'use client';

import { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Camera, Loader2, MapPin, Route, Globe, Sparkles, Navigation, Layers } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { GlobeWaypoint, Traveler, TripArc } from '@/lib/globe/types';
import type { PhotoCluster } from '@/lib/globe/types';
import { Switch } from '@/components/ui/switch';
import { buildClusterHierarchy, getVisibleClusters, getZoomHeightForLevel } from '@/lib/globe/clusterEngine';
import { cn } from '@/lib/utils';

const CesiumGlobe = dynamic(
  () => import('@/components/globe/CesiumGlobe').then((mod) => mod.CesiumGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-[#020617]">
        <Loader2 className="h-12 w-12 animate-spin text-gold mb-4" />
        <p className="text-gold font-display text-lg tracking-widest animate-pulse">Initialisation du monde...</p>
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

const ARC_COLORS = ['#c5a059', '#dfc28d', '#a37f3d', '#e8c068']; // All variations of gold for premium look

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
  const [showMode, setShowMode] = useState<'my_trips' | 'all_trips'>('all_trips');
  const [cameraHeight, setCameraHeight] = useState(20_000_000);
  const [clusterHierarchy, setClusterHierarchy] = useState<PhotoCluster[]>([]);

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

  const filteredTrips = useMemo(() => {
    if (showMode === 'all_trips') return globeTrips;
    return globeTrips.filter((trip) => trip.ownerId === user?.id);
  }, [globeTrips, showMode, user?.id]);

  // Build cluster hierarchy from filtered trips
  useEffect(() => {
    const tripData = filteredTrips.map((trip) => ({
      id: trip.id,
      destination: trip.destination,
      ownerId: trip.ownerId,
      points: trip.points.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        imageUrl: p.imageUrl || '',
        tripId: trip.id,
        dayNumber: p.dayNumber,
        type: p.type,
      })),
    }));
    setClusterHierarchy(buildClusterHierarchy(tripData));
  }, [filteredTrips]);

  const visibleClusters = useMemo(() => {
    return getVisibleClusters(clusterHierarchy, cameraHeight);
  }, [clusterHierarchy, cameraHeight]);

  const handleClusterClick = useCallback((cluster: PhotoCluster) => {
    const nextHeight = getZoomHeightForLevel(cluster.level);
    setCameraHeight(nextHeight);
    setSelectedTraveler({
      id: `cluster-${cluster.id}`,
      name: cluster.label,
      avatar: '',
      location: { lat: cluster.lat, lng: cluster.lng, name: cluster.label, country: '' },
      tripDates: '',
      rating: 0,
      itinerary: [],
    });
  }, []);

  const handleCameraHeightChange = useCallback((height: number) => {
    setCameraHeight(height);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#020617] overflow-hidden">
      {/* Premium Header */}
      <div className="fixed top-0 left-0 right-0 z-[100] flex items-center gap-6 px-6 py-4 bg-gradient-to-b from-[#020617] to-transparent">
        <Link href="/explore" className="group">
          <div className="h-12 w-12 rounded-xl bg-white/10 backdrop-blur-xl border border-white/10 flex items-center justify-center text-gold group-hover:bg-gold/20 group-hover:border-gold/50 transition-all">
            <ArrowLeft className="h-5 w-5" />
          </div>
        </Link>
        
        <div className="flex-1 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl px-6 py-2 shadow-2xl flex items-center justify-between max-w-2xl">
          <div>
            <h1 className="font-display text-xl font-bold text-white flex items-center gap-2">
              <Globe className="h-5 w-5 text-gold" />
              Narae <span className="text-gold italic">Globe</span>
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              {filteredTrips.length} Itinéraires partagés
            </p>
          </div>

          <div className="flex items-center gap-4 border-l border-white/10 pl-6 ml-6">
            <div className="flex items-center gap-3">
              <span className={cn("text-[9px] font-bold uppercase tracking-widest transition-colors", showMode === 'my_trips' ? "text-gold" : "text-slate-500")}>Mes voyages</span>
              <Switch
                checked={showMode === 'all_trips'}
                onCheckedChange={(checked) => setShowMode(checked ? 'all_trips' : 'my_trips')}
                className="data-[state=checked]:bg-gold"
              />
              <span className={cn("text-[9px] font-bold uppercase tracking-widest transition-colors", showMode === 'all_trips' ? "text-gold" : "text-slate-500")}>Communauté</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Globe Area */}
      <div className="relative flex-1 min-h-0 w-full h-full">
        <Suspense
          fallback={(
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#020617]">
              <Loader2 className="h-12 w-12 animate-spin text-gold mb-4" />
              <p className="text-gold font-display text-lg tracking-widest animate-pulse">Initialisation du monde...</p>
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
            photoClusters={visibleClusters}
            onClusterClick={handleClusterClick}
            onCameraHeightChange={handleCameraHeightChange}
          />
        </Suspense>

        {/* Sidebar: List of trips */}
        <AnimatePresence>
          {user && globeTrips.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="hidden md:block absolute left-6 top-28 z-[90] w-[350px] max-h-[calc(100vh-10rem)]"
            >
              <div className="flex flex-col h-full bg-[#020617]/60 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-white/10">
                  <h2 className="font-display text-xl font-bold text-white mb-1">Explorer</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Cliquez pour centrer le globe</p>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                  {filteredTrips.map((trip) => {
                    const isActive = trip.id === selectedTrip?.id;
                    const stopCount = trip.points.length;
                    const owner = trip.owner?.display_name || trip.owner?.username || 'Voyageur';

                    return (
                      <button
                        key={trip.id}
                        type="button"
                        onClick={() => selectTripById(trip.id)}
                        className={cn(
                          "w-full group rounded-2xl border p-3 text-left transition-all duration-300",
                          isActive 
                            ? "bg-gold-gradient border-white/20 shadow-xl shadow-gold/10" 
                            : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20"
                        )}
                      >
                        <div className="flex gap-4 items-center">
                          <div className="relative h-14 w-14 rounded-xl overflow-hidden shrink-0 border border-white/10 shadow-lg">
                            {trip.cover_url ? (
                              <img src={trip.cover_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full bg-slate-800 flex items-center justify-center text-slate-600">
                                <MapPin className="h-6 w-6" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className={cn("text-sm font-bold truncate", isActive ? "text-[#020617]" : "text-white")}>
                              {trip.title || trip.destination}
                            </p>
                            <p className={cn("text-[10px] font-bold uppercase tracking-widest mt-0.5", isActive ? "text-[#020617]/70" : "text-slate-400")}>
                              {owner}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", isActive ? "bg-[#020617]/10 border-[#020617]/20 text-[#020617]" : "bg-white/5 border-white/10 text-gold")}>
                                {stopCount} étapes
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selected Trip Info Card (Bottom) */}
        <AnimatePresence>
          {selectedTrip && (
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[100] w-full max-w-3xl px-6"
            >
              <div className="flex flex-col gap-4">
                {/* Photo Spots Carousel */}
                {selectedTripPhotoPoints.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-[#020617]/60 backdrop-blur-2xl rounded-[2rem] border border-white/10 p-4 shadow-2xl"
                  >
                    <div className="flex items-center gap-2 mb-3 px-2">
                      <Camera className="h-4 w-4 text-gold" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Points de vue exceptionnels</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
                      {selectedTripPhotoPoints.map((point) => (
                        <button
                          key={point.id}
                          type="button"
                          onClick={() => setSelectedWaypoint(point)}
                          className={cn(
                            "shrink-0 w-36 rounded-2xl border text-left overflow-hidden group transition-all duration-300",
                            selectedWaypoint?.id === point.id ? "border-gold ring-1 ring-gold shadow-lg shadow-gold/20 scale-105" : "border-white/10"
                          )}
                        >
                          <div className="relative h-20 w-full overflow-hidden">
                            {point.imageUrl ? (
                              <img src={point.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                            ) : (
                              <div className="w-full h-full bg-slate-800" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                          </div>
                          <div className="p-2 bg-[#020617]">
                            <p className="text-[9px] font-bold text-white truncate leading-tight uppercase tracking-wider">{point.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Main Trip Highlight Card */}
                <button
                  type="button"
                  onClick={() => router.push(`/trip/${selectedTrip.id}`)}
                  className="w-full bg-[#020617]/80 backdrop-blur-2xl rounded-[2.5rem] border border-gold/30 shadow-2xl p-6 text-left group hover:border-gold transition-all relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Sparkles className="h-20 w-20 text-gold" />
                  </div>

                  <div className="flex gap-6 items-center relative z-10">
                    <div className="relative h-24 w-24 rounded-3xl overflow-hidden shrink-0 border border-white/10 shadow-2xl group-hover:scale-105 transition-transform duration-500">
                      {selectedTrip.cover_url ? (
                        <img src={selectedTrip.cover_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-slate-800 flex items-center justify-center text-slate-600">
                          <MapPin className="h-8 w-8" />
                        </div>
                      )}
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-2xl font-bold text-white mb-2 group-hover:text-gold transition-colors">
                        {selectedTrip.title || selectedTrip.destination}
                      </h3>
                      
                      <div className="flex items-center flex-wrap gap-4">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                          <MapPin className="h-3.5 w-3.5 text-gold" />
                          <span className="text-xs font-bold text-white/80">{selectedTrip.destination}</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                          <Route className="h-3.5 w-3.5 text-gold" />
                          <span className="text-xs font-bold text-white/80">{Math.round(selectedTripTotalDistance)} km parcourus</span>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                          <Navigation className="h-3.5 w-3.5 text-gold" />
                          <span className="text-xs font-bold text-white/80">{selectedTrip.points.length} étapes</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-2">
                      <div className="h-12 w-12 rounded-full bg-gold-gradient flex items-center justify-center text-[#020617] shadow-lg shadow-gold/20 group-hover:scale-110 transition-transform">
                        <ArrowLeft className="h-6 w-6 rotate-180" />
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-gold">Explorer</span>
                    </div>
                  </div>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selected Waypoint Detail (Floating) */}
        <AnimatePresence>
          {selectedWaypoint && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: 20 }}
              className="absolute top-28 right-6 z-[100] w-64 bg-[#020617]/80 backdrop-blur-2xl rounded-[2rem] border border-gold/30 shadow-2xl p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-gold" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">Étape sélectionnée</span>
              </div>
              <p className="text-lg font-display font-bold text-white leading-tight mb-1">{selectedWaypoint.name}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{selectedWaypoint.type}</p>
              
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full mt-4 h-10 rounded-xl border-white/10 bg-white/5 hover:bg-gold/10 hover:text-gold hover:border-gold/30 transition-all font-bold text-[10px] uppercase tracking-widest"
                onClick={() => setSelectedWaypoint(null)}
              >
                Fermer
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state / Login CTA */}
        {!user && !loading && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[100] w-full max-w-md px-6">
            <div className="bg-[#020617]/80 backdrop-blur-2xl rounded-[2.5rem] border border-gold/30 shadow-2xl p-8 text-center">
              <Globe className="h-12 w-12 text-gold mx-auto mb-4 animate-float" />
              <h2 className="font-display text-2xl font-bold text-white mb-2">Connectez-vous</h2>
              <p className="text-slate-400 mb-6 text-sm">
                Découvrez vos propres voyages sur le globe et partagez vos explorations avec le monde.
              </p>
              <Button className="w-full h-14 rounded-2xl bg-gold-gradient text-[#020617] text-lg font-bold shadow-xl shadow-gold/20" asChild>
                <Link href="/login?redirect=/globe">Se connecter</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
