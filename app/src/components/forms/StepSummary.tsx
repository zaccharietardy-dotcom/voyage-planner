'use client';

import { useState, useEffect } from 'react';
import { TripPreferences, ACTIVITY_LABELS, GROUP_TYPE_LABELS, BUDGET_LABELS } from '@/lib/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronDown, ChevronUp, Compass, Users, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepTransport } from './StepTransport';
import { StepGroup } from './StepGroup';
import { StepBudget } from './StepBudget';
import { cn } from '@/lib/utils';
import { hapticImpactMedium } from '@/lib/utils/haptics';

interface StepSummaryProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  onJumpToStep?: (step: number) => void;
}

const PRESET_IMAGES: Record<string, string> = {
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1200&h=600&fit=crop',
  'New York': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200&h=600&fit=crop',
  'Barcelona': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=1200&h=600&fit=crop',
  'Tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200&h=600&fit=crop',
  'Rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200&h=600&fit=crop',
  'Amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=1200&h=600&fit=crop',
  'Lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=1200&h=600&fit=crop',
  'Marrakech': 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=1200&h=600&fit=crop',
  'London': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&h=600&fit=crop',
  'Nice': 'https://images.unsplash.com/photo-1491166617655-0723a0999cfc?w=1200&h=600&fit=crop',
  'Annecy': 'https://images.unsplash.com/photo-1558231011-3e91760cbb34?w=1200&h=600&fit=crop',
};

