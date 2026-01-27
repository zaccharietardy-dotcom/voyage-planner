'use client';

import { Settings, MapPin, Route, Globe, Award, LogOut, Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';

export default function ProfilPage() {
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
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
      </div>
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
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header with banner */}
      <div className="relative h-52 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700">
        <Link
          href="/"
          className="absolute top-4 left-4 p-3 rounded-full bg-black/20 backdrop-blur-sm hover:bg-black/30 transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-white" />
        </Link>
        <button className="absolute top-4 right-4 p-3 rounded-full bg-black/20 backdrop-blur-sm hover:bg-black/30 transition-colors">
          <Settings className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* Profile info */}
      <div className="px-6 -mt-24 relative z-10 max-w-2xl mx-auto">
        <div className="flex flex-col items-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="w-40 h-40 rounded-full border-4 border-[#0a0a0f] object-cover shadow-2xl"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-40 h-40 rounded-full border-4 border-[#0a0a0f] bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-2xl">
              <span className="text-5xl font-bold text-white">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <h1 className="text-3xl font-bold text-white mt-5">{displayName}</h1>
          <p className="text-gray-400 text-base mt-1">@{username}</p>
          <p className="text-gray-500 text-sm mt-1">{email}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mt-10">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center p-5 rounded-2xl bg-[#12121a] border border-[#2a2a38] hover:border-indigo-500/50 transition-colors"
            >
              <stat.icon className="w-8 h-8 text-indigo-400 mb-3" />
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              <p className="text-sm text-gray-500 text-center mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Bio */}
        <div className="mt-10 p-6 rounded-2xl bg-[#12121a] border border-[#2a2a38]">
          <h3 className="text-lg font-semibold text-white mb-3">À propos</h3>
          <p className="text-gray-300 text-base leading-relaxed">
            {profile?.bio || "Passionné de voyages et de découvertes. J'adore explorer de nouvelles cultures et partager mes itinéraires avec la communauté."}
          </p>
        </div>

        {/* Visited countries mini-globe placeholder */}
        <div className="mt-10">
          <h3 className="text-lg font-semibold text-white mb-4">Mes destinations</h3>
          <div className="aspect-video rounded-2xl bg-[#12121a] border border-[#2a2a38] flex items-center justify-center">
            <div className="text-center">
              <Globe className="w-20 h-20 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400 text-lg">Mini-globe personnel</p>
              <p className="text-gray-600 text-sm mt-1">(À venir)</p>
            </div>
          </div>
        </div>

        {/* My trips */}
        <div className="mt-10 mb-10">
          <h3 className="text-lg font-semibold text-white mb-4">Mes voyages</h3>
          <div className="p-8 rounded-2xl bg-[#12121a] border border-[#2a2a38] text-center">
            <MapPin className="w-14 h-14 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">Aucun voyage pour l'instant</p>
            <p className="text-gray-500 text-sm mt-2">Crée ton premier voyage !</p>
            <Link
              href="/"
              className="inline-block mt-6 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
            >
              Planifier un voyage
            </Link>
          </div>
        </div>

        {/* Sign out button */}
        <button
          onClick={handleSignOut}
          className="w-full mb-10 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center gap-3"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Se déconnecter</span>
        </button>
      </div>
    </div>
  );
}
