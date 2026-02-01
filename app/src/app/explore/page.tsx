'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Heart,
  MessageCircle,
  MapPin,
  Calendar,
  Share2,
  Loader2,
  Globe,
  Users as UsersIcon,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/components/auth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { FollowButton } from '@/components/social/FollowButton';

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
  }, [feedTab]);

  useEffect(() => {
    fetchFeed(1);
  }, [feedTab, fetchFeed]);

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
    <div className="min-h-screen bg-black">
      {/* Top tabs - fixed */}
      <div className="fixed top-16 left-0 right-0 z-50 flex justify-center gap-6 py-3 bg-gradient-to-b from-black/80 to-transparent">
        <button
          onClick={() => setFeedTab('discover')}
          className={cn(
            'text-base font-semibold transition-all',
            feedTab === 'discover' ? 'text-white' : 'text-white/50'
          )}
        >
          <Globe className="inline h-4 w-4 mr-1.5 mb-0.5" />
          Découvrir
        </button>
        {user && (
          <button
            onClick={() => setFeedTab('following')}
            className={cn(
              'text-base font-semibold transition-all',
              feedTab === 'following' ? 'text-white' : 'text-white/50'
            )}
          >
            <UsersIcon className="inline h-4 w-4 mr-1.5 mb-0.5" />
            Abonnements
          </button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
      ) : trips.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-screen text-white gap-4">
          <MapPin className="h-16 w-16 text-white/30" />
          <p className="text-xl font-semibold">Aucun voyage</p>
          <p className="text-white/50 text-center px-8">
            {feedTab === 'following'
              ? 'Suis des voyageurs pour voir leurs aventures ici'
              : 'Aucun voyage public pour le moment'}
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="snap-y snap-mandatory h-[calc(100vh-4rem)] overflow-y-scroll">
          {trips.map((trip) => (
            <div
              key={trip.id}
              className="snap-start h-[calc(100vh-4rem)] relative flex items-end"
            >
              {/* Background image */}
              <div className="absolute inset-0">
                <img
                  src={trip.cover_url || getFallbackImage(trip.destination)}
                  alt={trip.destination}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/40" />
              </div>

              {/* Right sidebar - actions (z-20 to be above tap zone) */}
              <div className="absolute right-3 bottom-32 flex flex-col items-center gap-5 z-20">
                {/* Profile avatar */}
                <button
                  onClick={() => router.push(`/user/${trip.owner?.id}`)}
                  className="relative"
                >
                  <Avatar className="h-12 w-12 border-2 border-white">
                    <AvatarImage src={trip.owner?.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary text-white text-lg">
                      {(trip.owner?.display_name || '?')[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>

                {/* Like */}
                <button
                  onClick={() => handleLike(trip.id)}
                  disabled={likingTripId === trip.id}
                  className="flex flex-col items-center gap-1"
                >
                  <div className={cn(
                    'p-2 rounded-full transition-all',
                    trip.user_liked ? 'bg-red-500/20' : 'bg-white/10'
                  )}>
                    <Heart className={cn(
                      'h-7 w-7 transition-all',
                      trip.user_liked ? 'fill-red-500 text-red-500' : 'text-white'
                    )} />
                  </div>
                  <span className="text-white text-xs font-semibold">
                    {trip.likes_count || 0}
                  </span>
                </button>

                {/* Comment / View */}
                <button
                  onClick={() => router.push(`/trip/${trip.id}`)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="p-2 rounded-full bg-white/10">
                    <MessageCircle className="h-7 w-7 text-white" />
                  </div>
                  <span className="text-white text-xs">Voir</span>
                </button>

                {/* Share */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/trip/${trip.id}`);
                    toast.success('Lien copié !');
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="p-2 rounded-full bg-white/10">
                    <Share2 className="h-7 w-7 text-white" />
                  </div>
                  <span className="text-white text-xs">Partager</span>
                </button>
              </div>

              {/* Bottom info overlay (z-20 to be above tap zone) */}
              <div className="relative z-20 p-5 pb-8 w-full pr-20">
                {/* User info */}
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={() => router.push(`/user/${trip.owner?.id}`)}
                    className="flex items-center gap-2"
                  >
                    <span className="text-white font-bold text-base">
                      @{trip.owner?.username || trip.owner?.display_name || 'voyageur'}
                    </span>
                  </button>
                  {user && trip.owner?.id !== user.id && (
                    <FollowButton
                      userId={trip.owner?.id}
                      initialIsFollowing={trip.is_following || false}
                      initialIsCloseFriend={false}
                      size="sm"
                    />
                  )}
                </div>

                {/* Destination & title */}
                <h2 className="text-white text-2xl font-bold mb-1 drop-shadow-lg">
                  <MapPin className="inline h-5 w-5 mr-1 mb-1" />
                  {trip.destination}
                </h2>
                {trip.title && trip.title !== trip.destination && (
                  <p className="text-white/80 text-base mb-2 line-clamp-2">{trip.title}</p>
                )}

                {/* Meta tags */}
                <div className="flex flex-wrap gap-2 mt-2">
                  {trip.duration_days && (
                    <span className="inline-flex items-center gap-1 bg-white/15 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full">
                      <Calendar className="h-3.5 w-3.5" />
                      {trip.duration_days} jours
                    </span>
                  )}
                  {trip.start_date && (
                    <span className="inline-flex items-center gap-1 bg-white/15 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full">
                      {format(new Date(trip.start_date), 'MMM yyyy', { locale: fr })}
                    </span>
                  )}
                  {trip.preferences?.groupSize && (
                    <span className="inline-flex items-center gap-1 bg-white/15 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full">
                      <UsersIcon className="h-3.5 w-3.5" />
                      {trip.preferences.groupSize} pers.
                    </span>
                  )}
                </div>
              </div>

              {/* Tap to view trip */}
              <button
                onClick={() => router.push(`/trip/${trip.id}`)}
                className="absolute inset-0 z-[5]"
                aria-label="Voir le voyage"
              />
            </div>
          ))}

          {/* Load more sentinel */}
          <div ref={loadMoreRef} className="h-20 flex items-center justify-center">
            {isLoadingMore && <Loader2 className="h-6 w-6 animate-spin text-white" />}
          </div>
        </div>
      )}
    </div>
  );
}