function getFallbackImage(destination?: string): string {
  if (!destination) return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&h=600&fit=crop';
  for (const [city, url] of Object.entries(PRESET_IMAGES)) {
    if (destination.toLowerCase().includes(city.toLowerCase())) return url;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&h=600&fit=crop';
}

export function StepSummary({ data, onChange, onGenerate, isGenerating, onJumpToStep }: StepSummaryProps) {
  const [showMore, setShowMore] = useState(false);
  const destination = data.cityPlan?.[0]?.city || data.destination || '';
  const [imageUrl, setImageUrl] = useState<string>(getFallbackImage(destination));
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (!destination) {
      setImageLoading(false);
      return;
    }
    
    const fetchImage = async () => {
      setImageLoading(true);
      try {
        const lang = /paris|lyon|marseille|bordeaux|nice|strasbourg|lille|toulouse|nantes|montpellier|annecy|marrakech|tunis|bruxelles|genève|québec|montréal/i.test(destination) ? 'fr' : 'en';
        const title = encodeURIComponent(destination.replace(/ /g, '_'));
        const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`);
        if (!res.ok) {
          setImageLoading(false);
          return;
        }
        const json = await res.json();
        if (json.thumbnail?.source) {
          const betterUrl = json.thumbnail.source.replace(/\/\d+px-/, '/1000px-');
          
          const img = new Image();
          img.src = betterUrl;
          img.onload = () => {
            setImageUrl(betterUrl);
            setImageLoading(false);
          };
          img.onerror = () => setImageLoading(false);
        } else {
          setImageLoading(false);
        }
      } catch (e) {
        setImageLoading(false);
      }
    };
    
    let hasPreset = false;
    for (const city of Object.keys(PRESET_IMAGES)) {
      if (destination.toLowerCase().includes(city.toLowerCase())) hasPreset = true;
    }
    
    if (!hasPreset) {
      fetchImage();
    } else {
      setImageUrl(getFallbackImage(destination));
      setImageLoading(false);
    }
  }, [destination]);

  const dateStr = data.startDate
    ? format(new Date(data.startDate), 'd MMM yyyy', { locale: fr })
    : '';

  const handleGenerateClick = () => {
    hapticImpactMedium();
    onGenerate();
  };

  return (
    <div className="space-y-12 max-w-[600px] mx-auto w-full">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-[3.5rem] leading-none font-serif font-bold tracking-tight text-[#f8fafc]">
          Résumé
        </h2>
        <p className="text-[17px] text-[#94a3b8] font-light">
          Vérifiez et lancez la génération
        </p>
      </div>

      {/* Destination hero card */}
      <div className="relative rounded-[2rem] overflow-hidden border border-white/10 bg-[#0e1220]/50 shadow-[0_20px_50px_rgba(0,0,0,0.5)] group aspect-[2/1] w-full">
        {imageLoading && (
          <div className="absolute inset-0 bg-[#0a0f1c] animate-pulse flex items-center justify-center">
            <Compass className="h-10 w-10 text-gold animate-spin" />
          </div>
        )}
        <img
          src={imageUrl}
          alt={destination}
          onLoad={() => setImageLoading(false)}
          className={cn(
            "w-full h-full object-cover transition-all duration-1000",
            imageLoading ? "scale-110 blur-sm opacity-0" : "scale-100 blur-0 opacity-100"
          )}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/50 to-transparent" />
        <div className="absolute bottom-6 left-8 right-8 z-10">
          <h3 className="text-white text-4xl font-serif font-bold drop-shadow-[0_4px_20px_rgba(0,0,0,0.8)] tracking-tight mb-2">{destination || 'Destination'}</h3>
          <p className="text-white/90 text-sm font-semibold drop-shadow-md flex items-center gap-3">
            <span className="bg-gold/20 backdrop-blur-md px-3 py-1 rounded-lg border border-gold/30 text-gold">
              {data.durationDays || 7} jours
            </span>
            {dateStr && (
              <span className="opacity-80">· {dateStr}</span>
            )}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        {data.groupType && (
          <button 
            type="button"
            onClick={() => onJumpToStep?.(4)}
            className="flex items-center gap-4 p-5 rounded-[1.5rem] bg-white/[0.03] border border-white/[0.05] text-left hover:bg-white/[0.08] hover:border-white/[0.1] transition-all duration-300 group/card"
          >
            <div className="p-3.5 rounded-2xl bg-blue-500/10 text-blue-400 group-hover/card:bg-blue-500/20 transition-colors">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 group-hover/card:text-blue-400 transition-colors">Groupe</p>
              <p className="text-[15px] font-bold text-white mt-1">{GROUP_TYPE_LABELS[data.groupType]} ({data.groupSize})</p>
            </div>
          </button>
        )}
        {(data.budgetLevel || data.budgetCustom) && (
          <button 
            type="button"
            onClick={() => onJumpToStep?.(6)}
            className="flex items-center gap-4 p-5 rounded-[1.5rem] bg-white/[0.03] border border-white/[0.05] text-left hover:bg-white/[0.08] hover:border-white/[0.1] transition-all duration-300 group/card"
          >
            <div className="p-3.5 rounded-2xl bg-green-500/10 text-green-400 group-hover/card:bg-green-500/20 transition-colors">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 group-hover/card:text-green-400 transition-colors">Confort</p>
              <p className="text-[15px] font-bold text-white capitalize mt-1">{data.budgetCustom ? `${data.budgetCustom}€` : BUDGET_LABELS[data.budgetLevel as keyof typeof BUDGET_LABELS]?.label}</p>
            </div>
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5 pt-2">
        {data.activities?.map((act) => (
          <span key={act} className="inline-flex items-center px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest bg-gold/10 text-gold border border-gold/20 shadow-sm">
            {ACTIVITY_LABELS[act] || act}
          </span>
        ))}
      </div>

      {/* More options (expandable) */}
      <div className="pt-2">
        <button
          className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors py-2"
          onClick={() => setShowMore(!showMore)}
        >
          {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {showMore ? 'Moins d\'options' : 'Plus d\'options (transport, groupe, budget)'}
        </button>

        {showMore && (
          <div className="mt-3 space-y-6 rounded-[1.5rem] border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm">
            <StepTransport data={data} onChange={onChange} />
            <hr className="border-white/5" />
            <div className="space-y-4">
              <h4 className="text-sm font-bold uppercase tracking-widest text-primary/80">Détails budgétaires</h4>
              <p className="text-sm text-muted-foreground">
                Votre budget {data.budgetIsPerPerson ? 'par personne' : 'total'} est fixé à {data.budgetCustom ? `${data.budgetCustom}€` : data.budgetLevel}.
                {data.mealPreference && data.mealPreference !== 'auto' && (
                  <span> Préférence repas : {data.mealPreference}.</span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Generate button */}
      <div className="pt-6">
        <Button
          className="w-full h-16 text-lg font-bold gap-3 rounded-[2rem] bg-gold-gradient text-black shadow-[0_10px_30px_rgba(197,160,89,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all"
          onClick={handleGenerateClick}
          disabled={isGenerating}
        >
          <Compass className={cn("h-6 w-6", isGenerating && "animate-spin")} />
          {isGenerating ? 'Génération...' : 'Générer mon voyage'}
        </Button>
      </div>
    </div>
  );
}
