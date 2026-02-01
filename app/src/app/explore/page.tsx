'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Search,
  Loader2,
  Heart,
  MessageCircle,
  MapPin,
  Calendar,
  Users,
  Copy,
  Share2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/components/auth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { FollowButton } from '@/components/social/FollowButton';
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
  owner: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    username: string | null;
  };
  likes_count: number;
  user_liked: boolean;
  is_following?: boolean;
  comments_count?: number;
}

const DESTINATION_IMAGES: Record<string, string> = {
  'paris': 'photo-1502602898657-3e91760cbb34',
  'tokyo': 'photo-1540959733332-eab4deabeeaf',
  'new york': 'photo-1496442226666-8d4d0e62e6e9',
  'londres': 'photo-1513635269975-59663e0ac1ad',
  'london': 'photo-1513635269975-59663e0ac1ad',
  'rome': 'photo-1552832230-c0197dd311b5',
  'barcelone': 'photo-1583422409516-2895a77efded',
  'barcelona': 'photo-1583422409516-2895a77efded',
  'séville': 'photo-1559386484-97dfc0e15539',
  'seville': 'photo-1559386484-97dfc0e15539',
  'madrid': 'photo-1539037116277-4db20889f2d4',
  'lisbonne': 'photo-1585208798174-6cedd86e019a',
  'lisbon': 'photo-1585208798174-6cedd86e019a',
  'amsterdam': 'photo-1534351590666-13e3e96b5017',
  'berlin': 'photo-1560969184-10fe8719e047',
  'prague': 'photo-1519677100203-a0e668c92439',
  'vienne': 'photo-1516550893923-42d28e5677af',
  'vienna': 'photo-1516550893923-42d28e5677af',
  'budapest': 'photo-1549289524-06cf8837ace5',
  'istanbul': 'photo-1524231757912-21f4fe3a7200',
  'athènes': 'photo-1555993539-1732b0258235',
  'athens': 'photo-1555993539-1732b0258235',
  'marrakech': 'photo-1597211833712-5e41faa202ea',
  'dubai': 'photo-1512453979798-5ea266f8880c',
  'bangkok': 'photo-1508009603885-50cf7c579365',
  'bali': 'photo-1537996194471-e657df975ab4',
  'sydney': 'photo-1506973035872-a4ec16b8e8d9',
  'rio': 'photo-1483729558449-99ef09a8c325',
  'mexico': 'photo-1585464231875-d9ef1f5ad396',
  'montreal': 'photo-1519178614-68673b201f36',
  'nice': 'photo-1491166617655-0723a0999cfc',
  'marseille': 'photo-1589394815804-964ed0be2eb5',
  'lyon': 'photo-1524484485831-a92ffc0de03f',
  'bordeaux': 'photo-1589981663595-a4f0e4e14fd1',
  'milan': 'photo-1520440229-6469a149ac59',
  'florence': 'photo-1543429258-434b0a4a1577',
  'venise': 'photo-1534113414509-0eec2bfb493f',
  'venice': 'photo-1534113414509-0eec2bfb493f',
  'naples': 'photo-1516483638261-f4dbaf036963',
  'santorini': 'photo-1570077188670-e3a8d69ac5ff',
  'mykonos': 'photo-1601581875309-fafbf2d3ed3a',
  'crete': 'photo-1589491106922-a44867ef9e9e',
  'copenhague': 'photo-1513622470522-26c3c8a854bc',
  'stockholm': 'photo-1509356843151-3e7d96241e11',
  'oslo': 'photo-1533929736458-ca588d08c8be',
  'dublin': 'photo-1549918864-48ac978761a4',
  'edinburgh': 'photo-1506377585622-bedcbb027afc',
  'bruxelles': 'photo-1559113513-d5e09c78b9dd',
  'zurich': 'photo-1515488764276-beab0607c1e6',
  'new delhi': 'photo-1587474260584-136574528ed5',
  'singapour': 'photo-1525625293386-3f8f99389edd',
  'singapore': 'photo-1525625293386-3f8f99389edd',
  'hong kong': 'photo-1536599018102-9f803c979b13',
  'seoul': 'photo-1534274988757-a28bf1a57c17',
  'kyoto': 'photo-1493976040374-85c8e12f0c0e',
  'los angeles': 'photo-1534190760961-74e8c1c5c3da',
  'san francisco': 'photo-1501594907352-04cda38ebc29',
  'chicago': 'photo-1494522855154-9297ac14b55f',
  'miami': 'photo-1533106497176-45ae19e68ba2',
  'la havane': 'photo-1500759285222-a95626b934cb',
  'havana': 'photo-1500759285222-a95626b934cb',
  'cancun': 'photo-1552074284-5e88ef1aef18',
  'le caire': 'photo-1572252009286-268acec5ca0a',
  'cairo': 'photo-1572252009286-268acec5ca0a',
  'cape town': 'photo-1580060839134-75a5edca2e99',
  'zanzibar': 'photo-1547471080-7cc2caa01a7e',
  'maldives': 'photo-1514282401047-d79a71a590e8',
  'maurice': 'photo-1589979481223-deb893043163',
  'mauritius': 'photo-1589979481223-deb893043163',
  'seychelles': 'photo-1589979481223-deb893043163',
  'phuket': 'photo-1589394815804-964ed0be2eb5',
};

