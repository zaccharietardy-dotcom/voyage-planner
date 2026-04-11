'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarIcon, MapPin, Plus, X, Compass, Loader2, Clock, Map, Route, Navigation } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { TripPreferences, CityStage, DurationSuggestion, DestinationSuggestion, ActivityType } from '@/lib/types';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { StyleMatchBadge } from '@/components/trip/StyleMatchBadge';

import { hapticSelection } from '@/lib/utils/haptics';
import { useTranslation } from '@/lib/i18n';

interface StepDestinationProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

/**
 * Smart duration defaults based on city name and relative distance if possible.
 */
function getSuggestedDuration(city: string, origin?: string): number {
  const c = city.toLowerCase();
  const o = origin?.toLowerCase() || '';
  
  // Region detection
  const isAsia = (s: string) => /tokyo|seoul|pékin|beijing|shanghai|bangkok|singapour|singapore|phuket|bali|denpasar|hong kong/i.test(s);
  const isEurope = (s: string) => /paris|london|londres|rome|roma|madrid|barcelone|barcelona|amsterdam|berlin|vienne|vienna|prague|lisbonne|lisbon|nice|lyon|bordeaux|nantes|marseille/i.test(s);
  const isUS = (s: string) => /new york|nyc|los angeles|san francisco|las vegas|miami/i.test(s);

  const sameRegion = (isAsia(c) && isAsia(o)) || (isEurope(c) && isEurope(o)) || (isUS(c) && isUS(o));

  // Big complex cities
  if (/tokyo|seoul|pékin|beijing|shanghai|new york|nyc|los angeles|rio de janeiro|bangkok|singapour|singapore/i.test(c)) {
    return sameRegion ? 3 : 5; 
  }
  // Standard City break
  if (/paris|london|londres|rome|roma|madrid|barcelone|barcelona|amsterdam|berlin|vienne|vienna|prague|lisbonne|lisbon/i.test(c)) {
    return 3;
  }
  // Quick getaway
  if (/nice|lyon|bordeaux|nantes|marseille|strasbourg|lille|montpellier|toulouse|annecy|biarritz/i.test(c)) {
    return 2;
  }
  return 4;
}

type LocationSuggestion = {
  displayName: string;
  label: string;
  subtitle?: string;
  city?: string;
  country?: string;
  lat: number;
  lng: number;
};

function looksLikeStreetQuery(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  if (/\d/.test(normalized)) return true;
  return /\b(rue|street|avenue|road|boulevard|blvd|via|strasse|straße|calle|rua|quai|impasse|allee|allée|chemin|route|plaza|place)\b/i.test(normalized);
}

