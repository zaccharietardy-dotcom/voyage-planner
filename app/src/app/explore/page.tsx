'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import {
  Heart,
  MapPin,
  Calendar,
  Loader2,
  Globe,
  Users as UsersIcon,
  Flame,
  Clock,
  Copy,
  Compass,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { RecommendedUsers } from '@/components/social/RecommendedUsers';
import { CloneTripModal } from '@/components/social/CloneTripModal';
import { hapticImpactLight, hapticImpactMedium } from '@/lib/mobile/haptics';

interface FeedTrip {
  id: string;
  title: string;
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  visibility: string;
  created_at: string;
  preferences: any;
  cover_url: string | null;
  owner: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    username: string | null;
  };
  likes_count: number;
  user_liked: boolean;
  is_following?: boolean;
}

const FALLBACK_IMAGES: Record<string, string> = {
  'paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1080&q=80',
  'tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1080&q=80',
  'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1080&q=80',
  'london': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1080&q=80',
  'londres': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1080&q=80',
  'rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1080&q=80',
  'barcelone': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=1080&q=80',
  'seville': 'https://images.unsplash.com/photo-1559386484-97dfc0e15539?w=1080&q=80',
  'séville': 'https://images.unsplash.com/photo-1559386484-97dfc0e15539?w=1080&q=80',
  'madrid': 'https://images.unsplash.com/photo-1543783207-ec64e4d95325?w=1080&q=80',
  'lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=1080&q=80',
  'amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=1080&q=80',
  'berlin': 'https://images.unsplash.com/photo-1560969184-10fe8719e047?w=1080&q=80',
  'istanbul': 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=1080&q=80',
  'marrakech': 'https://images.unsplash.com/photo-1597211833712-5e41faa202ea?w=1080&q=80',
  'dubai': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1080&q=80',
  'bangkok': 'https://images.unsplash.com/photo-1508009603885-50cf7c579365?w=1080&q=80',
  'bali': 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=1080&q=80',
};

function getFallbackImage(destination: string): string {
  const normalized = destination.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [key, url] of Object.entries(FALLBACK_IMAGES)) {
    const keyNorm = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalized.includes(keyNorm)) return url;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1080&q=80';
}

