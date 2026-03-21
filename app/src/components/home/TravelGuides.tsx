'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth';
import { generateTripStream } from '@/lib/generateTrip';
import { GeneratingScreen } from '@/components/trip/GeneratingScreen';
import { TripPreferences } from '@/lib/types';

const GROUP_TYPE_LABELS_SHORT: Record<string, string> = {
  solo: 'Solo',
  couple: 'Couple',
  friends: 'Entre amis',
  family_with_kids: 'Famille',
  family_without_kids: 'Famille',
};

function blurPlaceholder(hex: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'><rect fill='${hex}' width='4' height='3'/></svg>`
  )}`;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

interface GuideDestination {
  name: string;
  country: string;
  flag: string;
  spots: number;
  image: string;
  gradient: string;
  blur: string;
  preferences: Partial<TripPreferences>;
}

const DESTINATIONS: GuideDestination[] = [
  { name: 'Barcelona', country: 'Espagne', flag: '\u{1F1EA}\u{1F1F8}', spots: 42, image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=900&h=700&fit=crop', gradient: 'from-[#3f3a2c]/80 via-[#9a7443]/40 to-transparent', blur: blurPlaceholder('#b8a07a'), preferences: { origin: 'Paris', destination: 'Barcelona', startDate: daysFromNow(21), durationDays: 5, groupSize: 2, groupType: 'couple', transport: 'plane', budgetLevel: 'moderate', activities: ['culture', 'beach', 'gastronomy'], mustSee: 'Sagrada Familia, Parc Guell, Barceloneta' } },
  { name: 'Tokyo', country: 'Japon', flag: '\u{1F1EF}\u{1F1F5}', spots: 65, image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=900&h=700&fit=crop', gradient: 'from-[#102a45]/85 via-[#17517f]/45 to-transparent', blur: blurPlaceholder('#3a4a6b'), preferences: { origin: 'Paris', destination: 'Tokyo', startDate: daysFromNow(45), durationDays: 7, groupSize: 2, groupType: 'friends', transport: 'plane', budgetLevel: 'moderate', activities: ['culture', 'gastronomy', 'adventure'], mustSee: 'Shibuya, Senso-ji, Akihabara' } },
  { name: 'Rome', country: 'Italie', flag: '\u{1F1EE}\u{1F1F9}', spots: 38, image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=900&h=700&fit=crop', gradient: 'from-[#3d2d26]/80 via-[#9f6d56]/35 to-transparent', blur: blurPlaceholder('#a08a72'), preferences: { origin: 'Paris', destination: 'Rome', startDate: daysFromNow(10), durationDays: 4, groupSize: 2, groupType: 'couple', transport: 'plane', budgetLevel: 'economic', activities: ['culture', 'gastronomy'], mustSee: 'Colisee, Vatican, Fontaine de Trevi' } },
  { name: 'Marrakech', country: 'Maroc', flag: '\u{1F1F2}\u{1F1E6}', spots: 28, image: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=900&h=700&fit=crop', gradient: 'from-[#4f2f1e]/80 via-[#b06b3f]/35 to-transparent', blur: blurPlaceholder('#c4956a'), preferences: { origin: 'Paris', destination: 'Marrakech', startDate: daysFromNow(25), durationDays: 4, groupSize: 2, groupType: 'couple', transport: 'plane', budgetLevel: 'luxury', activities: ['wellness', 'gastronomy', 'culture'], mustSee: 'Jardin Majorelle, Medina, Jemaa el-Fna' } },
  { name: 'Amsterdam', country: 'Pays-Bas', flag: '\u{1F1F3}\u{1F1F1}', spots: 31, image: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=900&h=700&fit=crop', gradient: 'from-[#12345a]/85 via-[#1d4c7e]/45 to-transparent', blur: blurPlaceholder('#8b9bb5'), preferences: { origin: 'Paris', destination: 'Amsterdam', startDate: daysFromNow(7), durationDays: 3, groupSize: 2, groupType: 'friends', transport: 'train', budgetLevel: 'moderate', activities: ['culture', 'nightlife', 'nature'], mustSee: 'Rijksmuseum, Anne Frank, Vondelpark' } },
  { name: 'Lisbonne', country: 'Portugal', flag: '\u{1F1F5}\u{1F1F9}', spots: 34, image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=900&h=700&fit=crop', gradient: 'from-[#5a3f1d]/80 via-[#b57e3f]/35 to-transparent', blur: blurPlaceholder('#c4a87a'), preferences: { origin: 'Paris', destination: 'Lisbonne', startDate: daysFromNow(20), durationDays: 5, groupSize: 1, groupType: 'solo', transport: 'plane', budgetLevel: 'economic', activities: ['culture', 'gastronomy'], mustSee: 'Belem, Alfama, Sintra' } },
  { name: 'Paris', country: 'France', flag: '\u{1F1EB}\u{1F1F7}', spots: 72, image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=900&h=700&fit=crop', gradient: 'from-[#12345a]/85 via-[#1d4c7e]/45 to-transparent', blur: blurPlaceholder('#8b9bb5'), preferences: { origin: 'Lyon', destination: 'Paris', startDate: daysFromNow(14), durationDays: 3, groupSize: 2, groupType: 'couple', transport: 'train', budgetLevel: 'comfort', activities: ['culture', 'gastronomy'], mustSee: 'Tour Eiffel, Louvre, Sacre-Coeur' } },
  { name: 'London', country: 'Angleterre', flag: '\u{1F1EC}\u{1F1E7}', spots: 55, image: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&h=700&fit=crop', gradient: 'from-[#1d2b42]/85 via-[#2d4f7c]/45 to-transparent', blur: blurPlaceholder('#5a6a82'), preferences: { origin: 'Paris', destination: 'London', startDate: daysFromNow(18), durationDays: 4, groupSize: 3, groupType: 'family_without_kids', transport: 'train', budgetLevel: 'comfort', activities: ['culture', 'shopping', 'gastronomy'], mustSee: 'Big Ben, British Museum, Tower Bridge' } },
];

export function TravelGuides() {
  const router = useRouter();
  const { user } = useAuth();
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [generatingDest, setGeneratingDest] = useState<GuideDestination | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -320 : 320,
      behavior: 'smooth',
    });
  };

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
      <section className="py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-display font-bold">Destinations d'exception</h2>
            <p className="text-sm text-muted-foreground mt-1">Inspirations pour votre prochain départ</p>
          </div>
          <div className="hidden gap-3 md:flex">
            <Button
              variant="outline"
              size="icon"
              onClick={() => scroll('left')}
              className="h-10 w-10 rounded-full border-gold/20 bg-background/50 hover:bg-gold/5 hover:border-gold/40 transition-all"
              aria-label="Destinations précédentes"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => scroll('right')}
              className="h-10 w-10 rounded-full border-gold/20 bg-background/50 hover:bg-gold/5 hover:border-gold/40 transition-all"
              aria-label="Destinations suivantes"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <div
          ref={scrollRef}
          className="flex gap-6 overflow-x-auto scroll-snap-x pb-8 scrollbar-hide -mx-4 px-4"
        >
          {DESTINATIONS.map((dest, idx) => {
            const isGenerating = generatingIdx === idx;

            return (
              <motion.button
                key={dest.name}
                whileHover={{ y: -8 }}
                whileTap={{ scale: 0.98 }}
                className="group shrink-0 w-[320px] premium-card overflow-hidden text-left"
                disabled={generatingIdx !== null}
                onClick={() => handleGenerate(dest, idx)}
              >
                <div className="relative h-[240px] overflow-hidden">
                  <Image
                    src={dest.image}
                    alt={dest.name}
                    fill
                    className="object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
                    sizes="(max-width: 768px) 320px, 320px"
                    placeholder="blur"
                    blurDataURL={dest.blur}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#020617]/90 via-[#020617]/20 to-transparent" />
                  
                  <div className="absolute top-4 right-4">
                    <div className="bg-white/10 backdrop-blur-md border border-white/20 px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-widest">
                      {dest.preferences.durationDays} Jours
                    </div>
                  </div>

                  <div className="absolute bottom-6 left-6 right-6">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">{dest.flag}</span>
                      <span className="text-white/70 text-xs font-bold uppercase tracking-widest">{dest.country}</span>
                    </div>
                    <h3 className="text-white text-2xl font-display font-bold drop-shadow-lg">
                      {dest.name}
                    </h3>
                  </div>

                  {isGenerating && (
                    <div className="absolute inset-0 bg-[#020617]/70 backdrop-blur-sm flex items-center justify-center">
                      <div className="flex flex-col items-center gap-4">
                        <Loader2 className="h-10 w-10 animate-spin text-gold" />
                        <span className="text-white text-xs font-bold uppercase tracking-[0.2em]">Préparation...</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-6 bg-card border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/60 tracking-wider">Type de séjour</span>
                      <span className="text-sm font-bold text-foreground">{GROUP_TYPE_LABELS_SHORT[dest.preferences.groupType!]}</span>
                    </div>
                    <div className="h-8 w-px bg-border/50" />
                    <div className="flex flex-col text-right">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground/60 tracking-wider">À partir de</span>
                      <span className="text-sm font-bold text-gold">Sur mesure</span>
                    </div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

    </>
  );
}
