'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, MapPin, UserPlus, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/components/auth';
import { toast } from 'sonner';
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
  is_following: boolean;
  is_close_friend: boolean;
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    if (userId) {
      fetch(`/api/users/${userId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          setProfile(data);
          if (data) setFollowing(data.is_following);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [userId]);

  const handleFollow = async () => {
    if (!user) {
      // Redirect to login then come back
      router.push(`/login?redirect=/invite/${userId}`);
      return;
    }

    setFollowLoading(true);
    try {
      const res = await fetch('/api/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ following_id: userId }),
      });
      if (res.ok) {
        setFollowing(true);
        toast.success(`Tu suis maintenant ${profile?.display_name || 'ce voyageur'} !`);
      }
    } catch (e) {
      console.error('Follow error:', e);
      toast.error('Erreur lors du follow');
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4">
        <p className="text-muted-foreground">Utilisateur non trouvé</p>
        <Button asChild variant="outline">
          <Link href="/">Retour à l&apos;accueil</Link>
        </Button>
      </div>
    );
  }

  const displayName = profile.display_name || 'Voyageur';
  const isSelf = user?.id === userId;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm text-center overflow-hidden">
        {/* Colored banner */}
        <div className="h-20 bg-gradient-to-r from-primary to-primary/80" />

        <CardContent className="p-6 -mt-10">
          {/* Avatar */}
          <Avatar className="w-20 h-20 mx-auto border-4 border-background shadow-lg">
            <AvatarImage src={profile.avatar_url || undefined} />
            <AvatarFallback className="text-2xl font-bold bg-primary text-primary-foreground">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <h1 className="text-xl font-bold mt-3">{displayName}</h1>
          {profile.username && (
            <p className="text-muted-foreground text-sm">@{profile.username}</p>
          )}
          {profile.bio && (
            <p className="text-sm text-muted-foreground mt-2">{profile.bio}</p>
          )}

          {/* Stats */}
          <div className="flex items-center justify-center gap-6 mt-4">
            <div className="text-center">
              <p className="font-bold">{profile.trips_count}</p>
              <p className="text-muted-foreground text-xs">Voyages</p>
            </div>
            <div className="text-center">
              <p className="font-bold">{profile.followers_count}</p>
              <p className="text-muted-foreground text-xs">Abonnés</p>
            </div>
            <div className="text-center">
              <p className="font-bold">{profile.following_count}</p>
              <p className="text-muted-foreground text-xs">Abonnements</p>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-6">
            {isSelf ? (
              <Button asChild variant="outline" className="w-full">
                <Link href="/profil">Voir mon profil</Link>
              </Button>
            ) : following ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 text-green-600 font-medium">
                  <UserPlus className="w-5 h-5" />
                  Tu suis {displayName}
                </div>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/user/${userId}`}>Voir le profil complet</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {displayName} t&apos;invite à le suivre sur Narae Voyage
                </p>
                <Button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className="w-full gap-2"
                  size="lg"
                >
                  {followLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : !user ? (
                    <><LogIn className="w-5 h-5" /> Se connecter et suivre</>
                  ) : (
                    <><UserPlus className="w-5 h-5" /> Suivre {displayName}</>
                  )}
                </Button>
              </div>
            )}
          </div>

          {/* Explore link */}
          <div className="mt-4 pt-4 border-t">
            <Link href="/explore" className="text-sm text-primary hover:underline">
              Découvrir les voyages de la communauté
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
