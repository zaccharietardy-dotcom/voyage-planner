'use client';

import { V2Layout } from '@/components/v2/layout/V2Layout';
import { Settings, MapPin, Route, Globe, Award, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ProfilePage() {
  const { user, profile, isLoading, signOut } = useAuth();
  const router = useRouter();

  // Rediriger si non connecté
  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  const stats = [
    { icon: MapPin, label: 'Pays visités', value: 0 },
    { icon: Route, label: 'Km parcourus', value: '0' },
    { icon: Globe, label: 'Voyages', value: 0 },
    { icon: Award, label: 'Badges', value: 0 },
  ];

  if (isLoading) {
    return (
      <V2Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      </V2Layout>
    );
  }

  if (!user) {
    return null;
  }

  // Données du profil Google ou Supabase
  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur';
  const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || null;
  const email = profile?.email || user.email || '';
  const username = displayName.toLowerCase().replace(/\s+/g, '_');

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <V2Layout>
      <div className="min-h-screen">
        {/* Header with banner */}
        <div className="relative h-48 bg-gradient-to-br from-indigo-600 to-violet-700">
          <button className="absolute top-4 right-4 p-3 rounded-full bg-black/20 backdrop-blur-sm hover:bg-black/30 transition-colors">
            <Settings className="w-6 h-6 text-white" />
          </button>
          <button
            onClick={handleSignOut}
            className="absolute top-4 left-4 p-3 rounded-full bg-black/20 backdrop-blur-sm hover:bg-red-500/50 transition-colors"
          >
            <LogOut className="w-6 h-6 text-white" />
          </button>
        </div>

        {/* Profile info */}
        <div className="px-4 -mt-20 relative z-10">
          <div className="flex flex-col items-center">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-36 h-36 rounded-full border-4 border-[#0a0a0f] object-cover shadow-xl"
              />
            ) : (
              <div className="w-36 h-36 rounded-full border-4 border-[#0a0a0f] bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-xl">
                <span className="text-4xl font-bold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <h1 className="text-2xl font-bold text-white mt-4">{displayName}</h1>
            <p className="text-gray-400 text-sm">@{username}</p>
            <p className="text-gray-500 text-xs mt-1">{email}</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mt-8">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex flex-col items-center p-4 rounded-xl bg-[#12121a] border border-[#2a2a38]"
              >
                <stat.icon className="w-7 h-7 text-indigo-400 mb-2" />
                <p className="text-xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-gray-500 text-center">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Bio */}
          <div className="mt-8 p-5 rounded-xl bg-[#12121a] border border-[#2a2a38]">
            <p className="text-gray-300 text-base leading-relaxed">
              {profile?.bio || "Passionné de voyages et de découvertes. J'adore explorer de nouvelles cultures et partager mes itinéraires avec la communauté."}
            </p>
          </div>

          {/* Visited countries mini-globe placeholder */}
          <div className="mt-8">
            <h3 className="text-base font-semibold text-gray-400 mb-4">Mes destinations</h3>
            <div className="aspect-video rounded-xl bg-[#12121a] border border-[#2a2a38] flex items-center justify-center">
              <div className="text-center">
                <Globe className="w-16 h-16 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 text-base">Mini-globe personnel</p>
                <p className="text-gray-600 text-sm">(À venir)</p>
              </div>
            </div>
          </div>

          {/* My trips */}
          <div className="mt-8 mb-28">
            <h3 className="text-base font-semibold text-gray-400 mb-4">Mes voyages</h3>
            <div className="p-6 rounded-xl bg-[#12121a] border border-[#2a2a38] text-center">
              <MapPin className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400">Aucun voyage pour l'instant</p>
              <p className="text-gray-500 text-sm mt-1">Crée ton premier voyage !</p>
            </div>
          </div>
        </div>
      </div>
    </V2Layout>
  );
}
