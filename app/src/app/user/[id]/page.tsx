'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Loader2, Calendar, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FollowButton } from '@/components/social/FollowButton';
import { useAuth } from '@/components/auth';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import Link from 'next/link';

interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
  bio: string | null;
  followers_count: number;
  following_count: number;
  trips_count: number;
  isFollowing: boolean;
  isCloseFriend: boolean;
}

interface UserTrip {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  duration_days: number;
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trips, setTrips] = useState<UserTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingChat, setStartingChat] = useState(false);

  const handleStartChat = async () => {
    if (startingChat) return;
    setStartingChat(true);
    try {
      const res = await fetch('/api/messages/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) throw new Error('Erreur');
      const data = await res.json();
      router.push(`/messages/${data.conversation_id}`);
    } catch (e) {
      console.error('Start chat error:', e);
      setStartingChat(false);
    }
  };

  useEffect(() => {
    if (userId) {
      Promise.all([
        fetch(`/api/users/${userId}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/users/${userId}/trips`).then(r => r.ok ? r.json() : []),
      ]).then(([profileRes, tripsRes]) => {
        setProfile(profileRes);
        setTrips(tripsRes || []);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Utilisateur non trouvé</p>
        <Button variant="outline" onClick={() => router.back()}>Retour</Button>
      </div>
    );
  }

  const displayName = profile.display_name || 'Utilisateur';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="relative h-32 bg-gradient-to-r from-primary to-primary/80">
        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
      </div>

      <div className="px-4 -mt-16 relative z-10 max-w-lg mx-auto">
        {/* Avatar + name */}
        <div className="flex flex-col items-center">
          <Avatar className="w-24 h-24 border-4 border-background shadow-lg">
            <AvatarImage src={profile.avatar_url || undefined} />
            <AvatarFallback className="text-3xl font-bold bg-primary text-primary-foreground">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h1 className="text-2xl font-bold mt-3">{displayName}</h1>
          {profile.username && (
            <p className="text-muted-foreground text-sm">@{profile.username}</p>
          )}
          {profile.bio && (
            <p className="text-sm text-center mt-2 text-muted-foreground">{profile.bio}</p>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-center gap-8 mt-5">
          <div className="text-center">
            <p className="font-bold text-lg">{profile.trips_count}</p>
            <p className="text-muted-foreground text-xs">Voyages</p>
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">{profile.followers_count}</p>
            <p className="text-muted-foreground text-xs">Abonnés</p>
          </div>
          <div className="text-center">
            <p className="font-bold text-lg">{profile.following_count}</p>
            <p className="text-muted-foreground text-xs">Abonnements</p>
          </div>
        </div>

        {/* Follow + Message buttons */}
        {user && user.id !== userId && (
          <div className="flex justify-center gap-2 mt-4">
            <FollowButton
              userId={userId}
              initialIsFollowing={profile.isFollowing}
              initialIsCloseFriend={profile.isCloseFriend}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleStartChat}
              disabled={startingChat}
              className="gap-1"
            >
              {startingChat ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageCircle className="h-4 w-4" />
              )}
              Message
            </Button>
          </div>
        )}

        {/* Trips */}
        <div className="mt-6">
          <h2 className="font-semibold mb-3">Voyages</h2>
          {trips.length === 0 ? (
            <div className="text-center py-10">
              <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">Aucun voyage public</p>
            </div>
          ) : (
            <div className="space-y-3 mb-8">
              {trips.map((trip) => (
                <Card
                  key={trip.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => router.push(`/trip/${trip.id}`)}
                >
                  <CardContent className="p-3">
                    <h4 className="font-medium">{trip.title}</h4>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {trip.destination}</span>
                      <span>{trip.duration_days}j</span>
                      <span>{format(new Date(trip.start_date), 'd MMM', { locale: fr })}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
