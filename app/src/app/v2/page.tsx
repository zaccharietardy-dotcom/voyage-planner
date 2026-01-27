'use client';

import { useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, X } from 'lucide-react';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { SearchBar } from '@/components/v2/ui/SearchBar';
import { TravelerCard } from '@/components/v2/ui/TravelerCard';
import { TripFeedCard } from '@/components/v2/ui/TripFeedCard';
import { mockTravelers, mockTripArcs, mockRecentTrips, Traveler } from '@/lib/v2/mockData';

// Dynamic import for Globe to avoid SSR issues
const CesiumGlobe = dynamic(
  () => import('@/components/v2/globe/CesiumGlobe').then((mod) => mod.CesiumGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
        <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    ),
  }
);

export default function ExplorePage() {
  const [selectedTraveler, setSelectedTraveler] = useState<Traveler | null>(null);
  const [showFeed, setShowFeed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const handleTravelerSelect = (traveler: Traveler | null) => {
    setSelectedTraveler(traveler);
  };

  const filteredTravelers = mockTravelers.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.location.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <V2Layout>
      <div className="relative h-screen overflow-hidden">
        {/* Globe Background */}
        <div className="absolute inset-0">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center bg-[#0a0a0f]">
              <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          }>
            <CesiumGlobe
              travelers={mockTravelers}
              arcs={mockTripArcs}
              selectedTraveler={selectedTraveler}
              onTravelerSelect={handleTravelerSelect}
            />
          </Suspense>
        </div>

        {/* Top Overlay - Search & Logo */}
        <div className="absolute top-0 left-0 right-0 z-10 safe-area-top">
          <div className="p-4 pt-12">
            {/* Logo */}
            <div className="flex items-center justify-center mb-4">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
                TravelSphere
              </h1>
            </div>

            {/* Search Bar */}
            <SearchBar
              placeholder="Destinations, voyageurs..."
              onSearch={setSearchQuery}
            />
          </div>
        </div>

        {/* Selected Traveler Detail Panel */}
        <AnimatePresence>
          {selectedTraveler && (
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="absolute bottom-24 left-4 right-4 z-20"
            >
              <div className="relative">
                <button
                  onClick={() => setSelectedTraveler(null)}
                  className="absolute -top-2 -right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-[#1a1a24] border border-[#2a2a38]"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
                <TravelerCard traveler={selectedTraveler} variant="full" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Feed Toggle */}
        <motion.div
          className="absolute bottom-20 left-0 right-0 z-10"
          animate={{ y: showFeed ? -300 : 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        >
          {/* Pull up handle */}
          <button
            onClick={() => setShowFeed(!showFeed)}
            className="w-full flex items-center justify-center py-2"
          >
            <motion.div
              animate={{ rotate: showFeed ? 180 : 0 }}
              className="flex flex-col items-center"
            >
              <ChevronUp className="w-6 h-6 text-gray-400" />
              <span className="text-xs text-gray-500 mt-1">
                {showFeed ? 'Fermer' : 'Voyages récents'}
              </span>
            </motion.div>
          </button>

          {/* Feed Content */}
          <AnimatePresence>
            {showFeed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-4 pb-4"
              >
                <div className="bg-[#0a0a0f]/90 backdrop-blur-xl rounded-t-2xl border border-[#2a2a38] border-b-0 p-4 max-h-[350px] overflow-y-auto">
                  <h3 className="text-lg font-semibold text-white mb-4">
                    Voyages récents
                  </h3>
                  <div className="space-y-4">
                    {mockRecentTrips.map((trip) => (
                      <TripFeedCard key={trip.id} trip={trip} />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Stats Badge */}
        <div className="absolute top-32 left-4 z-10 hidden sm:block">
          <div className="bg-[#0a0a0f]/80 backdrop-blur-xl rounded-xl border border-[#2a2a38] px-4 py-3">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-2xl font-bold text-white">{mockTravelers.length}</p>
                <p className="text-xs text-gray-500">Voyageurs</p>
              </div>
              <div className="w-px h-8 bg-[#2a2a38]" />
              <div>
                <p className="text-2xl font-bold text-white">{mockTripArcs.length}</p>
                <p className="text-xs text-gray-500">Trajets</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </V2Layout>
  );
}
