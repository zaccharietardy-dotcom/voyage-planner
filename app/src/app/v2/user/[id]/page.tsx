'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { FollowButton } from '@/components/v2/social/FollowButton';
import { ArrowLeft, MapPin, Calendar, Users, Globe, Lock, Users2, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface UserProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
  bio: string | null;
  is_public: boolean;
  followers_count: number;
  following_count: number;
  trips_count: number;
  isFollowing: boolean;
  isCloseFriend: boolean;
  isOwnProfile: boolean;
}

interface UserTrip {
  id: string;
  title: string;
  name: string;
  destination: string;
  start_date: string;
  duration_days: number;
  visibility: string;
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trips, setTrips] = useState<UserTrip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, tripsRes] = await Promise.all([
          fetch(`/api/users/${params.id}`),
          fetch(`/api/users/${params.id}/trips`),
        ]);
        if (profileRes.ok) setProfile(await profileRes.json());
        if (tripsRes.ok) setTrips(await tripsRes.json());
      } catch (e) {
        console.error('Error loading profile:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) {
    return (
      <V2Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      </V2Layout>
    );
  }

  if (!profile) {
    return (
      <V2Layout>
        <div className="min-h-screen flex flex-col items-center justify-center p-4">
          <p className="text-white text-lg mb-4">Utilisateur non trouvé</p>
          <button onClick={() => router.back()} className="text-indigo-400">Retour</button>
        </div>
      </V2Layout>
    );
  }

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <V2Layout>
      <div className="min-h-screen pb-24">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 pt-12 pb-8 px-4">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-full bg-white/20 backdrop-blur-sm mb-4"
          >
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>

          <div className="flex items-start gap-4">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center overflow-hidden flex-shrink-0">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-white font-bold text-2xl">
                  {(profile.display_name || '?')[0].toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-white">{profile.display_name || 'Utilisateur'}</h1>
              {profile.username && (
                <p className="text-white/60 text-sm">@{profile.username}</p>
              )}
              {profile.bio && (
                <p className="text-white/80 text-sm mt-1">{profile.bio}</p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6 mt-4">
            <div className="text-center">
              <p className="text-white font-bold">{profile.trips_count}</p>
              <p className="text-white/60 text-xs">Voyages</p>
            </div>
            <div className="text-center">
              <p className="text-white font-bold">{profile.followers_count}</p>
              <p className="text-white/60 text-xs">Abonnés</p>
            </div>
            <div className="text-center">
              <p className="text-white font-bold">{profile.following_count}</p>
              <p className="text-white/60 text-xs">Abonnements</p>
            </div>
            {!profile.isOwnProfile && (
              <div className="ml-auto">
                <FollowButton
                  userId={profile.id}
                  initialIsFollowing={profile.isFollowing}
                  initialIsCloseFriend={profile.isCloseFriend}
                />
              </div>
            )}
          </div>
        </div>

        {/* Trips */}
        <div className="px-4 mt-4">
          <h2 className="text-white font-semibold mb-3">Voyages</h2>
          {trips.length === 0 ? (
            <p className="text-gray-500 text-sm">Aucun voyage visible</p>
          ) : (
            <div className="space-y-3">
              {trips.map((trip, i) => (
                <motion.button
                  key={trip.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => router.push(`/v2/trip/${trip.id}`)}
                  className="w-full bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4 text-left hover:border-indigo-500/50 transition-colors"
                >
                  <h3 className="text-white font-medium">{trip.title || trip.name}</h3>
                  <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5" /> {trip.destination}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> {formatDate(trip.start_date)}
                    </span>
                    <span>{trip.duration_days}j</span>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </div>
    </V2Layout>
  );
}
