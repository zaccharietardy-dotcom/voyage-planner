'use client';

import { useEffect, useState } from 'react';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { SearchBar } from '@/components/v2/ui/SearchBar';
import { UserProfileCard } from '@/components/v2/social/UserProfileCard';
import { FollowButton } from '@/components/v2/social/FollowButton';
import { useAuth } from '@/components/auth';
import { Users, UserPlus, Bell, Loader2, Check, X } from 'lucide-react';
import { motion } from 'framer-motion';

export default function CommunityPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'suggestions'>('friends');
  const [closeFriends, setCloseFriends] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cfRes, reqRes, followRes] = await Promise.all([
        fetch('/api/close-friends?type=accepted').then(r => r.ok ? r.json() : []),
        fetch('/api/close-friends?type=received').then(r => r.ok ? r.json() : []),
        fetch('/api/follows?type=following').then(r => r.ok ? r.json() : []),
      ]);
      setCloseFriends(cfRes);
      setRequests(reqRes);
      setFollowing(followRes);
    } catch (e) {
      console.error('Error loading community data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestResponse = async (requestId: string, status: 'accepted' | 'rejected') => {
    try {
      await fetch(`/api/close-friends/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setRequests(prev => prev.filter(r => r.id !== requestId));
      if (status === 'accepted') loadData();
    } catch (e) {
      console.error('Error responding:', e);
    }
  };

  if (!user) {
    return (
      <V2Layout>
        <div className="min-h-screen flex items-center justify-center p-4">
          <p className="text-gray-400">Connecte-toi pour voir ta communauté</p>
        </div>
      </V2Layout>
    );
  }

  return (
    <V2Layout>
      <div className="min-h-screen pb-24">
        {/* Header */}
        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 pt-12 pb-6 px-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Communauté</h1>
              <p className="text-white/70 text-sm">Tes amis et connexions</p>
            </div>
            {requests.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20">
                <Bell className="w-4 h-4 text-white" />
                <span className="text-white text-sm font-medium">{requests.length}</span>
              </div>
            )}
          </div>

          <SearchBar placeholder="Rechercher..." onSearch={setSearchQuery} />
        </div>

        {/* Tabs */}
        <div className="px-4 mt-4">
          <div className="flex gap-1 bg-[#12121a] rounded-xl p-1 border border-[#2a2a38]">
            <button
              onClick={() => setActiveTab('friends')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'friends' ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white' : 'text-gray-400'
              }`}
            >
              Amis proches
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all relative ${
                activeTab === 'requests' ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white' : 'text-gray-400'
              }`}
            >
              Demandes
              {requests.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                  {requests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('suggestions')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'suggestions' ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white' : 'text-gray-400'
              }`}
            >
              Abonnements
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          ) : (
            <>
              {activeTab === 'friends' && (
                closeFriends.length === 0 ? (
                  <div className="text-center py-16">
                    <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400 font-medium">Pas encore d&apos;amis proches</p>
                    <p className="text-gray-500 text-sm mt-1">
                      Envoie des demandes d&apos;ami proche depuis le profil d&apos;un voyageur
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {closeFriends.map((cf: any) => {
                      const friend = cf.requester?.id === user.id ? cf.target : cf.requester;
                      return friend ? (
                        <UserProfileCard
                          key={cf.id}
                          user={friend}
                          subtitle="Ami proche"
                        />
                      ) : null;
                    })}
                  </div>
                )
              )}

              {activeTab === 'requests' && (
                requests.length === 0 ? (
                  <div className="text-center py-16">
                    <Bell className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">Aucune demande en attente</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requests.map((req: any) => (
                      <motion.div
                        key={req.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[#12121a] rounded-xl border border-[#2a2a38] p-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center overflow-hidden">
                            {req.requester?.avatar_url ? (
                              <img src={req.requester.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-white font-semibold text-sm">
                                {(req.requester?.display_name || '?')[0].toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-white font-medium text-sm">{req.requester?.display_name}</p>
                            <p className="text-gray-500 text-xs">Veut devenir ami proche</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRequestResponse(req.id, 'accepted')}
                              className="p-2 rounded-lg bg-green-500/20 text-green-400"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleRequestResponse(req.id, 'rejected')}
                              className="p-2 rounded-lg bg-red-500/20 text-red-400"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )
              )}

              {activeTab === 'suggestions' && (
                following.length === 0 ? (
                  <div className="text-center py-16">
                    <UserPlus className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">Tu ne suis personne</p>
                    <p className="text-gray-500 text-sm mt-1">
                      Découvre des voyageurs dans l&apos;onglet Parcourir
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
                )
              )}
            </>
          )}
        </div>
      </div>
    </V2Layout>
  );
}
