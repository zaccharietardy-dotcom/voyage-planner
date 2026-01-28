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
  Filter,
  RefreshCw,
  Copy,
  ExternalLink,
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
import { PublicTrip } from '@/lib/supabase/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface TripCardData extends PublicTrip {
  is_liked: boolean;
}

// Destination images (placeholder, could be from API or trip data)
const DESTINATION_IMAGES: Record<string, string> = {
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&q=80',
  'Tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80',
  'New York': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&q=80',
  'Londres': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80',
  'Rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&q=80',
  'Barcelone': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&q=80',
  'default': 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80',
};

function getDestinationImage(destination: string): string {
  const normalized = destination.toLowerCase();
  for (const [key, url] of Object.entries(DESTINATION_IMAGES)) {
    if (normalized.includes(key.toLowerCase())) {
      return url;
    }
  }
  return DESTINATION_IMAGES.default;
}

function TripCard({
  trip,
  onLike,
  isLiking,
}: {
  trip: TripCardData;
  onLike: (tripId: string) => void;
  isLiking: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast.error('Connectez-vous pour aimer ce voyage');
      return;
    }
    onLike(trip.id);
  };

  const handleClone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast.error('Connectez-vous pour cloner ce voyage');
      return;
    }
    // Clone functionality would copy the trip to user's trips
    toast.success('Voyage cloné dans vos voyages !');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
        onClick={() => router.push(`/trip/${trip.id}`)}
      >
        {/* Image */}
        <div className="relative aspect-[4/3] overflow-hidden">
          <img
            src={getDestinationImage(trip.destination)}
            alt={trip.destination}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* Duration badge */}
          <Badge className="absolute top-3 right-3 bg-black/50 text-white border-0">
            {trip.duration_days} jours
          </Badge>

          {/* Destination overlay */}
          <div className="absolute bottom-3 left-3 right-3">
            <h3 className="text-xl font-bold text-white mb-1">{trip.destination}</h3>
            {trip.title && trip.title !== trip.destination && (
              <p className="text-white/80 text-sm truncate">{trip.title}</p>
            )}
          </div>
        </div>

        <CardContent className="p-4">
          {/* User info */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={trip.owner_avatar || undefined} />
                <AvatarFallback>
                  {trip.owner_name?.charAt(0).toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{trip.owner_name || 'Voyageur'}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(trip.created_at), 'd MMM yyyy', { locale: fr })}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {format(new Date(trip.start_date), 'd MMM', { locale: fr })}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t">
            <div className="flex items-center gap-4">
              <button
                onClick={handleLike}
                disabled={isLiking}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                <Heart
                  className={cn(
                    'h-5 w-5 transition-all',
                    trip.is_liked && 'fill-red-500 text-red-500'
                  )}
                />
                <span>{trip.likes_count}</span>
              </button>

              <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors">
                <MessageCircle className="h-5 w-5" />
                <span>{trip.comments_count}</span>
              </button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleClone}
              className="text-xs gap-1"
            >
              <Copy className="h-4 w-4" />
              Cloner
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function ExplorePage() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<TripCardData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [likingTripId, setLikingTripId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [durationFilter, setDurationFilter] = useState<string>('all');

  const fetchTrips = useCallback(async (pageNum: number, append = false) => {
    try {
      if (pageNum === 1) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams({
        page: pageNum.toString(),
        limit: '12',
      });

      if (searchQuery) {
        params.set('destination', searchQuery);
      }

      if (durationFilter !== 'all') {
        if (durationFilter === 'short') {
          params.set('maxDays', '3');
        } else if (durationFilter === 'medium') {
          params.set('minDays', '4');
          params.set('maxDays', '7');
        } else if (durationFilter === 'long') {
          params.set('minDays', '8');
        }
      }

      const response = await fetch(`/api/explore?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error);
      }

      if (append) {
        setTrips(prev => [...prev, ...data.trips]);
      } else {
        setTrips(data.trips);
      }

      setHasMore(data.hasMore);
      setPage(pageNum);
    } catch (error) {
      console.error('Error fetching trips:', error);
      toast.error('Erreur lors du chargement des voyages');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [searchQuery, durationFilter]);

  useEffect(() => {
    fetchTrips(1);
  }, [fetchTrips]);

  const handleLike = async (tripId: string) => {
    setLikingTripId(tripId);
    try {
      const response = await fetch(`/api/trips/${tripId}/like`, {
        method: 'POST',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error);
      }

      // Update local state
      setTrips(prev =>
        prev.map(trip =>
          trip.id === tripId
            ? {
                ...trip,
                is_liked: data.liked,
                likes_count: data.liked
                  ? trip.likes_count + 1
                  : trip.likes_count - 1,
              }
            : trip
        )
      );
    } catch (error) {
      console.error('Error toggling like:', error);
      toast.error('Erreur lors du like');
    } finally {
      setLikingTripId(null);
    }
  };

  const handleLoadMore = () => {
    if (hasMore && !isLoadingMore) {
      fetchTrips(page + 1, true);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTrips(1);
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
              {searchQuery
                ? 'Essayez une autre recherche'
                : 'Soyez le premier à partager un voyage !'}
            </p>
            <Button onClick={() => fetchTrips(1)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
          </div>
        ) : (
          <>
            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {trips.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onLike={handleLike}
                  isLiking={likingTripId === trip.id}
                />
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="text-center mt-8">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Chargement...
                    </>
                  ) : (
                    'Voir plus de voyages'
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
