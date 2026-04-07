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

const BAD_IMAGE_KEYWORDS = ['flag', 'drapeau', 'blason', 'coat_of_arms', 'armoiries', 'logo', 'emblem', 'banner', 'gwenn', 'seal_of', 'escudo', 'wappen', 'bandiera', 'carte_', 'map_of', 'location_'];

function isGoodImage(url: string): boolean {
  return !BAD_IMAGE_KEYWORDS.some(kw => url.toLowerCase().includes(kw));
}

function extractWikiImage(json: any): string | null {
  const imgUrl = json?.originalimage?.source || json?.thumbnail?.source;
  if (!imgUrl || !isGoodImage(imgUrl)) return null;
  return imgUrl.includes('/thumb/') ? imgUrl.replace(/\/\d+px-/, '/1200px-') : imgUrl;
}

/**
 * Multi-strategy image fetch:
 * 1. Wikipedia fr/en for exact name (filter flags/emblems)
 * 2. Wikipedia "Tourisme_en_{name}"
 * 3. Nominatim → bbox → find major city → Wikipedia for that city
 * 4. null → caller shows gradient (never a random stock photo)
 */
async function fetchDestinationImage(destination: string): Promise<string | null> {
  const encoded = encodeURIComponent(destination.replace(/ /g, '_'));

  // Strategy 1: Wikipedia fr + en
  for (const lang of ['fr', 'en']) {
    try {
      const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
      if (!res.ok) continue;
      const img = extractWikiImage(await res.json());
      if (img) return img;
    } catch { continue; }
  }

  // Strategy 2: "Tourisme en {destination}"
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/Tourisme_en_${encoded}`);
    if (res.ok) {
      const img = extractWikiImage(await res.json());
      if (img) return img;
    }
  } catch { /* ignore */ }

  // Strategy 3: Nominatim → bbox → first city → Wikipedia image
  try {
    const nRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'NaraeVoyage/1.0' } },
    );
    if (nRes.ok) {
      const results = await nRes.json();
      if (results.length > 0 && results[0].boundingbox) {
        const [south, north, west, east] = results[0].boundingbox;
        const cityRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=city&format=json&limit=3&bounded=1&viewbox=${west},${north},${east},${south}&featuretype=city`,
          { headers: { 'User-Agent': 'NaraeVoyage/1.0' } },
        );
        if (cityRes.ok) {
          const cities = await cityRes.json();
          for (const city of cities) {
            const name = city.name || city.display_name?.split(',')[0];
            if (!name) continue;
            try {
              const wRes = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`);
              if (!wRes.ok) continue;
              const img = extractWikiImage(await wRes.json());
              if (img) return img;
            } catch { continue; }
          }
        }
      }
    }
  } catch { /* ignore */ }

  return null;
}

export function StepSummary({ data, onChange, onGenerate, isGenerating, onJumpToStep }: StepSummaryProps) {
  const [showMore, setShowMore] = useState(false);
  const destination = data.cityPlan?.[0]?.city || data.destination || '';
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (!destination) { setImageLoading(false); return; }
    let cancelled = false;

    (async () => {
      setImageLoading(true);
      const url = await fetchDestinationImage(destination);
      if (!cancelled) {
        setImageUrl(url); // null = gradient placeholder
        setImageLoading(false);
      }
    })();

    return () => { cancelled = true; };
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
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={destination}
            onLoad={() => setImageLoading(false)}
            className={cn(
              "w-full h-full object-cover transition-all duration-1000",
              imageLoading ? "scale-110 blur-sm opacity-0" : "scale-100 blur-0 opacity-100"
            )}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#1a2744] via-[#0d1b2a] to-[#020617]" />
        )}
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
