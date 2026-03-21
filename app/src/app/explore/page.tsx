'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
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
  Sparkles,
  ArrowRight,
  TrendingUp,
  Check,
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

  // Infinite scroll observer
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

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, isLoadingMore, isLoading, page, fetchFeed]);

  const handleLike = async (tripId: string) => {
    if (!user) { toast.error('Connectez-vous pour aimer ce voyage'); return; }
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
    <div className="min-h-screen bg-background">
      {/* Premium Header section */}
      <div className="relative overflow-hidden pt-12 pb-8">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-64 bg-[radial-gradient(circle_at_center,rgba(197,160,89,0.05)_0%,transparent_70%)]" />
        <div className="max-w-6xl mx-auto px-4 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-4 w-4 text-gold" />
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-gold">Inspirations Illimitées</span>
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold text-foreground leading-tight">
              Explorer les <br />
              <span className="text-gold-gradient italic">Horizons</span>
            </h1>
            <p className="text-muted-foreground mt-4 text-lg max-w-xl leading-relaxed">
              Laissez-vous guider par les carnets de voyage les plus exceptionnels de notre communauté.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Glassmorphism filter tabs */}
      <div className="sticky top-16 z-40 bg-background/80 backdrop-blur-xl border-b border-gold/10">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFeedTab('discover')}
              className={cn(
                'relative px-6 py-4 text-[10px] font-bold uppercase tracking-widest transition-all',
                feedTab === 'discover'
                  ? 'text-gold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5" />
                Découvrir
              </span>
              {feedTab === 'discover' && (
                <motion.span layoutId="explore-tab" className="absolute bottom-0 left-6 right-6 h-0.5 bg-gold rounded-full" />
              )}
            </button>
            {user && (
              <button
                onClick={() => setFeedTab('following')}
                className={cn(
                  'relative px-6 py-4 text-[10px] font-bold uppercase tracking-widest transition-all',
                  feedTab === 'following'
                    ? 'text-gold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="flex items-center gap-2">
                  <UsersIcon className="h-3.5 w-3.5" />
                  Abonnements
                </span>
                {feedTab === 'following' && (
                  <motion.span layoutId="explore-tab" className="absolute bottom-0 left-6 right-6 h-0.5 bg-gold rounded-full" />
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setSortMode(sortMode === 'recent' ? 'trending' : 'recent')}
              className="group flex items-center gap-2 px-4 py-2 rounded-full border border-gold/20 bg-gold/5 text-[10px] font-bold uppercase tracking-widest text-gold hover:bg-gold hover:text-white transition-all shadow-lg shadow-gold/5"
            >
              {sortMode === 'trending' ? (
                <>
                  <TrendingUp className="h-3.5 w-3.5" />
                  Tendances
                </>
              ) : (
                <>
                  <Clock className="h-3.5 w-3.5" />
                  Récents
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content Gallery */}
      <div className="max-w-6xl mx-auto px-4 py-12" ref={containerRef}>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-gold" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Chargement de la galerie...</p>
          </div>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-6">
            <div className="w-24 h-24 rounded-[2rem] bg-gold/5 flex items-center justify-center border border-gold/10">
              <MapPin className="h-10 w-10 text-gold/30" />
            </div>
            <div className="text-center">
              <p className="text-2xl font-display font-bold text-foreground">Aucun voyage trouvé</p>
              <p className="text-muted-foreground mt-2 max-w-md">
                {feedTab === 'following'
                  ? 'Suivez d\'autres voyageurs pour voir leurs aventures apparaître dans votre galerie privée.'
                  : 'La galerie est vide pour le moment. Revenez bientôt !'}
              </p>
            </div>
            <div className="mt-8 w-full max-w-2xl">
              <RecommendedUsers />
            </div>
          </div>
        ) : (
          <>
            {/* Masonry-like Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {trips.map((trip, idx) => (
                <motion.div
                  key={trip.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: idx * 0.05 }}
                  className="group relative flex flex-col cursor-pointer"
                  onClick={() => router.push(`/trip/${trip.id}`)}
                >
                  {/* Card Container */}
                  <div className="relative aspect-[4/5] overflow-hidden rounded-[2.5rem] border border-gold/10 bg-[#020617] shadow-2xl transition-all duration-700 group-hover:-translate-y-2 group-hover:shadow-gold/10">
                    {/* Full-bleed image with parallax-like effect */}
                    <img
                      src={trip.cover_url || getFallbackImage(trip.destination)}
                      alt={trip.destination}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 ease-out group-hover:scale-110"
                    />

                    {/* Sophisticated Overlays */}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/20 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-90" />
                    <div className="absolute inset-0 border-[1px] border-white/5 rounded-[2.5rem] pointer-events-none" />

                    {/* Top Content (Badges) */}
                    <div className="absolute top-6 left-6 right-6 flex items-center justify-between">
                      {trip.duration_days && (
                        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/20 px-4 py-1.5 rounded-full shadow-xl">
                          <Calendar className="h-3.5 w-3.5 text-gold" />
                          <span className="text-[10px] font-bold text-white uppercase tracking-widest">
                            {trip.duration_days} Jours
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-white/90 drop-shadow-lg">
                          {trip.likes_count || 0}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLike(trip.id);
                          }}
                          disabled={likingTripId === trip.id}
                          className={cn(
                            "p-2.5 rounded-full backdrop-blur-md transition-all duration-300 border hover:scale-110 active:scale-95",
                            trip.user_liked
                              ? "bg-red-500 border-red-500 shadow-lg shadow-red-500/20"
                              : "bg-white/10 border-white/20 hover:bg-white/20"
                          )}
                        >
                          <Heart
                            className={cn(
                              'h-4 w-4 transition-colors',
                              trip.user_liked ? 'fill-white text-white' : 'text-white'
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Bottom Content */}
                    <div className="absolute inset-x-0 bottom-0 p-8 flex flex-col gap-6">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-gold">
                          <MapPin className="h-3 w-3" />
                          <span className="text-[9px] font-bold uppercase tracking-[0.3em]">Destination d'exception</span>
                        </div>
                        <h3 className="font-display text-3xl font-bold text-white leading-tight group-hover:text-gold transition-colors">
                          {trip.destination}
                        </h3>
                        {trip.start_date && (
                          <p className="text-xs font-medium text-white/60 tracking-wide">
                            {format(new Date(trip.start_date), 'MMMM yyyy', { locale: fr })}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-6 border-t border-white/10">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/user/${trip.owner?.id}`);
                          }}
                          className="flex items-center gap-3 group/user transition-all"
                        >
                          <div className="relative">
                            <Avatar className="h-10 w-10 shrink-0 border-2 border-gold/30 p-0.5 transition-all group-hover/user:border-gold">
                              <AvatarImage src={trip.owner?.avatar_url || undefined} className="rounded-full" />
                              <AvatarFallback className="bg-gold text-[#020617] text-xs font-bold">
                                {(trip.owner?.display_name || '?')[0].toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="absolute -bottom-1 -right-1 bg-gold rounded-full p-0.5 shadow-lg">
                              <Check className="h-2 w-2 text-[#020617]" />
                            </div>
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-xs font-bold text-white group-hover/user:text-gold transition-colors">
                              {trip.owner?.display_name || trip.owner?.username || 'Voyageur'}
                            </span>
                            <span className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Membre Premium</span>
                          </div>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCloneTrip(trip);
                          }}
                          className="group/btn flex items-center gap-2 bg-gold-gradient text-[#020617] px-5 py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-xl shadow-gold/20 hover:scale-105 active:scale-95 transition-all"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Personnaliser
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Load more sentinel with luxury loader */}
            <div ref={loadMoreRef} className="h-40 flex flex-col items-center justify-center gap-4">
              {isLoadingMore ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-gold" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Découverte de nouveaux horizons...</span>
                </>
              ) : hasMore && (
                <div className="w-1 h-12 bg-gradient-to-b from-gold/50 to-transparent rounded-full" />
              )}
            </div>
          </>
        )}
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
