'use client';

import { LogOut, Loader2, ArrowLeft, MapPin, Settings, Users, UserPlus, Calendar, Crown, CreditCard, Sparkles, Check } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserProfileCard } from '@/components/social/UserProfileCard';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProfileData {
  followers_count: number;
  following_count: number;
  trips_count: number;
  username: string | null;
  bio: string | null;
}

interface TripItem {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  duration_days: number;
}

export default function ProfilPage() {
  const { user, profile, isLoading, signOut } = useAuth();
  const router = useRouter();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('trips');
  const [dataLoading, setDataLoading] = useState(true);
  const { isPro, status, expiresAt, loading: subLoading } = useSubscription();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'yearly' | 'monthly'>('yearly');

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;

    const fetchData = async (retries = 0) => {
      setDataLoading(true);
      try {
        const responses = await Promise.all([
          fetch(`/api/users/${user.id}`),
          fetch('/api/trips'),
          fetch('/api/follows?type=followers'),
          fetch('/api/follows?type=following'),
        ]);

        // If any response is 401, auth cookies not ready — retry
        const has401 = responses.some(r => r.status === 401);
        if (has401 && retries < 3) {
          setTimeout(() => fetchData(retries + 1), (retries + 1) * 800);
          return;
        }

        const [profileRes, tripsRes, followersRes, followingRes] = await Promise.all(
          responses.map(r => r.ok ? r.json() : null)
        );

        if (profileRes) setProfileData(profileRes);
        setTrips(tripsRes || []);
        setFollowers(followersRes || []);
        setFollowing(followingRes || []);
      } catch (e) {
        if (retries < 3) {
          setTimeout(() => fetchData(retries + 1), (retries + 1) * 800);
          return;
        }
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [user]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || null;
  const email = profile?.email || user.email || '';
  const username = profileData?.username || displayName.toLowerCase().replace(/\s+/g, '_');

  const handleCheckout = async (plan: 'monthly' | 'yearly') => {
    setCheckoutLoading('pro');
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) { console.error(e); }
    finally { setCheckoutLoading(null); }
  };

  const handleOneTime = async () => {
    setCheckoutLoading('one-time');
    try {
      const res = await fetch('/api/billing/one-time', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) { console.error(e); }
    finally { setCheckoutLoading(null); }
  };

  const handlePortal = async () => {
    setCheckoutLoading('portal');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (e) { console.error(e); }
    finally { setCheckoutLoading(null); }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="relative h-32 bg-gradient-to-r from-primary to-primary/80">
        <Link
          href="/"
          className="absolute top-4 left-4 p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </Link>
        <Link
          href="/preferences"
          className="absolute top-4 right-4 p-2 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-colors"
        >
          <Settings className="w-5 h-5 text-white" />
        </Link>
      </div>

      {/* Profile info */}
      <div className="px-4 -mt-16 relative z-10 max-w-lg mx-auto">
        <div className="flex flex-col items-center">
          <Avatar className="w-24 h-24 border-4 border-background shadow-lg">
            <AvatarImage src={avatarUrl || undefined} />
            <AvatarFallback className="text-3xl font-bold bg-primary text-primary-foreground">
              {displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <h1 className="text-2xl font-bold mt-4">{displayName}</h1>
          <p className="text-muted-foreground text-sm">@{username}</p>
          {profileData?.bio && (
            <p className="text-sm text-center mt-2 text-muted-foreground">{profileData.bio}</p>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-center gap-8 mt-5">
          <button onClick={() => setActiveTab('trips')} className="text-center">
            <p className="font-bold text-lg">
              {dataLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : trips.length}
            </p>
            <p className="text-muted-foreground text-xs">Voyages</p>
          </button>
          <button onClick={() => setActiveTab('followers')} className="text-center">
            <p className="font-bold text-lg">
              {dataLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : followers.length}
            </p>
            <p className="text-muted-foreground text-xs">Abonnés</p>
          </button>
          <button onClick={() => setActiveTab('following')} className="text-center">
            <p className="font-bold text-lg">
              {dataLoading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : following.length}
            </p>
            <p className="text-muted-foreground text-xs">Abonnements</p>
          </button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="w-full">
            <TabsTrigger value="trips" className="flex-1">Voyages</TabsTrigger>
            <TabsTrigger value="followers" className="flex-1">Abonnés</TabsTrigger>
            <TabsTrigger value="following" className="flex-1">Abonnements</TabsTrigger>
            <TabsTrigger value="pro" className="flex-1 gap-1">
              <Crown className="w-3.5 h-3.5" />
              Pro
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trips" className="mt-4">
            {trips.length === 0 ? (
              <div className="text-center py-10">
                <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Aucun voyage</p>
                <Link href="/plan" className="text-primary text-sm mt-2 inline-block">
                  Créer un voyage
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
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
          </TabsContent>

          <TabsContent value="followers" className="mt-4">
            {followers.length === 0 ? (
              <div className="text-center py-10">
                <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Aucun abonné</p>
              </div>
            ) : (
              <div className="space-y-1">
                {followers.map((f: any) => (
                  <UserProfileCard
                    key={f.id}
                    user={f.follower || { id: '', display_name: 'Utilisateur', avatar_url: null }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="following" className="mt-4">
            {following.length === 0 ? (
              <div className="text-center py-10">
                <UserPlus className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Tu ne suis personne</p>
                <p className="text-muted-foreground text-sm mt-1">
                  Découvre des voyageurs dans l&apos;onglet Explorer
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {following.map((f: any) => (
                  <UserProfileCard
                    key={f.id}
                    user={f.following || { id: '', display_name: 'Utilisateur', avatar_url: null }}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="pro" className="mt-4 space-y-4">
            {/* Current plan */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    isPro ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-muted'
                  )}>
                    {isPro ? (
                      <Crown className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <CreditCard className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold">{isPro ? 'Plan Pro actif' : 'Plan Gratuit'}</p>
                    <p className="text-xs text-muted-foreground">
                      {isPro && expiresAt
                        ? `Renouvellement le ${format(new Date(expiresAt), 'd MMMM yyyy', { locale: fr })}`
                        : '1 voyage IA par mois'}
                    </p>
                  </div>
                </div>
                {isPro && (
                  <Button
                    variant="outline"
                    className="w-full mt-3"
                    onClick={handlePortal}
                    disabled={!!checkoutLoading}
                  >
                    {checkoutLoading === 'portal' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Gérer mon abonnement'}
                  </Button>
                )}
              </CardContent>
            </Card>

            {!isPro && (
              <>
                {/* One-time */}
                <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={handleOneTime}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">Voyage à l&apos;unité</p>
                      <p className="text-xs text-muted-foreground">1 voyage supplémentaire, sans engagement</p>
                    </div>
                    {checkoutLoading === 'one-time' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <span className="font-bold text-lg">0.99€</span>
                    )}
                  </CardContent>
                </Card>

                {/* Pro subscription */}
                <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <p className="font-semibold">Passer Pro</p>
                    </div>
                    <ul className="space-y-2 mb-4">
                      {['Voyages illimités', 'Régénération IA illimitée', 'Export PDF & calendrier', 'Badge Pro sur le profil'].map(f => (
                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Check className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {/* Period toggle */}
                    <div className="flex gap-1 bg-muted rounded-lg p-1 mb-3">
                      <button
                        onClick={() => setBillingPeriod('yearly')}
                        className={cn(
                          'flex-1 py-1.5 rounded-md text-xs font-medium transition-all',
                          billingPeriod === 'yearly' ? 'bg-amber-500 text-white shadow-sm' : 'text-muted-foreground'
                        )}
                      >
                        Annuel · 9.99€
                      </button>
                      <button
                        onClick={() => setBillingPeriod('monthly')}
                        className={cn(
                          'flex-1 py-1.5 rounded-md text-xs font-medium transition-all',
                          billingPeriod === 'monthly' ? 'bg-amber-500 text-white shadow-sm' : 'text-muted-foreground'
                        )}
                      >
                        Mensuel · 1.99€
                      </button>
                    </div>

                    <Button
                      className="w-full bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={() => handleCheckout(billingPeriod)}
                      disabled={!!checkoutLoading}
                    >
                      {checkoutLoading === 'pro' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : billingPeriod === 'yearly' ? (
                        "S'abonner — 9.99€/an"
                      ) : (
                        "S'abonner — 1.99€/mois"
                      )}
                    </Button>
                    {billingPeriod === 'yearly' && (
                      <p className="text-center text-[10px] text-muted-foreground mt-2">
                        soit 0.83€/mois · économise 58%
                      </p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Quick actions */}
        <div className="mt-6 space-y-3">
          <Link href="/mes-voyages" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Mes voyages</h3>
                  <p className="text-sm text-muted-foreground">Voir et gérer mes voyages</p>
                </div>
                <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/preferences" className="block">
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Settings className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Préférences de voyage</h3>
                  <p className="text-sm text-muted-foreground">Style, budget, régime alimentaire</p>
                </div>
                <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Sign out */}
        <Button
          variant="outline"
          onClick={handleSignOut}
          className="w-full mt-8 mb-8 text-destructive border-destructive/30 hover:bg-destructive/10"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Se déconnecter
        </Button>
      </div>
    </div>
  );
}
