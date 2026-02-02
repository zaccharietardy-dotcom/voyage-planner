'use client';

import { useEffect, useState } from 'react';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { Settings, MapPin, Globe, LogOut, Loader2, Users, Calendar, UserPlus, Sparkles, Check, CreditCard, Crown } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useSubscription } from '@/hooks/useSubscription';
import { UserProfileCard } from '@/components/v2/social/UserProfileCard';
import { motion } from 'framer-motion';
import Link from 'next/link';

interface ProfileData {
  followers_count: number;
  following_count: number;
  trips_count: number;
  username: string | null;
}

interface TripItem {
  id: string;
  title: string;
  name: string;
  destination: string;
  start_date: string;
  duration_days: number;
  visibility: string;
}

export default function ProfilePage() {
  const { user, profile, isLoading, signOut } = useAuth();
  const router = useRouter();
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [trips, setTrips] = useState<TripItem[]>([]);
  const [followers, setFollowers] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [activeList, setActiveList] = useState<'trips' | 'followers' | 'following' | 'pro'>('trips');
  const { isPro, status, expiresAt, loading: subLoading } = useSubscription();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'yearly' | 'monthly'>('yearly');

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (user) {
      // Fetch profile data, trips, followers, following in parallel
      Promise.all([
        fetch(`/api/users/${user.id}`).then(r => r.ok ? r.json() : null),
        fetch('/api/trips').then(r => r.ok ? r.json() : []),
        fetch('/api/follows?type=followers').then(r => r.ok ? r.json() : []),
        fetch('/api/follows?type=following').then(r => r.ok ? r.json() : []),
      ]).then(([profileRes, tripsRes, followersRes, followingRes]) => {
        if (profileRes) setProfileData(profileRes);
        setTrips(tripsRes || []);
        setFollowers(followersRes || []);
        setFollowing(followingRes || []);
      });
    }
  }, [user]);

  if (isLoading) {
    return (
      <V2Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      </V2Layout>
    );
  }

  if (!user) return null;

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

  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || null;
  const email = profile?.email || user.email || '';
  const username = profileData?.username || displayName.toLowerCase().replace(/\s+/g, '_');

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  return (
    <V2Layout>
      <div className="min-h-screen pb-24">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 pt-12 pb-20 px-4">
          <div className="flex justify-between">
            <button
              onClick={async () => { await signOut(); router.push('/'); }}
              className="p-2.5 rounded-full bg-white/20 backdrop-blur-sm"
            >
              <LogOut className="w-5 h-5 text-white" />
            </button>
            <button className="p-2.5 rounded-full bg-white/20 backdrop-blur-sm">
              <Settings className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        <div className="px-4 -mt-16 relative z-10">
          {/* Avatar + name */}
          <div className="flex flex-col items-center">
            <div className="w-28 h-28 rounded-full border-4 border-[#0a0a0f] overflow-hidden shadow-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <h1 className="text-xl font-bold text-white mt-3">{displayName}</h1>
            <p className="text-gray-400 text-sm">@{username}</p>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-8 mt-5">
            <button onClick={() => setActiveList('trips')} className="text-center">
              <p className="text-white font-bold text-lg">{profileData?.trips_count || trips.length}</p>
              <p className="text-gray-500 text-xs">Voyages</p>
            </button>
            <button onClick={() => setActiveList('followers')} className="text-center">
              <p className="text-white font-bold text-lg">{profileData?.followers_count || followers.length}</p>
              <p className="text-gray-500 text-xs">Abonnés</p>
            </button>
            <button onClick={() => setActiveList('following')} className="text-center">
              <p className="text-white font-bold text-lg">{profileData?.following_count || following.length}</p>
              <p className="text-gray-500 text-xs">Abonnements</p>
            </button>
          </div>

          {/* Bio */}
          {profile?.bio && (
            <p className="text-gray-300 text-sm text-center mt-4">{profile.bio}</p>
          )}

          {/* List tabs */}
          <div className="flex gap-1 bg-[#12121a] rounded-xl p-1 mt-6 border border-[#2a2a38]">
            {(['trips', 'followers', 'following', 'pro'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveList(tab)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeList === tab
                    ? tab === 'pro'
                      ? 'bg-gradient-to-r from-[#d4a853] to-[#b8923d] text-white'
                      : 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white'
                    : 'text-gray-400'
                }`}
              >
                {tab === 'trips' ? 'Voyages' : tab === 'followers' ? 'Abonnés' : tab === 'following' ? 'Abonnements' : (
                  <span className="flex items-center justify-center gap-1">
                    <Crown className="w-3.5 h-3.5" />
                    Pro
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="mt-4">
            {activeList === 'trips' && (
              trips.length === 0 ? (
                <div className="text-center py-10">
                  <MapPin className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">Aucun voyage</p>
                  <Link href="/v2/create" className="text-indigo-400 text-sm mt-2 inline-block">
                    Créer un voyage
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {trips.map((trip, i) => (
                    <motion.button
                      key={trip.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => router.push(`/v2/trip/${trip.id}`)}
                      className="w-full bg-[#12121a] rounded-xl border border-[#2a2a38] p-3 text-left"
                    >
                      <h4 className="text-white font-medium">{trip.title || trip.name}</h4>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {trip.destination}</span>
                        <span>{trip.duration_days}j</span>
                        <span>{formatDate(trip.start_date)}</span>
                      </div>
                    </motion.button>
                  ))}
                </div>
              )
            )}

            {activeList === 'followers' && (
              followers.length === 0 ? (
                <div className="text-center py-10">
                  <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">Aucun abonné</p>
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
              )
            )}

            {activeList === 'following' && (
              following.length === 0 ? (
                <div className="text-center py-10">
                  <UserPlus className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400">Tu ne suis personne</p>
                  <p className="text-gray-500 text-sm mt-1">Découvre des voyageurs dans l&apos;onglet Parcourir</p>
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
              )
            )}

            {activeList === 'pro' && (
              <div className="space-y-4">
                {/* Current plan status */}
                <div className="bg-[#12121a] rounded-xl border border-[#2a2a38] p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      isPro ? 'bg-[#d4a853]/20' : 'bg-gray-700/50'
                    }`}>
                      {isPro ? (
                        <Crown className="w-5 h-5 text-[#d4a853]" />
                      ) : (
                        <CreditCard className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div>
                      <p className="text-white font-semibold">
                        {isPro ? 'Plan Pro actif' : 'Plan Gratuit'}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {isPro && expiresAt
                          ? `Renouvellement le ${new Date(expiresAt).toLocaleDateString('fr-FR')}`
                          : '1 voyage IA par mois'}
                      </p>
                    </div>
                  </div>
                  {isPro && (
                    <button
                      onClick={handlePortal}
                      disabled={!!checkoutLoading}
                      className="w-full py-2 rounded-lg border border-[#2a2a38] text-gray-300 text-sm hover:bg-white/5 transition-colors"
                    >
                      {checkoutLoading === 'portal' ? (
                        <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                      ) : (
                        'Gérer mon abonnement'
                      )}
                    </button>
                  )}
                </div>

                {!isPro && (
                  <>
                    {/* One-time purchase */}
                    <button
                      onClick={handleOneTime}
                      disabled={!!checkoutLoading}
                      className="w-full bg-[#12121a] rounded-xl border border-[#2a2a38] p-4 text-left hover:border-indigo-500/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white font-medium">Voyage à l&apos;unité</p>
                          <p className="text-gray-500 text-xs mt-0.5">1 voyage supplémentaire, sans engagement</p>
                        </div>
                        <div className="text-right">
                          {checkoutLoading === 'one-time' ? (
                            <Loader2 className="w-4 h-4 animate-spin text-white" />
                          ) : (
                            <span className="text-white font-bold text-lg">0.99€</span>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Pro subscription */}
                    <div className="bg-gradient-to-br from-[#d4a853]/10 to-[#b8923d]/5 rounded-xl border border-[#d4a853]/30 p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="w-4 h-4 text-[#d4a853]" />
                        <p className="text-white font-semibold">Passer Pro</p>
                      </div>
                      <ul className="space-y-2 mb-4">
                        {['Voyages illimités', 'Régénération IA illimitée', 'Export PDF & calendrier', 'Badge Pro sur le profil'].map(f => (
                          <li key={f} className="flex items-center gap-2 text-xs text-gray-300">
                            <Check className="w-3.5 h-3.5 text-[#d4a853] shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>

                      {/* Period toggle */}
                      <div className="flex gap-1 bg-black/30 rounded-lg p-1 mb-3">
                        <button
                          onClick={() => setBillingPeriod('yearly')}
                          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                            billingPeriod === 'yearly' ? 'bg-[#d4a853] text-[#0a1628]' : 'text-gray-400'
                          }`}
                        >
                          Annuel · 9.99€
                        </button>
                        <button
                          onClick={() => setBillingPeriod('monthly')}
                          className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                            billingPeriod === 'monthly' ? 'bg-[#d4a853] text-[#0a1628]' : 'text-gray-400'
                          }`}
                        >
                          Mensuel · 1.99€
                        </button>
                      </div>

                      <button
                        onClick={() => handleCheckout(billingPeriod)}
                        disabled={!!checkoutLoading}
                        className="w-full py-2.5 rounded-lg bg-[#d4a853] hover:bg-[#b8923d] text-[#0a1628] font-semibold text-sm transition-colors"
                      >
                        {checkoutLoading === 'pro' ? (
                          <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                        ) : billingPeriod === 'yearly' ? (
                          'S\'abonner — 9.99€/an'
                        ) : (
                          'S\'abonner — 1.99€/mois'
                        )}
                      </button>
                      {billingPeriod === 'yearly' && (
                        <p className="text-center text-[10px] text-gray-500 mt-2">
                          soit 0.83€/mois · économise 58%
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </V2Layout>
  );
}
