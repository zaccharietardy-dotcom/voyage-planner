'use client';

import { V2Layout } from '@/components/v2/layout/V2Layout';
import { TravelerCard } from '@/components/v2/ui/TravelerCard';
import { TripFeedCard } from '@/components/v2/ui/TripFeedCard';
import { SearchBar } from '@/components/v2/ui/SearchBar';
import { mockTravelers, mockRecentTrips } from '@/lib/v2/mockData';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Compass, TrendingUp, Flame, Globe, MapPin, Star } from 'lucide-react';

const trendingDestinations = [
  { name: 'Kyoto', country: 'Japon', travelers: 234, trend: '+45%', image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=300&h=200&fit=crop' },
  { name: 'Lisbonne', country: 'Portugal', travelers: 189, trend: '+38%', image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=300&h=200&fit=crop' },
  { name: 'Bali', country: 'Indonésie', travelers: 312, trend: '+52%', image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=300&h=200&fit=crop' },
];

const topTravelers = [
  { name: 'Sophie M.', countries: 42, followers: '12.5k', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop' },
  { name: 'Lucas D.', countries: 38, followers: '9.8k', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop' },
  { name: 'Emma L.', countries: 35, followers: '8.2k', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop' },
];

export default function CommunityPage() {
  const [activeTab, setActiveTab] = useState<'feed' | 'travelers' | 'trending'>('feed');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTravelers = mockTravelers.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.location.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <V2Layout>
      <div className="min-h-screen pb-24">
        {/* Header with gradient */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 pt-12 pb-6 px-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Communauté</h1>
              <p className="text-white/70 text-sm">Explore et connecte-toi</p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/20 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white text-sm font-medium">{mockTravelers.filter(t => t.isOnline).length} en ligne</span>
            </div>
          </div>

          <SearchBar
            placeholder="Rechercher voyageurs, destinations..."
            onSearch={setSearchQuery}
            className="mb-2"
          />
        </div>

        {/* Stats cards */}
        <div className="px-4 -mt-3 relative z-10">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-[#12121a]/90 backdrop-blur-xl rounded-xl border border-[#2a2a38] p-3 text-center">
              <Users className="w-5 h-5 text-indigo-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">2.4k</p>
              <p className="text-[10px] text-gray-500">Voyageurs</p>
            </div>
            <div className="bg-[#12121a]/90 backdrop-blur-xl rounded-xl border border-[#2a2a38] p-3 text-center">
              <Globe className="w-5 h-5 text-violet-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">156</p>
              <p className="text-[10px] text-gray-500">Pays</p>
            </div>
            <div className="bg-[#12121a]/90 backdrop-blur-xl rounded-xl border border-[#2a2a38] p-3 text-center">
              <Compass className="w-5 h-5 text-amber-400 mx-auto mb-1" />
              <p className="text-lg font-bold text-white">892</p>
              <p className="text-[10px] text-gray-500">Voyages</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-4 mt-4 mb-4">
          {[
            { id: 'feed', label: 'Feed', icon: Compass },
            { id: 'travelers', label: 'Voyageurs', icon: Users },
            { id: 'trending', label: 'Tendances', icon: TrendingUp },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-medium text-sm transition-all ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25'
                  : 'bg-[#1a1a24] text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-4">
          <AnimatePresence mode="wait">
            {activeTab === 'feed' && (
              <motion.div
                key="feed"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                {/* Top travelers horizontal scroll */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                    <Star className="w-4 h-4 text-amber-400" />
                    Top Voyageurs
                  </h3>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
                    {topTravelers.map((traveler, i) => (
                      <div
                        key={i}
                        className="flex-shrink-0 w-24 text-center"
                      >
                        <div className="relative mx-auto w-16 h-16 mb-2">
                          <img
                            src={traveler.avatar}
                            alt={traveler.name}
                            className="w-full h-full rounded-full object-cover border-2 border-indigo-500"
                          />
                          <div className="absolute -bottom-1 -right-1 bg-gradient-to-r from-amber-400 to-orange-500 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white">
                            #{i + 1}
                          </div>
                        </div>
                        <p className="text-white text-xs font-medium truncate">{traveler.name}</p>
                        <p className="text-gray-500 text-[10px]">{traveler.countries} pays</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent trips feed */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                    <Flame className="w-4 h-4 text-orange-400" />
                    Derniers Voyages
                  </h3>
                  <div className="space-y-3">
                    {mockRecentTrips.map((trip) => (
                      <TripFeedCard key={trip.id} trip={trip} />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'travelers' && (
              <motion.div
                key="travelers"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-3"
              >
                {filteredTravelers.length > 0 ? (
                  filteredTravelers.map((traveler) => (
                    <TravelerCard key={traveler.id} traveler={traveler} variant="full" />
                  ))
                ) : (
                  <div className="text-center py-12">
                    <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">Aucun voyageur trouvé</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'trending' && (
              <motion.div
                key="trending"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  Destinations en vogue
                </h3>
                <div className="space-y-3">
                  {trendingDestinations.map((dest, i) => (
                    <motion.div
                      key={dest.name}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="relative rounded-xl overflow-hidden"
                    >
                      <img
                        src={dest.image}
                        alt={dest.name}
                        className="w-full h-32 object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        <div className="flex items-end justify-between">
                          <div>
                            <h4 className="text-white font-semibold text-lg">{dest.name}</h4>
                            <p className="text-gray-300 text-sm flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {dest.country}
                            </p>
                          </div>
                          <div className="text-right">
                            <div className="flex items-center gap-1 text-green-400 text-sm font-medium">
                              <TrendingUp className="w-3 h-3" />
                              {dest.trend}
                            </div>
                            <p className="text-gray-400 text-xs">{dest.travelers} voyageurs</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Live activity */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    Activité en direct
                  </h3>
                  <div className="space-y-2">
                    {[
                      { user: 'Marie K.', action: 'a commencé un voyage à', place: 'Tokyo', time: 'Il y a 2 min' },
                      { user: 'Thomas R.', action: 'a partagé son itinéraire pour', place: 'Barcelone', time: 'Il y a 5 min' },
                      { user: 'Julie M.', action: 'a rejoint la communauté depuis', place: 'Lyon', time: 'Il y a 8 min' },
                    ].map((activity, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-3 rounded-lg bg-[#12121a] border border-[#2a2a38]"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
                          {activity.user.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">
                            <span className="font-medium">{activity.user}</span>
                            <span className="text-gray-400"> {activity.action} </span>
                            <span className="text-indigo-400">{activity.place}</span>
                          </p>
                          <p className="text-[11px] text-gray-500">{activity.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </V2Layout>
  );
}