function formatCoordPair(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

const TYPE_LABELS: Record<DestinationSuggestion['type'], { label: string; icon: typeof Map }> = {
  single_city: { label: 'Ville unique', icon: Navigation },
  multi_city: { label: 'Multi-villes', icon: Map },
  road_trip: { label: 'Road trip', icon: Route },
};

const VIBE_OPTIONS: Array<{ id: ActivityType; label: string }> = [
  { id: 'nature', label: 'Nature' },
  { id: 'beach', label: 'Plage' },
  { id: 'culture', label: 'Musées & culture' },
  { id: 'gastronomy', label: 'Gastronomie' },
  { id: 'wellness', label: 'Détente' },
  { id: 'adventure', label: 'Aventure' },
  { id: 'nightlife', label: 'Vie nocturne' },
  { id: 'shopping', label: 'Shopping' },
];

export function StepDestination({ data, onChange }: StepDestinationProps) {
  const { t } = useTranslation();
  const mode = data.tripMode || 'precise';
  const stages = data.cityPlan || [{ city: '', days: 7 }];
  const [inspireQuery, setInspireQuery] = useState('');
  const [inspiredVibes, setInspiredVibes] = useState<ActivityType[]>(
    Array.isArray(data.activities) ? data.activities : []
  );
  const [durationSuggestionForStage, setDurationSuggestionForStage] = useState<number | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<LocationSuggestion[]>([]);
  const [originSuggestionsLoading, setOriginSuggestionsLoading] = useState(false);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
  const [destSuggestions, setDestSuggestions] = useState<LocationSuggestion[]>([]);
  const [destSuggestionsLoading, setDestSuggestionsLoading] = useState(false);
  const [activeDestStage, setActiveDestStage] = useState<number | null>(null);
  const geoPromptTriggeredRef = useRef(false);
  const { preferences } = useUserPreferences();

  const {
    loadingDuration,
    loadingDestination,
    durationSuggestion,
    destinationSuggestions,
    fetchDurationSuggestion,
    fetchDestinationSuggestions,
    clearDuration,
    clearDestination,
  } = useSuggestions();

  useEffect(() => {
    if (Array.isArray(data.activities)) {
      setInspiredVibes(data.activities);
    }
  }, [data.activities]);

  // --- Helpers ---

  const setMode = (newMode: 'precise' | 'inspired') => {
    hapticSelection();
    onChange({ tripMode: newMode });
    clearDestination();
    clearDuration();
  };

  const updateStages = (newStages: CityStage[]) => {
    const totalDays = newStages.reduce((sum, s) => sum + s.days, 0);
    const firstCity = newStages[0]?.city || '';
    onChange({
      cityPlan: newStages,
      destination: firstCity,
      durationDays: totalDays,
    });
  };

  const updateStage = (index: number, updates: Partial<CityStage>) => {
    const newStages = stages.map((s, i) => (i === index ? { ...s, ...updates } : s));
    updateStages(newStages);
  };

  const addStage = () => {
    updateStages([...stages, { city: '', days: 3 }]);
  };

  const removeStage = (index: number) => {
    if (stages.length <= 1) return;
    updateStages(stages.filter((_, i) => i !== index));
  };

  const applyDestinationSuggestion = (suggestion: DestinationSuggestion) => {
    const newStages = suggestion.stages.map(s => ({ city: s.city, days: s.days }));
    const totalDays = newStages.reduce((sum, s) => sum + s.days, 0);
    onChange({
      tripMode: 'precise',
      cityPlan: newStages,
      destination: newStages[0]?.city || '',
      durationDays: totalDays,
    });
    clearDestination();
  };

  const toggleInspiredVibe = (vibe: ActivityType) => {
    const hasVibe = inspiredVibes.includes(vibe);
    const next = hasVibe
      ? inspiredVibes.filter((entry) => entry !== vibe)
      : [...inspiredVibes, vibe];
    setInspiredVibes(next);
    onChange({ activities: next });
  };

  const requestInspiredSuggestions = async () => {
    const query = inspireQuery.trim();
    if (!query) return;
    const days = data.durationDays || totalDays || 5;
    await fetchDestinationSuggestions(query, {
      origin: data.origin,
      activities: inspiredVibes.length > 0 ? inspiredVibes : data.activities,
      budgetLevel: data.budgetLevel,
      groupType: data.groupType,
      durationDays: days,
    });
  };

  const handleDurationSuggestion = async (stageIndex: number) => {
    const city = stages[stageIndex]?.city;
    if (!city) return;
    setDurationSuggestionForStage(stageIndex);
    await fetchDurationSuggestion(city, {
      activities: data.activities,
      budgetLevel: data.budgetLevel,
      groupType: data.groupType,
    });
  };

  const applyDurationChip = (days: number) => {
    if (durationSuggestionForStage !== null) {
      updateStage(durationSuggestionForStage, { days });
    }
    clearDuration();
    setDurationSuggestionForStage(null);
  };

  const totalDays = stages.reduce((sum, s) => sum + s.days, 0);

  const fetchLocationSuggestions = useCallback(
    async (query: string, mode: 'city' | 'address', signal: AbortSignal): Promise<LocationSuggestion[]> => {
      const params = new URLSearchParams({
        q: query.trim(),
        mode,
        limit: '6',
      });

      const response = await fetch(`/api/geocode/autocomplete?${params.toString()}`, { signal });
      if (!response.ok) return [];
      const payload = await response.json();
      if (!Array.isArray(payload?.results)) return [];
      return payload.results as LocationSuggestion[];
    },
    []
  );

  const handleUseCurrentLocation = useCallback((options?: { forceOriginUpdate?: boolean; silentErrors?: boolean }) => {
    const forceOriginUpdate = options?.forceOriginUpdate === true;
    const silentErrors = options?.silentErrors === true;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (!silentErrors) {
        setGeoError("La géolocalisation n'est pas disponible sur cet appareil.");
      }
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      if (!silentErrors) {
        setGeoError("La géolocalisation nécessite une connexion HTTPS sécurisée.");
      }
      return;
    }

    setGeoLoading(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        onChange({
          homeCoords: { lat, lng },
        });

        try {
          const response = await fetch(
            `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const payload = await response.json();
          const displayName = typeof payload?.displayName === 'string' ? payload.displayName : undefined;
          const cityName = typeof payload?.city === 'string' ? payload.city : undefined;

          onChange({
            homeCoords: { lat, lng },
            homeAddress: displayName || data.homeAddress || '',
            ...(cityName && (forceOriginUpdate || !data.origin) ? { origin: cityName } : {}),
          });
        } catch {
          onChange({ homeCoords: { lat, lng } });
        } finally {
          setGeoLoading(false);
        }
      },
      (error) => {
        setGeoLoading(false);
        if (error.code === error.PERMISSION_DENIED) {
          if (!silentErrors) {
            setGeoError("Autorisez la géolocalisation dans Safari (Réglages du site > Localisation) puis réessayez.");
          }
          return;
        }
        if (!silentErrors) {
          setGeoError("Impossible de récupérer votre position actuelle.");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, [data.homeAddress, data.origin, onChange]);

  const departureInputValue = (data.homeAddress || '').trim() || (data.origin || '');
  const originQueryIsAddress = looksLikeStreetQuery(departureInputValue);
  const detectedOriginText = (data.homeAddress || '').trim() || (data.homeCoords
    ? formatCoordPair(data.homeCoords.lat, data.homeCoords.lng)
    : '');

  useEffect(() => {
    const query = departureInputValue.trim();
    if (query.length < 2) {
      setOriginSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setOriginSuggestionsLoading(true);
      try {
        const mode = looksLikeStreetQuery(query) ? 'address' : 'city';
        const suggestions = await fetchLocationSuggestions(query, mode, controller.signal);
        setOriginSuggestions(suggestions);
      } catch {
        setOriginSuggestions([]);
      } finally {
        setOriginSuggestionsLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [departureInputValue, fetchLocationSuggestions]);

  // Destination city autocomplete
  const activeDestCity = activeDestStage !== null ? (stages[activeDestStage]?.city || '') : '';

  useEffect(() => {
    const query = activeDestCity.trim();
    if (query.length < 2 || activeDestStage === null) {
      setDestSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setDestSuggestionsLoading(true);
      try {
        const suggestions = await fetchLocationSuggestions(query, 'city', controller.signal);
        setDestSuggestions(suggestions);
      } catch {
        setDestSuggestions([]);
      } finally {
        setDestSuggestionsLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeDestCity, activeDestStage, fetchLocationSuggestions]);

  const applyDestSuggestion = (stageIndex: number, suggestion: LocationSuggestion) => {
    const cityName = suggestion.city || suggestion.label || suggestion.displayName;
    const suggestedDays = getSuggestedDuration(cityName, data.origin);
    updateStage(stageIndex, { 
      city: cityName,
      days: suggestedDays // Apply smart default duration
    });
    setActiveDestStage(null);
    setDestSuggestions([]);
  };

  const applyOriginSuggestion = (suggestion: LocationSuggestion) => {
    const queryIsAddress = looksLikeStreetQuery(departureInputValue);
    const nextAddress = queryIsAddress
      ? suggestion.displayName
      : (suggestion.label || suggestion.displayName);
    onChange({
      origin: suggestion.city || suggestion.label || suggestion.displayName,
      homeAddress: nextAddress,
      homeCoords: { lat: suggestion.lat, lng: suggestion.lng },
    });
    setShowOriginSuggestions(false);
  };

  const maybeTriggerGeoPrompt = () => {
    if (geoPromptTriggeredRef.current) return;
    if (data.homeCoords || (data.origin || '').trim().length > 0 || (data.homeAddress || '').trim().length > 0) return;
    geoPromptTriggeredRef.current = true;
    handleUseCurrentLocation({ forceOriginUpdate: true, silentErrors: true });
  };

  if (mode === 'inspired') {
    return (
      <div className="space-y-10 max-w-[640px] mx-auto w-full">
        <div className="text-center space-y-4">
          <h2 className="text-4xl md:text-[3.5rem] leading-none font-serif font-bold tracking-tight text-[#f8fafc]">
            {t('plan.dest.title')}
          </h2>
          <p className="text-[17px] text-[#94a3b8] font-light">
            Je ne sais pas encore où aller, aide-moi à trouver.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#0e1220]/50 p-1">
          <button
            type="button"
            onClick={() => setMode('precise')}
            className="h-11 rounded-xl text-sm font-semibold text-white/70 hover:text-white transition-colors"
          >
            Destination précise
          </button>
          <button
            type="button"
            onClick={() => setMode('inspired')}
            className="h-11 rounded-xl bg-gold text-black text-sm font-bold shadow-[0_10px_24px_rgba(197,160,89,0.35)]"
          >
            Je ne sais pas où aller
          </button>
        </div>

        <Card className="border-white/10 bg-[#0f1629]/70 backdrop-blur-xl">
          <CardContent className="p-6 space-y-6">
            <div className="space-y-2">
              <Label className="text-white">Décris ton envie</Label>
              <Textarea
                value={inspireQuery}
                onChange={(event) => setInspireQuery(event.target.value)}
                placeholder="Ex: 5 jours, nature + plage, petit budget, au départ de Paris"
                className="min-h-[92px] rounded-xl bg-[#0b1020] border-white/10 text-white placeholder:text-white/40"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-white">Ambiance recherchée</Label>
              <div className="flex flex-wrap gap-2">
                {VIBE_OPTIONS.map((vibe) => {
                  const active = inspiredVibes.includes(vibe.id);
                  return (
                    <button
                      key={vibe.id}
                      type="button"
                      onClick={() => toggleInspiredVibe(vibe.id)}
                      className={cn(
                        'px-3 py-2 rounded-full text-xs font-semibold border transition-colors',
                        active
                          ? 'bg-gold text-black border-gold'
                          : 'bg-[#0b1020] text-white/80 border-white/15 hover:border-white/35'
                      )}
                    >
                      {vibe.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-white">Durée souhaitée</Label>
                <Input
                  type="number"
                  min={2}
                  max={30}
                  value={data.durationDays || totalDays || 5}
                  onChange={(event) => {
                    const next = Number.parseInt(event.target.value, 10);
                    if (!Number.isFinite(next)) return;
                    onChange({ durationDays: Math.max(1, Math.min(30, next)) });
                  }}
                  className="bg-[#0b1020] border-white/10 text-white"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white">Budget</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['economic', 'moderate', 'comfort', 'luxury'] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => onChange({ budgetLevel: level })}
                      className={cn(
                        'h-10 rounded-xl border text-xs font-semibold capitalize transition-colors',
                        data.budgetLevel === level
                          ? 'bg-gold text-black border-gold'
                          : 'bg-[#0b1020] text-white/80 border-white/15 hover:border-white/35'
                      )}
                    >
                      {level === 'economic' ? 'Petit budget' :
                        level === 'moderate' ? 'Modéré' :
                          level === 'comfort' ? 'Confort' : 'Premium'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button
              type="button"
              onClick={requestInspiredSuggestions}
              disabled={loadingDestination || inspireQuery.trim().length < 5}
              className="w-full h-12 rounded-xl bg-gold hover:bg-gold/90 text-black font-bold"
            >
              {loadingDestination ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Recherche en cours...
                </span>
              ) : 'Me proposer 4 idées de voyage'}
            </Button>
          </CardContent>
        </Card>

        {destinationSuggestions && destinationSuggestions.length > 0 && (
          <div className="space-y-4">
            {destinationSuggestions.slice(0, 4).map((suggestion, index) => {
              const typeMeta = TYPE_LABELS[suggestion.type];
              const TypeIcon = typeMeta.icon;
              return (
                <Card key={`${suggestion.title}-${index}`} className="border-white/10 bg-[#0f1629]/70 backdrop-blur-xl">
                  <CardContent className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-white">{suggestion.title}</p>
                        <p className="text-sm text-white/70 mt-1">{suggestion.description}</p>
                      </div>
                      <Badge className="bg-white/10 text-white border-white/15 gap-1">
                        <TypeIcon className="h-3.5 w-3.5" />
                        {typeMeta.label}
                      </Badge>
                    </div>

                    <div className="text-sm text-white/80">
                      {suggestion.stages.map((stage) => `${stage.city} (${stage.days}j)`).join(' → ')}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {suggestion.highlights.slice(0, 3).map((highlight, idx) => (
                        <Badge key={idx} variant="secondary" className="bg-white/10 text-white/85 border-white/10">
                          {highlight}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-sm text-white/70">
                      <span>Budget: {suggestion.estimatedBudget}</span>
                      <span>Saison: {suggestion.bestSeason || 'Toute l’année'}</span>
                    </div>

                    <Button
                      type="button"
                      onClick={() => applyDestinationSuggestion(suggestion)}
                      className="w-full h-11 rounded-xl bg-gold hover:bg-gold/90 text-black font-semibold"
                    >
                      Choisir cette proposition
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-12 max-w-[600px] mx-auto w-full">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-[3.5rem] leading-none font-serif font-bold tracking-tight text-[#f8fafc]">
          {t('plan.dest.title')}
        </h2>
        <p className="text-[17px] text-[#94a3b8] font-light">
          {t('plan.dest.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-[#0e1220]/50 p-1">
        <button
          type="button"
          onClick={() => setMode('precise')}
          className="h-11 rounded-xl bg-gold text-black text-sm font-bold shadow-[0_10px_24px_rgba(197,160,89,0.35)]"
        >
          Destination précise
        </button>
        <button
          type="button"
          onClick={() => setMode('inspired')}
          className="h-11 rounded-xl text-sm font-semibold text-white/70 hover:text-white transition-colors"
        >
          Je ne sais pas où aller
        </button>
      </div>

      <div className="space-y-8">
        {/* City stages */}
        <div className="space-y-4">
          {stages.map((stage, index) => (
            <div key={index} className="space-y-3 relative">
              <div className="flex gap-3 items-center">
                {/* City name */}
                <div className="flex-1 relative group">
                  <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-white/50 group-focus-within:text-white transition-colors z-10" strokeWidth={2} />
                  <Input
                    placeholder={index === 0 ? t('plan.dest.placeholder') : t('plan.dest.stagePlaceholder').replace('{n}', String(index + 1))}
                    value={stage.city}
                    onChange={(e) => {
                      updateStage(index, { city: e.target.value });
                      setActiveDestStage(index);
                    }}
                    onFocus={() => setActiveDestStage(index)}
                    onBlur={() => window.setTimeout(() => {
                      setActiveDestStage(prev => {
                        if (prev === index) { setDestSuggestions([]); return null; }
                        return prev;
                      });
                    }, 120)}
                    className="pl-[3.25rem] pr-6 h-[56px] text-[15px] rounded-[1.2rem] bg-[#0e1220]/50 border-white/[0.08] text-white placeholder:text-white/40 focus:border-white/20 focus:bg-[#0f1429] focus-visible:ring-0 shadow-inner transition-all"
                  />
                  {activeDestStage === index && stage.city.trim().length >= 2 && (
                    <div className="absolute z-50 mt-3 w-full rounded-[1.2rem] border border-white/10 bg-[#0f1629] shadow-2xl overflow-hidden backdrop-blur-xl">
                      <div className="max-h-64 overflow-y-auto py-3">
                        {destSuggestionsLoading ? (
                          <div className="px-6 py-4 text-sm text-muted-foreground flex items-center gap-3">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            {t('plan.dest.searchingCities')}
                          </div>
                        ) : destSuggestions.length > 0 ? (
                          destSuggestions.map((suggestion, si) => (
                            <button
                              key={`dest-${suggestion.displayName}-${si}`}
                              type="button"
                              className="w-full text-left px-6 py-3.5 hover:bg-white/5 transition-colors flex flex-col gap-1"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => applyDestSuggestion(index, suggestion)}
                            >
                              <div className="text-base font-medium text-white line-clamp-1">{suggestion.label || suggestion.displayName}</div>
                              {suggestion.country && (
                                <div className="text-sm text-muted-foreground line-clamp-1">{suggestion.country}</div>
                              )}
                            </button>
                          ))
                        ) : (
                          <div className="px-6 py-4 text-sm text-muted-foreground">
                            {t('plan.dest.noCityFound')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Duration & Remove - only show if multiple stages */}
                {stages.length > 1 && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-[#0e1220]/50 border border-white/[0.08] rounded-[1.2rem] p-1 h-[56px]">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-full w-10 rounded-xl hover:bg-white/10"
                        onClick={() => stage.days > 1 && updateStage(index, { days: stage.days - 1 })}
                        disabled={stage.days <= 1}
                      >
                        -
                      </Button>
                      <div className="w-12 text-center text-sm font-semibold text-white">
                        {stage.days}j
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-full w-10 rounded-xl hover:bg-white/10"
                        onClick={() => stage.days < 30 && updateStage(index, { days: stage.days + 1 })}
                        disabled={stage.days >= 30}
                      >
                        +
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-[56px] w-[56px] rounded-[1.2rem] bg-[#0e1220]/50 border border-white/[0.08] text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 shrink-0 transition-all"
                      onClick={() => removeStage(index)}
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Add stage button */}
          <Button
            type="button"
            variant="outline"
            onClick={addStage}
            className="w-full h-[52px] rounded-[1.2rem] border border-dashed border-white/[0.15] bg-transparent text-white/90 hover:text-white hover:border-white/30 hover:bg-white/[0.03] transition-all gap-3"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            <span className="font-medium tracking-wide">{t('plan.dest.addStage')}</span>
          </Button>
        </div>

        <p className="text-[13px] text-muted-foreground/60 text-center font-light pt-2">
          {t('plan.dest.allLanguages')}
        </p>

        {/* Popular destinations */}
        {!stages[0]?.city && (
          <div className="space-y-10 pt-16">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em]">{t('plan.dest.popular')}</h3>
              <div className="h-px flex-1 bg-white/[0.05] ml-6" />
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {[
                { name: 'Paris', country: 'France', emoji: '🗼', img: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=600&h=400&fit=crop' },
                { name: 'Rome', country: 'Italie', emoji: '🏛️', img: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&h=400&fit=crop' },
                { name: 'Barcelone', country: 'Espagne', emoji: '🏖️', img: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=600&h=400&fit=crop' },
                { name: 'Tokyo', country: 'Japon', emoji: '🏯', img: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&h=400&fit=crop' },
                { name: 'Amsterdam', country: 'Pays-Bas', emoji: '🚲', img: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=600&h=400&fit=crop' },
                { name: 'Marrakech', country: 'Maroc', emoji: '🕌', img: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=600&h=400&fit=crop' },
              ].map((dest) => (
                <button
                  key={dest.name}
                  type="button"
                  onClick={() => {
                    hapticSelection();
                    updateStage(0, { city: dest.name, days: getSuggestedDuration(dest.name, data.origin) });
                  }}
                  className="group relative overflow-hidden rounded-[2.5rem] aspect-[0.9] transition-all duration-700 hover:scale-[1.02] hover:shadow-[0_20px_50px_rgba(197,160,89,0.15)] active:scale-[0.98] border border-white/[0.05]"
                >
                  <img src={dest.img} alt={dest.name} className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
                  
                  {/* Premium overlays */}
                  <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/20 to-[#020617] opacity-90 transition-opacity duration-500 group-hover:opacity-80" />
                  <div className="absolute inset-0 bg-gold/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="absolute inset-0 p-6 flex flex-col justify-end items-start gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xl drop-shadow-md">{dest.emoji}</span>
                      <span className="text-white font-black text-lg tracking-tight leading-tight group-hover:text-gold transition-colors duration-300">{dest.name}</span>
                    </div>
                    <span className="text-[10px] text-white/50 font-bold uppercase tracking-widest pl-8">{dest.country}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function DurationSuggestionCard({
  suggestion,
  onApply,
  onClose,
}: {
  suggestion: DurationSuggestion;
  onApply: (days: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const highlightEntries = Object.entries(suggestion.highlights);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                {t('plan.dest.daysRecommended').replace('{n}', String(suggestion.optimal))}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('plan.dest.betweenDays').replace('{min}', String(suggestion.minimum)).replace('{max}', String(suggestion.maximum))}
              </p>
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">{suggestion.reasoning}</p>

        {/* Duration chips */}
        <div className="flex flex-wrap gap-2">
          {highlightEntries.map(([days, label]) => (
            <button
              key={days}
              type="button"
              onClick={() => onApply(parseInt(days, 10))}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                parseInt(days, 10) === suggestion.optimal
                  ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                  : 'bg-background border-border hover:border-primary/50 hover:bg-primary/5'
              )}
            >
              {days}j — {label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
