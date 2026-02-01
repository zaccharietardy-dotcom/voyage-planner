'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, X, Heart, MessageCircle, Copy, Share2, MapPin, Calendar, Loader2 } from 'lucide-react';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { SearchBar } from '@/components/v2/ui/SearchBar';
import { useAuth } from '@/components/auth';
import { FollowButton } from '@/components/v2/social/FollowButton';
import { CloneTripModal } from '@/components/v2/trips/CloneTripModal';
import { useRouter } from 'next/navigation';

// Dynamic import for Globe to avoid SSR issues
const CesiumGlobe = dynamic(
  () => import('@/components/v2/globe/CesiumGlobe').then((mod) => mod.CesiumGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
        <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    ),
  }
);

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
  data?: any;
  owner: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    username: string | null;
  };
  likes_count: number;
  user_liked: boolean;
}

export default function ExplorePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'feed' | 'globe'>('feed');
  const [feedTab, setFeedTab] = useState<'discover' | 'following'>('discover');
  const [trips, setTrips] = useState<FeedTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [cloneTrip, setCloneTrip] = useState<FeedTrip | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Globe data
  const [globeTrips, setGlobeTrips] = useState<any[]>([]);

  const fetchFeed = useCallback(async (reset = false) => {
    const currentPage = reset ? 1 : page;
    setLoading(true);
    try {
      const response = await fetch(`/api/feed?tab=${feedTab}&page=${currentPage}&limit=20`);
      if (response.ok) {
        const data = await response.json();
        setTrips(prev => reset ? data.trips : [...prev, ...data.trips]);
        setHasMore(data.hasMore);
        if (reset) setPage(1);
      }
    } catch (e) {
      console.error('Feed error:', e);
    } finally {
      setLoading(false);
    }
  }, [feedTab, page]);

  useEffect(() => {
    fetchFeed(true);
  }, [feedTab]);

  useEffect(() => {
    if (activeTab === 'globe') {
      fetchGlobeData();
    }
  }, [activeTab]);

  const fetchGlobeData = async () => {
    try {
      const response = await fetch('/api/globe');
      if (response.ok) {
        const data = await response.json();
        setGlobeTrips(data.trips || []);
      }
    } catch (e) {
      console.error('Globe error:', e);
    }
  };

  const handleLike = async (tripId: string) => {
    if (!user) return;
    try {
      // Optimistic update
      setTrips(prev => prev.map(t =>
        t.id === tripId
          ? { ...t, user_liked: !t.user_liked, likes_count: t.likes_count + (t.user_liked ? -1 : 1) }
          : t
      ));

      if (trips.find(t => t.id === tripId)?.user_liked) {
        await fetch(`/api/trips/${tripId}/like`, { method: 'DELETE' });
      } else {
        await fetch(`/api/trips/${tripId}/like`, { method: 'POST' });
      }
    } catch (e) {
      fetchFeed(true); // Revert on error
    }
  };

  const handleTripClick = (trip: FeedTrip) => {
    if (trip.data) {
      localStorage.setItem('currentTrip', JSON.stringify({ ...trip.data, id: trip.id }));
    }
    router.push(`/v2/trip/${trip.id}`);
  };

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  const filteredTrips = searchQuery
    ? trips.filter(t =>
        t.destination.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.owner?.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : trips;

  return (
    <V2Layout>
      <div className="min-h-screen bg-[#0a0a0f]">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-[#0a0a0f]/95 backdrop-blur-xl safe-area-top">
          <div className="px-4 pt-12 pb-2">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent mb-3">
              Parcourir
            </h1>

            {/* Sub-tabs: Feed / Globe */}
            <div className="flex gap-1 bg-[#12121a] rounded-xl p-1 mb-3">
              <button
                onClick={() => setActiveTab('feed')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'feed'
                    ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg'
                    : 'text-gray-400'
                }`}
              >
                Feed
              </button>
              <button
                onClick={() => setActiveTab('globe')}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'globe'
                    ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-lg'
                    : 'text-gray-400'
                }`}
              >
                Globe
              </button>
            </div>

            {activeTab === 'feed' && (
              <>
                {/* Search */}
                <SearchBar placeholder="Destinations, voyageurs..." onSearch={setSearchQuery} />

                {/* Feed sub-tabs: Abonnements / Découvrir */}
                {user && (
                  <div className="flex gap-4 mt-3">
                    <button
                      onClick={() => setFeedTab('following')}
                      className={`text-sm font-medium pb-1 border-b-2 transition-all ${
                        feedTab === 'following'
                          ? 'text-white border-indigo-500'
                          : 'text-gray-500 border-transparent'
                      }`}
                    >
                      Abonnements
                    </button>
                    <button
                      onClick={() => setFeedTab('discover')}
                      className={`text-sm font-medium pb-1 border-b-2 transition-all ${
                        feedTab === 'discover'
                          ? 'text-white border-indigo-500'
                          : 'text-gray-500 border-transparent'
                      }`}
                    >
                      Découvrir
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {activeTab === 'feed' ? (
            <motion.div
              key="feed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-4 pb-24"
            >
              {loading && trips.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                </div>
              ) : filteredTrips.length === 0 ? (
                <div className="text-center py-20">
                  <p className="text-gray-400">
                    {feedTab === 'following'
                      ? 'Aucun voyage de tes abonnements. Commence à suivre des voyageurs !'
                      : 'Aucun voyage public pour le moment.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4 mt-4">
                  {filteredTrips.map((trip, i) => (
                    <motion.div
                      key={trip.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-[#12121a] rounded-2xl border border-[#2a2a38] overflow-hidden"
                    >
                      {/* Trip header - owner info */}
                      <div className="flex items-center gap-3 p-4 pb-2">
                        <button
                          onClick={() => router.push(`/v2/user/${trip.owner?.id}`)}
                          className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center overflow-hidden flex-shrink-0"
                        >
                          {trip.owner?.avatar_url ? (
                            <img src={trip.owner.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-white font-semibold text-xs">
                              {(trip.owner?.display_name || '?')[0].toUpperCase()}
                            </span>
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <button
                            onClick={() => router.push(`/v2/user/${trip.owner?.id}`)}
                            className="text-white font-medium text-sm truncate block"
                          >
                            {trip.owner?.display_name || 'Voyageur'}
                          </button>
                          <p className="text-gray-500 text-xs">{formatDate(trip.created_at)}</p>
                        </div>
                        {user && trip.owner?.id !== user.id && (
                          <FollowButton
                            userId={trip.owner?.id}
                            initialIsFollowing={false}
                            initialIsCloseFriend={false}
                            size="sm"
                          />
                        )}
                      </div>

                      {/* Trip content */}
                      <button
                        onClick={() => handleTripClick(trip)}
                        className="w-full text-left px-4 py-3"
                      >
                        <h3 className="text-white font-semibold text-lg mb-1">
                          {trip.title || trip.name}
                        </h3>
                        <div className="flex items-center gap-3 text-sm text-gray-400">
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" /> {trip.destination}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" /> {trip.duration_days}j
                          </span>
                          {trip.preferences?.budgetLevel && (
                            <span className="capitalize">{trip.preferences.budgetLevel}</span>
                          )}
                        </div>
                      </button>

                      {/* Actions */}
                      <div className="flex items-center gap-4 px-4 py-3 border-t border-[#2a2a38]">
                        <button
                          onClick={() => handleLike(trip.id)}
                          className="flex items-center gap-1.5 text-sm"
                        >
                          <Heart
                            className={`w-5 h-5 transition-colors ${
                              trip.user_liked ? 'fill-red-500 text-red-500' : 'text-gray-400'
                            }`}
                          />
                          <span className={trip.user_liked ? 'text-red-500' : 'text-gray-400'}>
                            {trip.likes_count || ''}
                          </span>
                        </button>
                        <button
                          onClick={() => handleTripClick(trip)}
                          className="flex items-center gap-1.5 text-sm text-gray-400"
                        >
                          <MessageCircle className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => setCloneTrip(trip)}
                          className="flex items-center gap-1.5 text-sm text-gray-400"
                        >
                          <Copy className="w-5 h-5" />
                        </button>
                        <button className="flex items-center gap-1.5 text-sm text-gray-400 ml-auto">
                          <Share2 className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  ))}

                  {hasMore && (
                    <button
                      onClick={() => { setPage(p => p + 1); fetchFeed(); }}
                      className="w-full py-3 text-indigo-400 text-sm font-medium"
                    >
                      {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Charger plus'}
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="globe"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-[calc(100vh-180px)]"
            >
              <Suspense fallback={
                <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
                  <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              }>
                <CesiumGlobe
                  travelers={[]}
                  arcs={[]}
                  selectedTraveler={null}
                  onTravelerSelect={() => {}}
                />
              </Suspense>

              {/* Globe trip overlay info */}
              {globeTrips.length > 0 && (
                <div className="absolute bottom-24 left-4 right-4 z-10">
                  <div className="bg-[#0a0a0f]/90 backdrop-blur-xl rounded-2xl border border-[#2a2a38] p-4">
                    <p className="text-white font-medium text-sm mb-1">
                      {globeTrips.length} voyage{globeTrips.length > 1 ? 's' : ''} sur le globe
                    </p>
                    <p className="text-gray-500 text-xs">
                      Tes voyages et ceux de tes abonnements
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Clone Modal */}
        {cloneTrip && (
          <CloneTripModal
            isOpen={!!cloneTrip}
            onClose={() => setCloneTrip(null)}
            tripId={cloneTrip.id}
            tripTitle={cloneTrip.title || cloneTrip.name}
            originalDuration={cloneTrip.duration_days}
          />
        )}
      </div>
    </V2Layout>
  );
}
