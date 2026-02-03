'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Sparkles, Clock, MapPin, Users, Wallet } from 'lucide-react';
import { TripPreferences } from '@/lib/types';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth';
import { generateTripStream } from '@/lib/generateTrip';

// Date helpers
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(12, 0, 0, 0);
  return d;
}

interface PresetTrip {
  label: string;
  emoji: string;
  description: string;
  tags: string[];
  preferences: Partial<TripPreferences>;
}

const PRESET_TRIPS: PresetTrip[] = [
  {
    label: 'Week-end Paris romantique',
    emoji: '🗼',
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
      mustSee: 'Tour Eiffel, Louvre, Sacré-Coeur',
    },
  },
  {
    label: 'New York City',
    emoji: '🗽',
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
    label: 'Barcelone en famille',
    emoji: '🏖️',
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
    emoji: '🏯',
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
    label: 'Rome express',
    emoji: '🏛️',
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
      mustSee: 'Colisée, Vatican, Fontaine de Trevi',
    },
  },
  {
    label: 'Amsterdam chill',
    emoji: '🌷',
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
    emoji: '🎸',
    description: 'Solo, 5 jours, budget serré',
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
    label: 'Marrakech luxe',
    emoji: '🕌',
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
  {
    label: 'Londres en voiture',
    emoji: '🎡',
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
    emoji: '🏰',
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

const BUDGET_COLORS: Record<string, string> = {
  economic: 'bg-green-100 text-green-700',
  moderate: 'bg-blue-100 text-blue-700',
  comfort: 'bg-purple-100 text-purple-700',
  luxury: 'bg-amber-100 text-amber-700',
};

export default function TestTripsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [generatingId, setGeneratingId] = useState<number | null>(null);

  const handleGenerate = async (preset: PresetTrip, index: number) => {
    setGeneratingId(index);
    toast.info(`Lancement: ${preset.label}...`);

    try {
      const trip = await generateTripStream(preset.preferences);

      // Save to DB if logged in
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
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Voyages de test</h1>
          <p className="text-muted-foreground">
            Cliquez sur un voyage pour lancer la generation. Attention, chaque generation appelle les APIs (SerpAPI, Booking, Viator...).
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PRESET_TRIPS.map((preset, i) => {
            const isGenerating = generatingId === i;
            const anyGenerating = generatingId !== null;
            const p = preset.preferences;

            return (
              <Card
                key={i}
                className={`transition-all hover:shadow-lg ${anyGenerating && !isGenerating ? 'opacity-50' : ''}`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-3xl">{preset.emoji}</span>
                      <div>
                        <h3 className="font-semibold text-base">{preset.label}</h3>
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted">
                      <MapPin className="h-3 w-3" />
                      {p.origin} → {p.destination}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted">
                      <Clock className="h-3 w-3" />
                      {p.durationDays}j
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted">
                      <Users className="h-3 w-3" />
                      {p.groupSize}
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${BUDGET_COLORS[p.budgetLevel || 'moderate']}`}>
                      <Wallet className="h-3 w-3" />
                      {p.budgetLevel}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                      {p.transport === 'plane' ? '✈️' : p.transport === 'train' ? '🚄' : p.transport === 'car' ? '🚗' : '🔄'} {p.transport}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground mb-3">
                    <span className="font-medium">Must-see:</span> {p.mustSee}
                  </div>

                  <Button
                    className="w-full gap-2"
                    disabled={anyGenerating}
                    onClick={() => handleGenerate(preset, i)}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generation en cours...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generer
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
