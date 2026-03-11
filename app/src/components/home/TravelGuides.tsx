'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth';
import { generateTripStream } from '@/lib/generateTrip';
import { GeneratingScreen } from '@/components/trip/GeneratingScreen';
import { TripPreferences } from '@/lib/types';

const PRESET_IMAGES: Record<string, string> = {
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&h=400&fit=crop',
  'New York': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=600&h=400&fit=crop',
  'Barcelona': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=600&h=400&fit=crop',
  'Tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=400&fit=crop',
  'Rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&h=400&fit=crop',
  'Amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=600&h=400&fit=crop',
  'Lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=600&h=400&fit=crop',
  'Marrakech': 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=600&h=400&fit=crop',
  'London': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&h=400&fit=crop',
  'Dubrovnik': 'https://images.unsplash.com/photo-1555990538-1e2c3e1e19d0?w=600&h=400&fit=crop',
  'Nice': 'https://images.unsplash.com/photo-1491166617655-0723a0999cfc?w=600&h=400&fit=crop',
  'Brussels': 'https://images.unsplash.com/photo-1559113202-c916b8e44373?w=600&h=400&fit=crop',
};

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

interface GuideDestination {
  name: string;
  flag: string;
  spots: number;
  preferences: Partial<TripPreferences>;
}

const DESTINATIONS: GuideDestination[] = [
  { name: 'Barcelona', flag: '\u{1F1EA}\u{1F1F8}', spots: 42, preferences: { origin: 'Paris', destination: 'Barcelona', startDate: daysFromNow(21), durationDays: 5, groupSize: 2, groupType: 'couple', transport: 'plane', budgetLevel: 'moderate', activities: ['culture', 'beach', 'gastronomy'], mustSee: 'Sagrada Familia, Parc Guell, Barceloneta' } },
  { name: 'Tokyo', flag: '\u{1F1EF}\u{1F1F5}', spots: 65, preferences: { origin: 'Paris', destination: 'Tokyo', startDate: daysFromNow(45), durationDays: 7, groupSize: 2, groupType: 'friends', transport: 'plane', budgetLevel: 'moderate', activities: ['culture', 'gastronomy', 'adventure'], mustSee: 'Shibuya, Senso-ji, Akihabara' } },
  { name: 'Rome', flag: '\u{1F1EE}\u{1F1F9}', spots: 38, preferences: { origin: 'Paris', destination: 'Rome', startDate: daysFromNow(10), durationDays: 4, groupSize: 2, groupType: 'couple', transport: 'plane', budgetLevel: 'economic', activities: ['culture', 'gastronomy'], mustSee: 'Colisee, Vatican, Fontaine de Trevi' } },
  { name: 'Marrakech', flag: '\u{1F1F2}\u{1F1E6}', spots: 28, preferences: { origin: 'Paris', destination: 'Marrakech', startDate: daysFromNow(25), durationDays: 4, groupSize: 2, groupType: 'couple', transport: 'plane', budgetLevel: 'luxury', activities: ['wellness', 'gastronomy', 'culture'], mustSee: 'Jardin Majorelle, Medina, Jemaa el-Fna' } },
  { name: 'Amsterdam', flag: '\u{1F1F3}\u{1F1F1}', spots: 31, preferences: { origin: 'Paris', destination: 'Amsterdam', startDate: daysFromNow(7), durationDays: 3, groupSize: 2, groupType: 'friends', transport: 'train', budgetLevel: 'moderate', activities: ['culture', 'nightlife', 'nature'], mustSee: 'Rijksmuseum, Anne Frank, Vondelpark' } },
  { name: 'Lisbonne', flag: '\u{1F1F5}\u{1F1F9}', spots: 34, preferences: { origin: 'Paris', destination: 'Lisbonne', startDate: daysFromNow(20), durationDays: 5, groupSize: 1, groupType: 'solo', transport: 'plane', budgetLevel: 'economic', activities: ['culture', 'gastronomy'], mustSee: 'Belem, Alfama, Sintra' } },
  { name: 'Paris', flag: '\u{1F1EB}\u{1F1F7}', spots: 72, preferences: { origin: 'Lyon', destination: 'Paris', startDate: daysFromNow(14), durationDays: 3, groupSize: 2, groupType: 'couple', transport: 'train', budgetLevel: 'comfort', activities: ['culture', 'gastronomy'], mustSee: 'Tour Eiffel, Louvre, Sacre-Coeur' } },
  { name: 'London', flag: '\u{1F1EC}\u{1F1E7}', spots: 55, preferences: { origin: 'Paris', destination: 'London', startDate: daysFromNow(18), durationDays: 4, groupSize: 3, groupType: 'family_without_kids', transport: 'train', budgetLevel: 'comfort', activities: ['culture', 'shopping', 'gastronomy'], mustSee: 'Big Ben, British Museum, Tower Bridge' } },
];

export function TravelGuides() {
  const router = useRouter();
  const { user } = useAuth();
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [generatingDest, setGeneratingDest] = useState<GuideDestination | null>(null);

  const handleGenerate = async (dest: GuideDestination, idx: number) => {
    setGeneratingIdx(idx);
    setGeneratingDest(dest);

    try {
      const trip = await generateTripStream(dest.preferences);

      if (user) {
        try {
          const res = await fetch('/api/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...trip, preferences: dest.preferences }),
          });
          if (res.ok) {
            const saved = await res.json();
            localStorage.setItem('currentTrip', JSON.stringify({ ...trip, id: saved.id }));
            router.push(`/trip/${saved.id}`);
            return;
          }
        } catch { /* fallback localStorage */ }
      }

      localStorage.setItem('currentTrip', JSON.stringify(trip));
      router.push(`/trip/${trip.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erreur inconnue';
      toast.error(msg);
    } finally {
      setGeneratingIdx(null);
      setGeneratingDest(null);
    }
  };

  return (
    <>
      {generatingDest && (
        <GeneratingScreen
          destination={generatingDest.preferences.destination || generatingDest.name}
          durationDays={generatingDest.preferences.durationDays}
        />
      )}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Destinations populaires</h2>
        </div>
        <div className="flex gap-3 overflow-x-auto scroll-snap-x pb-2 scrollbar-hide -mx-4 px-4">
          {DESTINATIONS.map((dest, idx) => {
            const imageUrl = PRESET_IMAGES[dest.name] || 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&h=400&fit=crop';
            const isGenerating = generatingIdx === idx;

            return (
              <button
                key={dest.name}
                className="group shrink-0 w-[160px] rounded-2xl overflow-hidden border border-border/40 bg-card shadow-soft transition-all active:scale-[0.97] hover:shadow-medium"
                disabled={generatingIdx !== null}
                onClick={() => handleGenerate(dest, idx)}
              >
                <div className="relative h-[120px] overflow-hidden">
                  <img
                    src={imageUrl}
                    alt={dest.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  <div className="absolute bottom-2 left-2 right-2">
                    <p className="text-white text-sm font-semibold drop-shadow-md">
                      {dest.flag} {dest.name}
                    </p>
                    <p className="text-white/80 text-[10px]">{dest.spots} spots</p>
                  </div>
                  {isGenerating && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
