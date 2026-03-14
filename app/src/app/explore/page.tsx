'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  'madrid': 'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=1080&q=80',
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
      {/* Header section */}
      <div className="max-w-6xl mx-auto px-4 pt-8 pb-2">
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground">
          Explorer
        </h1>
        <p className="text-muted-foreground mt-1 text-base">
          Découvrez les voyages de la communauté et trouvez votre prochaine destination.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="sticky top-16 z-40 bg-background border-b">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-0">
            <button
              onClick={() => setFeedTab('discover')}
              className={cn(
                'relative px-4 py-3 text-sm font-medium transition-colors',
                feedTab === 'discover'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="flex items-center gap-1.5">
                <Globe className="h-4 w-4" />
                Découvrir
              </span>
              {feedTab === 'discover' && (
                <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-foreground rounded-full" />
              )}
            </button>
            {user && (
              <button
                onClick={() => setFeedTab('following')}
                className={cn(
                  'relative px-4 py-3 text-sm font-medium transition-colors',
                  feedTab === 'following'
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="flex items-center gap-1.5">
                  <UsersIcon className="h-4 w-4" />
                  Abonnements
                </span>
                {feedTab === 'following' && (
                  <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-foreground rounded-full" />
                )}
              </button>
            )}
          </div>

          <button
            onClick={() => setSortMode(sortMode === 'recent' ? 'trending' : 'recent')}
            className={cn(
              'flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border transition-colors',
              'text-muted-foreground hover:text-foreground hover:border-foreground/30'
            )}
          >
            {sortMode === 'trending' ? (
              <>
                <Flame className="h-3.5 w-3.5 text-orange-500" />
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

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6" ref={containerRef}>
        {isLoading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <MapPin className="h-16 w-16 text-muted-foreground/30" />
            <p className="text-xl font-semibold text-foreground">Aucun voyage</p>
            <p className="text-muted-foreground text-center max-w-md">
              {feedTab === 'following'
                ? 'Suis des voyageurs pour voir leurs aventures ici'
                : 'Aucun voyage public pour le moment'}
            </p>
            <div className="mt-4 w-full max-w-lg">
              <RecommendedUsers />
            </div>
          </div>
        ) : (
          <>
            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {trips.map((trip) => (
                <div
                  key={trip.id}
                  className="group relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer"
                  onClick={() => router.push(`/trip/${trip.id}`)}
                >
                  {/* Full-bleed image */}
                  <img
                    src={trip.cover_url || getFallbackImage(trip.destination)}
                    alt={trip.destination}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Duration badge — top left */}
                  {trip.duration_days && (
                    <span className="absolute top-3 left-3 inline-flex items-center gap-1 bg-white/90 backdrop-blur-sm text-foreground text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">
                      <Calendar className="h-3 w-3" />
                      {trip.duration_days} jours
                    </span>
                  )}

                  {/* Like button + count — top right */}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    <span className="text-xs font-medium text-white/90">
                      {trip.likes_count || 0}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLike(trip.id);
                      }}
                      disabled={likingTripId === trip.id}
                      className="p-2 rounded-full bg-white/20 backdrop-blur-sm transition-colors hover:bg-white/40"
                    >
                      <Heart
                        className={cn(
                          'h-4 w-4 transition-colors',
                          trip.user_liked
                            ? 'fill-red-500 text-red-500'
                            : 'text-white'
                        )}
                      />
                    </button>
                  </div>

                  {/* Bottom overlay content */}
                  <div className="absolute inset-x-0 bottom-0 p-4 flex flex-col gap-2">
                    {/* Destination + date */}
                    <div>
                      <h3 className="text-xl font-bold text-white leading-tight">
                        {trip.destination}
                      </h3>
                      {trip.start_date && (
                        <p className="text-sm text-white/70 mt-0.5">
                          {format(new Date(trip.start_date), 'MMM yyyy', { locale: fr })}
                        </p>
                      )}
                    </div>

                    {/* Owner + Adapter button */}
                    <div className="flex items-center justify-between">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/user/${trip.owner?.id}`);
                        }}
                        className="flex items-center gap-2 min-w-0"
                      >
                        <Avatar className="h-6 w-6 shrink-0 ring-1 ring-white/30">
                          <AvatarImage src={trip.owner?.avatar_url || undefined} />
                          <AvatarFallback className="bg-white/20 text-white text-[10px]">
                            {(trip.owner?.display_name || '?')[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-white/90 truncate">
                          {trip.owner?.display_name || trip.owner?.username || 'Voyageur'}
                        </span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCloneTrip(trip);
                        }}
                        className="inline-flex items-center gap-1.5 bg-white/90 backdrop-blur-sm text-foreground text-xs font-semibold px-3 py-1.5 rounded-full hover:bg-white transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        Adapter
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load more sentinel */}
            <div ref={loadMoreRef} className="h-20 flex items-center justify-center">
              {isLoadingMore && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
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