export default function ExplorePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [feedTab, setFeedTab] = useState<'discover' | 'following'>('discover');
  const [trips, setTrips] = useState<FeedTrip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [likingTripId, setLikingTripId] = useState<string | null>(null);
  const [cloneTrip, setCloneTrip] = useState<FeedTrip | null>(null);
  const [sortMode, setSortMode] = useState<'recent' | 'trending'>('recent');
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const fetchFeed = useCallback(async (pageNum: number, append = false) => {
    try {
      if (pageNum === 1) setIsLoading(true);
      else setIsLoadingMore(true);

      const params = new URLSearchParams({
        tab: feedTab,
        page: pageNum.toString(),
        limit: '10',
        sort: sortMode,
      });

      const response = await fetch(`/api/feed?${params}`);
      if (response.ok) {
        const data = await response.json();
        setTrips(prev => append ? [...prev, ...data.trips] : data.trips);
        setHasMore(data.hasMore);
        setPage(pageNum);
      }
    } catch (e) {
      console.error('Feed error:', e);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [feedTab, sortMode]);

  useEffect(() => {
    fetchFeed(1);
  }, [feedTab, sortMode, fetchFeed]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isLoading) {
          fetchFeed(page + 1, true);
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observerRef.current.observe(loadMoreRef.current);
    return () => observerRef.current?.disconnect();
  }, [hasMore, isLoadingMore, isLoading, page, fetchFeed]);

  const handleLike = async (tripId: string) => {
    if (!user) { toast.error('Connectez-vous pour aimer ce voyage'); return; }
    hapticImpactLight();
    setLikingTripId(tripId);
    try {
      const trip = trips.find(t => t.id === tripId);
      setTrips(prev => prev.map(t =>
        t.id === tripId
          ? { ...t, user_liked: !t.user_liked, likes_count: t.likes_count + (t.user_liked ? -1 : 1) }
          : t
      ));
      if (trip?.user_liked) {
        await fetch(`/api/trips/${tripId}/like`, { method: 'DELETE' });
      } else {
        await fetch(`/api/trips/${tripId}/like`, { method: 'POST' });
      }
    } catch {
      fetchFeed(1);
    } finally {
      setLikingTripId(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-background">
      {/* Left: Scrollable Feed */}
      <div className="w-full lg:w-[500px] xl:w-[580px] 2xl:w-[650px] shrink-0 flex flex-col border-r border-gold/10">
        <div className="p-6 md:p-8 pb-4">
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-2 mb-2">
              <Compass className="h-4 w-4 text-gold" />
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gold">Communauté</span>
            </div>
            <h1 className="font-display text-4xl md:text-5xl font-black text-white tracking-tight">Explorer</h1>
          </motion.div>
        </div>

        <div className="px-6 md:px-8 py-4 border-b border-white/5 flex items-center justify-between bg-black/40 backdrop-blur-xl z-10 sticky top-0">
          <div className="flex items-center gap-6">
            <button
              onClick={() => { hapticImpactLight(); setFeedTab('discover'); }}
              className={cn(
                'text-[11px] font-black uppercase tracking-widest transition-all pb-2 border-b-2 relative',
                feedTab === 'discover' ? 'text-gold border-gold' : 'text-white/40 border-transparent hover:text-white/70'
              )}
            >
              Découvrir
            </button>
            {user && (
              <button
                onClick={() => { hapticImpactLight(); setFeedTab('following'); }}
                className={cn(
                  'text-[11px] font-black uppercase tracking-widest transition-all pb-2 border-b-2 relative',
                  feedTab === 'following' ? 'text-gold border-gold' : 'text-white/40 border-transparent hover:text-white/70'
                )}
              >
                Suivis
              </button>
            )}
          </div>

          <button
            onClick={() => { hapticImpactLight(); setSortMode(sortMode === 'recent' ? 'trending' : 'recent'); }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-[9px] font-black uppercase tracking-widest text-white hover:bg-white/10 hover:border-white/20 transition-all shadow-inner active:scale-95"
          >
            {sortMode === 'trending' ? <TrendingUp className="h-3.5 w-3.5 text-gold" /> : <Clock className="h-3.5 w-3.5 text-gold" />}
            {sortMode === 'trending' ? 'Tendances' : 'Récents'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scrollbar-hide" ref={containerRef}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-32 gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-gold" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Recherche d'horizons...</p>
            </div>
          ) : trips.length === 0 ? (
            <div className="text-center py-32">
              <div className="w-24 h-24 rounded-3xl bg-white/5 flex items-center justify-center border border-white/10 mx-auto mb-6 shadow-inner">
                <MapPin className="h-10 w-10 text-gold/50" />
              </div>
              <p className="text-2xl font-black text-white mb-2 tracking-tight">Aucune découverte</p>
              <p className="text-sm text-white/50 max-w-xs mx-auto leading-relaxed">
                Suivez des voyageurs ou explorez les nouveaux départs de la communauté.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-6">
                {trips.map((trip, idx) => (
                  <motion.div
                    key={trip.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                    className="group relative cursor-pointer"
                    onClick={() => { hapticImpactLight(); router.push(`/trip/${trip.id}`); }}
                  >
                    <div className="relative overflow-hidden rounded-[2rem] bg-[#0A1628]/40 border border-white/5 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.12)] group-hover:shadow-[0_15px_40px_rgba(197,160,89,0.15)] group-hover:border-gold/30 transition-all duration-500 active:scale-[0.98]">
                      {/* Hero Image Section */}
                      <div className="relative h-56 overflow-hidden">
                        <img
                          src={trip.cover_url || getFallbackImage(trip.destination)}
                          alt={trip.destination}
                          className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0A1628] via-[#0A1628]/40 to-transparent" />
                        
                        {/* Top Badges */}
                        <div className="absolute top-4 left-4 flex gap-2">
                          <div className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-black text-white uppercase tracking-widest shadow-sm">
                            {trip.duration_days} Jours
                          </div>
                        </div>

                        {/* Title & Location (Overlaid on image bottom) */}
                        <div className="absolute bottom-4 left-5 right-5">
                          <div className="flex items-center gap-2 mb-1.5">
                            <MapPin className="h-3.5 w-3.5 text-gold" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80 drop-shadow-md">{trip.destination}</span>
                          </div>
                          <h3 className="text-2xl font-black text-white leading-tight group-hover:text-gold transition-colors truncate drop-shadow-lg">
                            {trip.title || trip.destination}
                          </h3>
                        </div>
                      </div>

                      {/* Info & Actions Section */}
                      <div className="p-5 flex items-center justify-between">
                        {/* User Profile */}
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10 border-2 border-gold/30 p-0.5 bg-black/40">
                            <AvatarImage src={trip.owner?.avatar_url || undefined} />
                            <AvatarFallback className="bg-gold-gradient text-black text-xs font-black">{(trip.owner?.display_name || '?')[0]}</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-white leading-tight">{trip.owner?.display_name || 'Voyageur'}</span>
                            <span className="text-[9px] font-black text-gold uppercase tracking-widest mt-0.5">Créateur</span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLike(trip.id); }}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all active:scale-90"
                          >
                            <Heart className={cn("h-4 w-4 transition-colors", trip.user_liked ? "fill-red-500 text-red-500" : "text-white/60 group-hover:text-white")} />
                            <span className={cn("text-[11px] font-black", trip.user_liked ? "text-red-500" : "text-white/60")}>{trip.likes_count}</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); hapticImpactMedium(); setCloneTrip(trip); }}
                            className="flex items-center justify-center h-9 w-9 bg-gold/10 hover:bg-gold/20 text-gold border border-gold/20 rounded-xl transition-all active:scale-90"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div ref={loadMoreRef} className="py-10 flex justify-center">
                {isLoadingMore && <Loader2 className="h-6 w-6 animate-spin text-gold" />}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: Full-height Interactive Map */}
      <div className="hidden lg:block flex-1 relative bg-[#020617]">
        <div className="absolute inset-0">
          <ExploreMap trips={trips} onTripClick={(id) => router.push(`/trip/${id}`)} />
        </div>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-3xl px-10 py-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-12">
            <div className="text-center">
              <p className="font-display text-3xl font-black text-white drop-shadow-md">{trips.length}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gold mt-1">Explorations</p>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <div className="text-center">
              <p className="font-display text-3xl font-black text-white drop-shadow-md">{trips.reduce((acc, t) => acc + (t.likes_count || 0), 0)}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gold mt-1">Coups de cœur</p>
            </div>
            <div className="h-10 w-px bg-white/10" />
            <div className="text-center">
              <p className="font-display text-3xl font-black text-white drop-shadow-md flex justify-center"><Globe className="h-8 w-8 text-gold" /></p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gold mt-1">Savoir-faire</p>
            </div>
          </div>
        </div>
      </div>

      {cloneTrip && (
        <CloneTripModal
          isOpen={!!cloneTrip}
          onClose={() => setCloneTrip(null)}
          tripId={cloneTrip.id}
          tripTitle={cloneTrip.title || cloneTrip.destination}
          originalDuration={cloneTrip.duration_days}
        />
      )}
    </div>
  );
}

function ExploreMap({ trips, onTripClick }: { trips: FeedTrip[], onTripClick: (id: string) => void }) {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  if (!isClient) return <div className="w-full h-full bg-[#020617]" />;

  const TripMap = dynamic(() => import('@/components/trip/TripMap').then(mod => mod.TripMap), { ssr: false });

  const mapItems = trips.map(t => ({
    id: t.id,
    title: t.destination,
    locationName: t.destination,
    latitude: t.preferences?.destinationCoords?.lat || 48.8566,
    longitude: t.preferences?.destinationCoords?.lng || 2.3522,
    type: 'activity' as const,
    dayNumber: 1,
    orderIndex: 0,
    startTime: '09:00',
    endTime: '10:00',
    description: '',
  }));

  return (
    <TripMap 
      items={mapItems} 
      onItemClick={(item) => onTripClick(item.id)}
      isVisible={true}
    />
  );
}

