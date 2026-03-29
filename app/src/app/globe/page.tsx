'use client';

import { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Camera, Loader2, MapPin, Route, Globe, Compass, Navigation, Layers } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/components/auth';
import { GlobeWaypoint, Traveler, TripArc } from '@/lib/globe/types';
import type { PhotoCluster } from '@/lib/globe/types';
import { Switch } from '@/components/ui/switch';
import { buildClusterHierarchy, getVisibleClusters, getZoomHeightForLevel } from '@/lib/globe/clusterEngine';
import { cn } from '@/lib/utils';
import { hapticImpactLight, hapticImpactMedium } from '@/lib/mobile/haptics';

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
  const [showArcs, setShowArcs] = useState(true);

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
    if (traveler) hapticImpactLight();
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
    hapticImpactLight();
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
    hapticImpactMedium();
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
    <div className="flex flex-col bg-[#020617] overflow-hidden" style={{ height: 'calc(100vh - 4rem)' }}>
      {/* Mobile-first Header */}
      <div className="fixed top-[max(72px,env(safe-area-inset-top)+16px)] left-4 md:left-6 z-[40] flex flex-col md:flex-row md:items-center gap-3">

        <div className="flex items-center gap-3">
          <button 
            onClick={() => { hapticImpactLight(); router.back(); }}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/40 border border-white/10 shadow-[0_8px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl active:scale-90 transition-all text-white"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-[1.5rem] px-5 py-2.5 shadow-[0_8px_16px_rgba(0,0,0,0.4)] flex items-center gap-4 max-w-[calc(100vw-100px)] overflow-x-auto scrollbar-hide">
            <div className="flex flex-col shrink-0">
              <div className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-gold" />
                <span className="font-display text-base font-black text-white tracking-tight">Narae <span className="text-gold italic">Globe</span></span>
              </div>
            </div>

            <div className="hidden sm:block h-8 w-px bg-white/10 shrink-0" />

            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] font-black uppercase tracking-widest transition-colors hidden sm:inline", showMode === 'my_trips' ? "text-gold" : "text-white/60")}>Privé</span>
                <Switch
                  checked={showMode === 'all_trips'}
                  onCheckedChange={(checked) => { hapticImpactLight(); setShowMode(checked ? 'all_trips' : 'my_trips'); }}
                  className="data-[state=checked]:bg-gold"
                />
                <span className={cn("text-[10px] font-black uppercase tracking-widest transition-colors", showMode === 'all_trips' ? "text-gold" : "text-white/60")}>Public</span>
              </div>
              
              <div className="h-4 w-px bg-white/10" />

              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] font-black uppercase tracking-widest transition-colors hidden sm:inline", showArcs ? "text-gold" : "text-white/60")}>Tracés</span>
                <Switch
                  checked={showArcs}
                  onCheckedChange={(checked) => { hapticImpactLight(); setShowArcs(checked); }}
                  className="data-[state=checked]:bg-gold"
                />
              </div>
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
              <p className="text-gold font-display text-lg tracking-widest animate-pulse">Chargement des données mondiales...</p>
            </div>
          )}
        >
          <CesiumGlobe
            travelers={travelers}
            arcs={showArcs ? arcs.map(a => ({ ...a, opacity: 0.3 })) : []}
            selectedTraveler={selectedTraveler}
            selectedTripPoints={selectedTrip?.points || []}
            selectedWaypointId={selectedWaypoint?.id || null}
            onTravelerSelect={handleTravelerSelect}
            onWaypointSelect={(wp) => { hapticImpactLight(); setSelectedWaypoint(wp); }}
            photoClusters={visibleClusters}
            onClusterClick={handleClusterClick}
            onCameraHeightChange={handleCameraHeightChange}
          />
        </Suspense>

        {/* Sidebar: List of trips (Hidden on very small mobile, visible on tablet+) */}
        <AnimatePresence>
          {user && globeTrips.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="hidden lg:block absolute left-6 top-32 bottom-32 z-[30] w-[320px]"
            >
              <div className="flex flex-col h-full bg-[#0A1628]/40 backdrop-blur-2xl border border-white/5 rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.3)] overflow-hidden group transition-all duration-500">
                <div className="p-6 border-b border-white/5 bg-black/20">
                  <h2 className="font-display text-2xl font-black text-white mb-0.5">Itinéraires</h2>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-gold">Explorer la communauté</p>
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
                          "w-full group/item rounded-2xl border p-2.5 text-left transition-all duration-300 active:scale-[0.98]",
                          isActive 
                            ? "bg-gold-gradient border-gold shadow-[0_10px_20px_rgba(197,160,89,0.2)]" 
                            : "bg-white/5 border-white/5 hover:bg-white/10"
                        )}
                      >
                        <div className="flex gap-3 items-center">
                          <div className="relative h-12 w-12 rounded-xl overflow-hidden shrink-0 shadow-lg group-hover/item:scale-105 transition-transform duration-500">
                            {trip.cover_url ? (
                              <img src={trip.cover_url} alt={trip.title || trip.destination} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full bg-slate-800 flex items-center justify-center text-slate-600">
                                <MapPin className="h-5 w-5" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className={cn("text-xs font-bold truncate", isActive ? "text-[#020617]" : "text-white group-hover/item:text-gold")}>
                              {trip.title || trip.destination}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={cn("text-[9px] font-black uppercase tracking-widest", isActive ? "text-[#020617]/70" : "text-white/60")}>
                                {owner}
                              </span>
                              <div className={cn("h-1 w-1 rounded-full", isActive ? "bg-[#020617]/30" : "bg-white/10")} />
                              <span className={cn("text-[9px] font-black uppercase tracking-widest", isActive ? "text-[#020617]" : "text-gold")}>
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


        {/* Selected Trip Info Card (Bottom - Responsive) */}
        <AnimatePresence>
          {selectedTrip && (
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="absolute bottom-4 md:bottom-10 left-4 right-4 md:left-1/2 md:-translate-x-1/2 z-[100] md:max-w-2xl lg:max-w-3xl"
            >
              <div className="flex flex-col gap-3">
                {/* Photo Spots Carousel */}
                {selectedTripPhotoPoints.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-black/40 backdrop-blur-xl rounded-[2rem] border border-white/10 p-3 shadow-2xl"
                  >
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                      {selectedTripPhotoPoints.map((point) => (
                        <button
                          key={point.id}
                          type="button"
                          onClick={() => { hapticImpactLight(); setSelectedWaypoint(point); }}
                          className={cn(
                            "shrink-0 w-28 md:w-36 rounded-2xl border text-left overflow-hidden group transition-all duration-300 active:scale-95",
                            selectedWaypoint?.id === point.id ? "border-gold ring-1 ring-gold shadow-[0_5px_15px_rgba(197,160,89,0.3)] scale-[1.02]" : "border-white/10"
                          )}
                        >
                          <div className="relative h-16 md:h-20 w-full overflow-hidden">
                            {point.imageUrl ? (
                              <img src={point.imageUrl} alt={point.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                            ) : (
                              <div className="w-full h-full bg-slate-800" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                          </div>
                          <div className="p-2 bg-[#0A1628]">
                            <p className="text-[9px] font-bold text-white truncate leading-tight uppercase tracking-widest">{point.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Main Trip Highlight Card */}
                <button
                  type="button"
                  onClick={() => { hapticImpactMedium(); router.push(`/trip/${selectedTrip.id}`); }}
                  className="w-full bg-[#0A1628]/80 backdrop-blur-2xl rounded-[2rem] md:rounded-[2.5rem] border border-white/10 shadow-[0_15px_35px_rgba(0,0,0,0.5)] p-4 md:p-6 text-left group hover:border-gold/50 transition-all relative overflow-hidden active:scale-[0.98]"
                >
                  <div className="absolute top-0 right-0 p-6 opacity-5 transition-opacity">
                    <MapPin className="h-16 w-16 md:h-24 md:w-24 text-gold" />
                  </div>

                  <div className="flex gap-4 md:gap-6 items-center relative z-10">
                    <div className="relative h-16 w-16 md:h-24 md:w-24 rounded-2xl md:rounded-3xl overflow-hidden shrink-0 shadow-2xl group-hover:scale-105 transition-transform duration-500">
                      {selectedTrip.cover_url ? (
                        <img src={selectedTrip.cover_url} alt={selectedTrip.title || selectedTrip.destination} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-slate-800 flex items-center justify-center text-slate-600">
                          <MapPin className="h-6 w-6 md:h-8 md:w-8" />
                        </div>
                      )}
                    </div>
                    
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-xl md:text-3xl font-black text-white mb-2 md:mb-3 group-hover:text-gold transition-colors leading-tight truncate">
                        {selectedTrip.title || selectedTrip.destination}
                      </h3>
                      
                      <div className="flex items-center flex-wrap gap-2 md:gap-3">
                        <div className="flex items-center gap-1.5 px-2 md:px-3 py-1 rounded-full bg-white/10 border border-white/10">
                          <MapPin className="h-3 w-3 text-gold" />
                          <span className="text-[10px] md:text-xs font-bold text-white/90">{selectedTrip.destination}</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-2 md:px-3 py-1 rounded-full bg-white/10 border border-white/10">
                          <Route className="h-3 w-3 text-gold" />
                          <span className="text-[10px] md:text-xs font-bold text-white/90">{Math.round(selectedTripTotalDistance)} km</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-2 shrink-0">
                      <div className="h-10 w-10 md:h-14 md:w-14 rounded-full bg-gold-gradient flex items-center justify-center text-black shadow-[0_5px_15px_rgba(197,160,89,0.3)] group-hover:scale-110 transition-transform">
                        <ArrowLeft className="h-5 w-5 md:h-6 md:w-6 rotate-180" />
                      </div>
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
              initial={{ opacity: 0, scale: 0.9, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className="absolute top-24 md:top-28 right-4 md:right-6 z-[100] w-[calc(100vw-2rem)] md:w-72 bg-black/60 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-[0_15px_35px_rgba(0,0,0,0.5)] p-5"
            >
              <div className="flex items-center gap-2 mb-3">
                <Compass className="h-4 w-4 text-gold" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gold">Lieu sélectionné</span>
              </div>
              <p className="text-xl font-black text-white leading-tight mb-1">{selectedWaypoint.name}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">{selectedWaypoint.type}</p>
              
              <Button 
                variant="outline" 
                size="sm" 
                className="w-full mt-5 h-12 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 hover:text-white transition-all font-bold text-xs"
                onClick={() => { hapticImpactLight(); setSelectedWaypoint(null); }}
              >
                Fermer
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state / Login CTA */}
        {!user && !loading && (
          <div className="absolute bottom-6 md:bottom-10 left-4 right-4 md:left-1/2 md:-translate-x-1/2 z-[100] md:max-w-md">
            <div className="bg-[#0A1628]/80 backdrop-blur-2xl rounded-[2rem] border border-white/10 shadow-2xl p-6 md:p-8 text-center">
              <Globe className="h-10 w-10 md:h-12 md:w-12 text-gold mx-auto mb-4 animate-float" />
              <h2 className="font-display text-xl md:text-2xl font-black text-white mb-2">Connectez-vous</h2>
              <p className="text-white/60 mb-6 text-xs md:text-sm">
                Découvrez vos propres voyages sur le globe et partagez vos explorations avec le monde.
              </p>
              <Button className="w-full h-12 md:h-14 rounded-2xl bg-gold-gradient text-black text-base font-black shadow-xl shadow-gold/20" asChild onClick={() => hapticImpactMedium()}>
                <Link href="/login?redirect=/globe">Rejoindre Narae</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
