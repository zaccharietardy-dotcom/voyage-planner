'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TripPreferences } from '@/lib/types';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth';
import { generateTripStream } from '@/lib/generateTrip';
import { Hero, HowItWorks, Features, SocialNetworkSection, PopularDestinations, Testimonials, CTASection } from '@/components/landing';
import { Footer } from '@/components/layout';
import { GeneratingScreen } from '@/components/trip/GeneratingScreen';

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

// Date helpers
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

interface PresetTrip {
  label: string;
  emoji?: string;
  description: string;
  tags: string[];
  preferences: Partial<TripPreferences>;
}

// 4 featured presets shown by default — diverse mix of styles
const FEATURED_PRESETS: PresetTrip[] = [
  {
    label: 'Nice ce week-end',
    emoji: '\u{1F30A}',
    description: 'Couple, 2 jours, plage & gastro',
    tags: ['couple', '2j', 'moderate'],
    preferences: {
      origin: 'Paris',
      destination: 'Nice',
      startDate: daysFromNow(2),
      durationDays: 2,
      groupSize: 2,
      groupType: 'couple',
      transport: 'train',
      carRental: false,
      budgetLevel: 'moderate',
      activities: ['beach', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Promenade des Anglais, Vieux-Nice',
    },
  },
  {
    label: 'Barcelone en famille',
    description: 'Famille 4 pers, 6 jours, plage & culture',
    tags: ['famille', '6j', 'moderate'],
    preferences: {
      origin: 'Paris',
      destination: 'Barcelona',
      startDate: daysFromNow(21),
      durationDays: 6,
      groupSize: 4,
      groupType: 'family_with_kids',
      transport: 'plane',
      carRental: false,
      budgetLevel: 'moderate',
      activities: ['beach', 'culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Sagrada Familia, Parc Guell, Barceloneta',
    },
  },
  {
    label: 'Tokyo aventure',
    description: 'Amis x3, 7 jours, culture & gastro',
    tags: ['amis', '7j', 'moderate'],
    preferences: {
      origin: 'Paris',
      destination: 'Tokyo',
      startDate: daysFromNow(45),
      durationDays: 7,
      groupSize: 3,
      groupType: 'friends',
      transport: 'plane',
      carRental: false,
      budgetLevel: 'moderate',
      activities: ['culture', 'gastronomy', 'adventure'],
      dietary: ['none'],
      mustSee: 'Shibuya, Senso-ji, Akihabara, Tsukiji',
    },
  },
  {
    label: 'Marrakech luxe',
    emoji: '\u{1F54C}',
    description: 'Couple, 4 jours, wellness & gastro',
    tags: ['couple', '4j', 'luxury'],
    preferences: {
      origin: 'Paris',
      destination: 'Marrakech',
      startDate: daysFromNow(25),
      durationDays: 4,
      groupSize: 2,
      groupType: 'couple',
      transport: 'plane',
      carRental: false,
      budgetLevel: 'luxury',
      activities: ['wellness', 'gastronomy', 'culture', 'shopping'],
      dietary: ['none'],
      mustSee: 'Jardin Majorelle, Medina, Jemaa el-Fna',
    },
  },
];

// Additional presets revealed on "Voir plus"
const MORE_PRESETS: PresetTrip[] = [
  {
    label: 'Bruxelles express',
    emoji: '\u{1F36B}',
    description: 'Amis x2, 2 jours, gastro & culture',
    tags: ['amis', '2j', 'economic'],
    preferences: {
      origin: 'Paris',
      destination: 'Brussels',
      startDate: daysFromNow(3),
      durationDays: 2,
      groupSize: 2,
      groupType: 'friends',
      transport: 'train',
      carRental: false,
      budgetLevel: 'economic',
      activities: ['gastronomy', 'culture'],
      dietary: ['none'],
      mustSee: 'Grand-Place, Atomium, Manneken Pis',
    },
  },
  {
    label: 'Week-end Paris romantique',
    emoji: '\u{1F5FC}',
    description: 'Couple, 3 jours, culture & gastronomie',
    tags: ['couple', '3j', 'comfort'],
    preferences: {
      origin: 'Lyon',
      destination: 'Paris',
      startDate: daysFromNow(14),
      durationDays: 3,
      groupSize: 2,
      groupType: 'couple',
      transport: 'train',
      carRental: false,
      budgetLevel: 'comfort',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Tour Eiffel, Louvre, Sacre-Coeur',
    },
  },
  {
    label: 'New York City',
    emoji: '\u{1F5FD}',
    description: 'Solo, 5 jours, culture & shopping',
    tags: ['solo', '5j', 'moderate'],
    preferences: {
      origin: 'Paris',
      destination: 'New York',
      startDate: daysFromNow(30),
      durationDays: 5,
      groupSize: 1,
      groupType: 'solo',
      transport: 'plane',
      carRental: false,
      budgetLevel: 'moderate',
      activities: ['culture', 'shopping', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Central Park, Times Square, Brooklyn Bridge',
    },
  },
  {
    label: 'Rome express',
    description: 'Couple, 4 jours, culture',
    tags: ['couple', '4j', 'economic'],
    preferences: {
      origin: 'Paris',
      destination: 'Rome',
      startDate: daysFromNow(10),
      durationDays: 4,
      groupSize: 2,
      groupType: 'couple',
      transport: 'plane',
      carRental: false,
      budgetLevel: 'economic',
      activities: ['culture', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Colisee, Vatican, Fontaine de Trevi',
    },
  },
  {
    label: 'Amsterdam chill',
    description: 'Amis x2, 3 jours, culture & nightlife',
    tags: ['amis', '3j', 'moderate'],
    preferences: {
      origin: 'Paris',
      destination: 'Amsterdam',
      startDate: daysFromNow(7),
      durationDays: 3,
      groupSize: 2,
      groupType: 'friends',
      transport: 'train',
      carRental: false,
      budgetLevel: 'moderate',
      activities: ['culture', 'nightlife', 'nature'],
      dietary: ['none'],
      mustSee: 'Rijksmuseum, Anne Frank, Vondelpark',
    },
  },
  {
    label: 'Lisbonne pas cher',
    emoji: '\u{1F3B8}',
    description: 'Solo, 5 jours, budget serr\u00e9',
    tags: ['solo', '5j', 'economic'],
    preferences: {
      origin: 'Paris',
      destination: 'Lisbonne',
      startDate: daysFromNow(20),
      durationDays: 5,
      groupSize: 1,
      groupType: 'solo',
      transport: 'plane',
      carRental: false,
      budgetLevel: 'economic',
      activities: ['culture', 'gastronomy', 'nightlife'],
      dietary: ['none'],
      mustSee: 'Belem, Alfama, Sintra',
    },
  },
  {
    label: 'Londres en voiture',
    description: 'Famille 3 pers, 4 jours, en voiture depuis Calais',
    tags: ['famille', '4j', 'comfort'],
    preferences: {
      origin: 'Calais',
      destination: 'London',
      startDate: daysFromNow(18),
      durationDays: 4,
      groupSize: 3,
      groupType: 'family_without_kids',
      transport: 'car',
      carRental: false,
      budgetLevel: 'comfort',
      activities: ['culture', 'shopping', 'gastronomy'],
      dietary: ['none'],
      mustSee: 'Big Ben, British Museum, Tower Bridge',
    },
  },
  {
    label: 'Dubrovnik aventure',
    description: 'Amis x4, 5 jours, aventure & plage',
    tags: ['amis', '5j', 'moderate'],
    preferences: {
      origin: 'Paris',
      destination: 'Dubrovnik',
      startDate: daysFromNow(35),
      durationDays: 5,
      groupSize: 4,
      groupType: 'friends',
      transport: 'plane',
      carRental: false,
      budgetLevel: 'moderate',
      activities: ['adventure', 'beach', 'culture'],
      dietary: ['none'],
      mustSee: 'Old Town, Lokrum Island, City Walls',
    },
  },
];

function PresetTripsSection() {
  const router = useRouter();
  const { user } = useAuth();
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [generatingPreset, setGeneratingPreset] = useState<PresetTrip | null>(null);
  const [showAll, setShowAll] = useState(false);

  const handleGenerate = async (preset: PresetTrip, index: number) => {
    setGeneratingId(index);
    setGeneratingPreset(preset);

    try {
      const trip = await generateTripStream(preset.preferences);

      if (user) {
        try {
          const saveRes = await fetch('/api/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...trip, preferences: preset.preferences }),
          });
          if (saveRes.ok) {
            const saved = await saveRes.json();
            localStorage.setItem('currentTrip', JSON.stringify({ ...trip, id: saved.id }));
            router.push(`/trip/${saved.id}`);
            return;
          }
        } catch {
          // fallback localStorage
        }
      }

      localStorage.setItem('currentTrip', JSON.stringify(trip));
      router.push(`/trip/${trip.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Erreur inconnue';
      toast.error(msg);
    } finally {
      setGeneratingId(null);
      setGeneratingPreset(null);
    }
  };

  const anyGenerating = generatingId !== null;

  const allPresets = showAll ? [...FEATURED_PRESETS, ...MORE_PRESETS] : FEATURED_PRESETS;

  return (
    <>
      {generatingPreset && (
        <GeneratingScreen
          destination={generatingPreset.preferences.destination || generatingPreset.label}
          durationDays={generatingPreset.preferences.durationDays}
        />
      )}
      <section className="section-padding">
        <div className="container-wide">
          <div className="text-center mb-12">
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-[#b8923d]">Essayez en un clic</p>
            <h2 className="text-3xl md:text-4xl font-serif font-bold mb-4">Destinations populaires</h2>
            <p className="text-muted-foreground text-lg">
              Lancez une g\u00e9n\u00e9ration en un clic
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {allPresets.map((preset, i) => {
              const isGenerating = generatingId === i;
              const p = preset.preferences;
              const imageUrl = PRESET_IMAGES[p.destination || ''] || 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600&h=400&fit=crop';

              return (
                <button
                  key={`${preset.label}-${i}`}
                  className={`group text-left rounded-xl overflow-hidden border bg-card hover:shadow-lg transition-all ${anyGenerating && !isGenerating ? 'opacity-50' : ''}`}
                  disabled={anyGenerating}
                  onClick={() => handleGenerate(preset, i)}
                >
                  <div className="relative h-44 overflow-hidden">
                    <img
                      src={imageUrl}
                      alt={preset.label}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    {isGenerating && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-white" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-base mb-1">{preset.label}</h3>
                    <p className="text-sm text-muted-foreground">{preset.description}</p>
                    <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                      <span>{p.durationDays}j</span>
                      <span>\u00b7</span>
                      <span>{p.groupSize} pers.</span>
                      <span>\u00b7</span>
                      <span className="capitalize">{p.budgetLevel}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-8 text-center">
            <Button
              variant="outline"
              className="gap-2 rounded-full border-[#1e3a5f]/20 px-6 hover:bg-[#1e3a5f]/5"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? (
                <>
                  Voir moins
                  <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  Voir {MORE_PRESETS.length} autres destinations
                  <ChevronDown className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <PresetTripsSection />
      <HowItWorks />
      <Features />
      <SocialNetworkSection />
      <PopularDestinations />
      <Testimonials />
      <CTASection />
      <Footer />
    </div>
  );
}