function getDestinationImage(destination: string): string {
  const normalized = destination.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const destNormalized = destination.toLowerCase();

  for (const [key, photoId] of Object.entries(DESTINATION_IMAGES)) {
    const keyNormalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalized.includes(keyNormalized) || destNormalized.includes(key)) {
      return `https://images.unsplash.com/${photoId}?w=800&q=80`;
    }
  }
  // Fallback: generic travel image
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [durationFilter, setDurationFilter] = useState<string>('all');
  const [cloneTrip, setCloneTrip] = useState<FeedTrip | null>(null);

  const fetchFeed = useCallback(async (pageNum: number, append = false) => {
    try {
      if (pageNum === 1) setIsLoading(true);
      else setIsLoadingMore(true);

      const params = new URLSearchParams({
        tab: feedTab,
        page: pageNum.toString(),
        limit: '12',
      });

      if (searchQuery) params.set('destination', searchQuery);
      if (durationFilter !== 'all') {
        if (durationFilter === 'short') params.set('maxDays', '3');
        else if (durationFilter === 'medium') { params.set('minDays', '4'); params.set('maxDays', '7'); }
        else if (durationFilter === 'long') params.set('minDays', '8');
      }

      const response = await fetch(`/api/feed?${params}`);
      if (response.ok) {
        const data = await response.json();
        setTrips(prev => append ? [...prev, ...data.trips] : data.trips);
        setHasMore(data.hasMore);
        setPage(pageNum);
      }
    } catch (e) {
      console.error('Feed error:', e);
      toast.error('Erreur lors du chargement');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [feedTab, searchQuery, durationFilter]);

  useEffect(() => {
    fetchFeed(1);
  }, [feedTab, fetchFeed]);

  const handleLike = async (tripId: string) => {
    if (!user) { toast.error('Connectez-vous pour aimer ce voyage'); return; }
    setLikingTripId(tripId);
    try {
      const trip = trips.find(t => t.id === tripId);
      // Optimistic update
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
    } catch (e) {
      fetchFeed(1); // Revert on error
    } finally {
      setLikingTripId(null);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFeed(1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur sticky top-16 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Explorer</h1>
              <p className="text-muted-foreground text-sm">
                Découvrez les voyages de la communauté
              </p>
            </div>

            <form onSubmit={handleSearch} className="flex gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher une destination..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={durationFilter} onValueChange={setDurationFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Durée" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes</SelectItem>
                  <SelectItem value="short">Court (1-3j)</SelectItem>
                  <SelectItem value="medium">Moyen (4-7j)</SelectItem>
                  <SelectItem value="long">Long (8j+)</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" size="icon" variant="outline">
                <Search className="h-4 w-4" />
              </Button>
            </form>
          </div>

          {/* Feed tabs */}
          {user && (
            <div className="flex gap-4 mt-3">
              <button
                onClick={() => setFeedTab('discover')}
                className={cn(
                  'text-sm font-medium pb-1 border-b-2 transition-all',
                  feedTab === 'discover' ? 'text-foreground border-primary' : 'text-muted-foreground border-transparent'
                )}
              >
                Découvrir
              </button>
              <button
                onClick={() => setFeedTab('following')}
                className={cn(
                  'text-sm font-medium pb-1 border-b-2 transition-all',
                  feedTab === 'following' ? 'text-foreground border-primary' : 'text-muted-foreground border-transparent'
                )}
              >
                Abonnements
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : trips.length === 0 ? (
          <div className="text-center py-20">
            <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Aucun voyage trouvé</h2>
            <p className="text-muted-foreground mb-4">
              {feedTab === 'following'
                ? 'Aucun voyage de tes abonnements. Commence à suivre des voyageurs !'
                : searchQuery
                  ? 'Essayez une autre recherche'
                  : 'Soyez le premier à partager un voyage !'}
            </p>
            <Button onClick={() => fetchFeed(1)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {trips.map((trip, i) => (
                <motion.div
                  key={trip.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                >
                  <Card className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow">
                    {/* Image */}
                    <div
                      className="relative aspect-[4/3] overflow-hidden"
                      onClick={() => router.push(`/trip/${trip.id}`)}
                    >
                      <img
                        src={getDestinationImage(trip.destination)}
                        alt={trip.destination}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                      {trip.duration_days && (
                        <Badge className="absolute top-3 right-3 bg-black/50 text-white border-0">
                          {trip.duration_days} jours
                        </Badge>
                      )}
                      <div className="absolute bottom-3 left-3 right-3">
                        <h3 className="text-xl font-bold text-white mb-1">{trip.destination}</h3>
                        {trip.title && trip.title !== trip.destination && (
                          <p className="text-white/80 text-sm truncate">{trip.title}</p>
                        )}
                      </div>
                    </div>

                    <CardContent className="p-4">
                      {/* User info + follow */}
                      <div className="flex items-center justify-between mb-3">
                        <button
                          onClick={() => router.push(`/user/${trip.owner?.id}`)}
                          className="flex items-center gap-2 hover:opacity-80"
                        >
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={trip.owner?.avatar_url || undefined} />
                            <AvatarFallback>
                              {(trip.owner?.display_name || '?')[0].toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="text-left">
                            <p className="text-sm font-medium">{trip.owner?.display_name || 'Voyageur'}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(trip.created_at), 'd MMM', { locale: fr })}
                            </p>
                          </div>
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

                      {/* Actions */}
                      <div className="flex items-center justify-between pt-3 border-t">
                        <div className="flex items-center gap-4">
                          <button
                            onClick={() => handleLike(trip.id)}
                            disabled={likingTripId === trip.id}
                            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Heart
                              className={cn(
                                'h-5 w-5 transition-all',
                                trip.user_liked && 'fill-red-500 text-red-500'
                              )}
                            />
                            <span>{trip.likes_count || ''}</span>
                          </button>

                          <button
                            onClick={() => router.push(`/trip/${trip.id}`)}
                            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                          >
                            <MessageCircle className="h-5 w-5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCloneTrip(trip)}
                            className="text-xs gap-1"
                          >
                            <Copy className="h-4 w-4" />
                            Cloner
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/trip/${trip.id}`);
                              toast.success('Lien copié !');
                            }}
                          >
                            <Share2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            {hasMore && (
              <div className="text-center mt-8">
                <Button
                  variant="outline"
                  onClick={() => fetchFeed(page + 1, true)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Chargement...</>
                  ) : (
                    'Voir plus de voyages'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

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
  );
}
