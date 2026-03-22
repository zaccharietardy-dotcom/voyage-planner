'use client';

import { useState } from 'react';
import { TripPreferences, ACTIVITY_LABELS, GROUP_TYPE_LABELS } from '@/lib/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronDown, ChevronUp, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepTransport } from './StepTransport';
import { StepGroup } from './StepGroup';
import { StepBudget } from './StepBudget';

interface StepSummaryProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

const PRESET_IMAGES: Record<string, string> = {
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&h=400&fit=crop',
  'New York': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&h=400&fit=crop',
  'Barcelona': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&h=400&fit=crop',
  'Tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&h=400&fit=crop',
  'Rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=800&h=400&fit=crop',
  'Amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=800&h=400&fit=crop',
  'Lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=800&h=400&fit=crop',
  'Marrakech': 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=800&h=400&fit=crop',
  'London': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&h=400&fit=crop',
  'Nice': 'https://images.unsplash.com/photo-1491166617655-0723a0999cfc?w=800&h=400&fit=crop',
};

function getImage(destination?: string): string {
  if (!destination) return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&h=400&fit=crop';
  for (const [city, url] of Object.entries(PRESET_IMAGES)) {
    if (destination.toLowerCase().includes(city.toLowerCase())) return url;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&h=400&fit=crop';
}

export function StepSummary({ data, onChange, onGenerate, isGenerating }: StepSummaryProps) {
  const [showMore, setShowMore] = useState(false);

  const destination = data.cityPlan?.[0]?.city || data.destination || '';
  const imageUrl = getImage(destination);
  const dateStr = data.startDate
    ? format(new Date(data.startDate), 'd MMM yyyy', { locale: fr })
    : '';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-serif font-bold mb-1">Résumé</h2>
        <p className="text-sm text-muted-foreground">Vérifiez et lancez la génération</p>
      </div>

      {/* Destination hero card */}
      <div className="relative rounded-2xl overflow-hidden border border-border/40">
        <img
          src={imageUrl}
          alt={destination}
          className="w-full h-40 object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-3 left-4 right-4">
          <h3 className="text-white text-lg font-bold drop-shadow-md">{destination || 'Destination'}</h3>
          <p className="text-white/80 text-sm drop-shadow-sm">
            {data.durationDays || 7} jours
            {dateStr ? ` · ${dateStr}` : ''}
          </p>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {data.activities?.map((act) => (
          <span key={act} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
            {ACTIVITY_LABELS[act] || act}
          </span>
        ))}
        {data.groupType && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            {GROUP_TYPE_LABELS[data.groupType]}
          </span>
        )}
        {data.budgetLevel && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 capitalize">
            {data.budgetLevel}
          </span>
        )}
      </div>

      {/* More options (expandable) */}
      <div>
        <button
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setShowMore(!showMore)}
        >
          {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {showMore ? 'Moins d\'options' : 'Plus d\'options (transport, groupe, budget)'}
        </button>

        {showMore && (
          <div className="mt-4 space-y-6 rounded-xl border border-border/50 bg-muted/30 p-4">
            <StepTransport data={data} onChange={onChange} />
            <hr className="border-border/40" />
            <StepGroup data={data} onChange={onChange} />
            <hr className="border-border/40" />
            <StepBudget data={data} onChange={onChange} />
          </div>
        )}
      </div>

      {/* Generate button */}
      <Button
        className="w-full h-12 text-base gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/80 shadow-medium"
        onClick={onGenerate}
        disabled={isGenerating}
      >
        <Compass className="h-5 w-5" />
        Générer mon voyage
      </Button>
    </div>
  );
}
