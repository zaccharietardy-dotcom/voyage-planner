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
import { CalendarIcon, MapPin, Plus, X, Sparkles, Loader2, Clock, Map, Route, Navigation } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { TripPreferences, CityStage, DurationSuggestion, DestinationSuggestion } from '@/lib/types';
import { useSuggestions } from '@/hooks/useSuggestions';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { StyleMatchBadge } from '@/components/trip/StyleMatchBadge';

interface StepDestinationProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
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

export function StepDestination({ data, onChange }: StepDestinationProps) {
  const mode = data.tripMode || 'precise';
  const stages = data.cityPlan || [{ city: '', days: 7 }];
  const [inspireQuery, setInspireQuery] = useState('');
  const [durationSuggestionForStage, setDurationSuggestionForStage] = useState<number | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [originSuggestions, setOriginSuggestions] = useState<LocationSuggestion[]>([]);
  const [originSuggestionsLoading, setOriginSuggestionsLoading] = useState(false);
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);
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

  // --- Helpers ---

  const setMode = (newMode: 'precise' | 'inspired') => {
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
        setGeoError('La géolocalisation n’est pas disponible sur cet appareil.');
      }
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      if (!silentErrors) {
        setGeoError('La géolocalisation nécessite une connexion HTTPS sécurisée.');
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
            setGeoError('Autorisez la géolocalisation dans Safari (Réglages du site > Localisation) puis réessayez.');
          }
          return;
        }
        if (!silentErrors) {
          setGeoError('Impossible de récupérer votre position actuelle.');
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

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Planifiez votre voyage</h2>
        <p className="text-muted-foreground">Choisissez votre destination ou laissez-vous inspirer</p>
      </div>

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setMode('precise')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
            mode === 'precise'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border hover:border-primary/30 hover:bg-muted/50'
          )}
        >
          <MapPin className={cn('h-6 w-6', mode === 'precise' ? 'text-primary' : 'text-muted-foreground')} />
          <div>
            <p className={cn('font-semibold text-sm', mode === 'precise' && 'text-primary')}>
              Je sais où je vais
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ville(s) et durée
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMode('inspired')}
          className={cn(
            'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
            mode === 'inspired'
              ? 'border-primary bg-primary/5 shadow-sm'
              : 'border-border hover:border-primary/30 hover:bg-muted/50'
          )}
        >
          <Sparkles className={cn('h-6 w-6', mode === 'inspired' ? 'text-primary' : 'text-muted-foreground')} />
          <div>
            <p className={cn('font-semibold text-sm', mode === 'inspired' && 'text-primary')}>
              Inspirez-moi
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Suggestions AI
            </p>
          </div>
        </button>
      </div>

      {/* Origin (common to both modes) */}
      <div className="space-y-2">
        <Label htmlFor="origin" className="text-base font-medium">
          D&apos;où partez-vous ?
        </Label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="origin"
              placeholder="Adresse ou ville de départ"
              value={departureInputValue}
              onChange={(e) => {
                const value = e.target.value;
                const trimmed = value.trim();
                const isAddressLike = looksLikeStreetQuery(value);

                onChange({
                  homeAddress: value,
                  homeCoords: undefined,
                  ...(!trimmed ? { origin: '' } : {}),
                  ...(!isAddressLike ? { origin: trimmed } : {}),
                });
              }}
              onFocus={() => {
                setShowOriginSuggestions(true);
                maybeTriggerGeoPrompt();
              }}
              onBlur={() => window.setTimeout(() => setShowOriginSuggestions(false), 120)}
              className="pl-10 h-12 text-base"
            />
            {showOriginSuggestions && (departureInputValue.trim().length >= 2) && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  {originSuggestionsLoading ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {originQueryIsAddress ? 'Recherche des adresses...' : 'Recherche des villes...'}
                    </div>
                  ) : originSuggestions.length > 0 ? (
                    originSuggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion.displayName}-${index}`}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyOriginSuggestion(suggestion)}
                      >
                        <div className="text-sm font-medium line-clamp-1">{suggestion.label || suggestion.displayName}</div>
                        {originQueryIsAddress && suggestion.subtitle && (
                          <div className="text-xs text-muted-foreground line-clamp-1">{suggestion.subtitle}</div>
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Aucune suggestion.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full sm:w-auto"
            onClick={() => handleUseCurrentLocation({ forceOriginUpdate: true })}
            disabled={geoLoading}
          >
            {geoLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Localisation...
              </>
            ) : (
              <>
                <Navigation className="mr-2 h-4 w-4" />
                Ma position actuelle
              </>
            )}
          </Button>
        </div>
        {data.homeCoords && detectedOriginText && (
          <p className="text-xs text-muted-foreground">
            Position détectée: {detectedOriginText}
          </p>
        )}
        {geoError && (
          <p className="text-xs text-destructive">{geoError}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Astuce: vous pouvez saisir une adresse exacte ou utiliser <span className="font-medium">Ma position actuelle</span>.
        </p>
      </div>

      {/* ============ MODE PRECISE ============ */}
      {mode === 'precise' && (
        <div className="space-y-6">
          {/* City stages */}
          <div className="space-y-3">
            <Label className="text-base font-medium">
              {stages.length > 1 ? 'Étapes du voyage' : 'Destination'}
            </Label>

            {stages.map((stage, index) => (
              <div key={index} className="space-y-2">
                <div className="flex gap-2 items-start">
                  {/* City name */}
                  <div className="flex-1 relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={index === 0 ? 'Barcelone, Tokyo, 北京...' : `Étape ${index + 1}`}
                      value={stage.city}
                      onChange={(e) => updateStage(index, { city: e.target.value })}
                      className="pl-10 h-12 text-base"
                    />
                  </div>

                  {/* Duration for this stage */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-12 w-10"
                      onClick={() => stage.days > 1 && updateStage(index, { days: stage.days - 1 })}
                      disabled={stage.days <= 1}
                    >
                      -
                    </Button>
                    <div className="h-12 w-16 flex items-center justify-center border rounded-md text-sm font-semibold">
                      {stage.days}j
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-12 w-10"
                      onClick={() => stage.days < 30 && updateStage(index, { days: stage.days + 1 })}
                      disabled={stage.days >= 30}
                    >
                      +
                    </Button>
                  </div>

                  {/* Remove stage button */}
                  {stages.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-12 w-10 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeStage(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* Duration suggestion and style match */}
                {stage.city.length > 2 && (
                  <div className="flex items-center gap-3 ml-1">
                    <button
                      type="button"
                      onClick={() => handleDurationSuggestion(index)}
                      disabled={loadingDuration && durationSuggestionForStage === index}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    >
                      {loadingDuration && durationSuggestionForStage === index ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Clock className="h-3 w-3" />
                      )}
                      Combien de jours ?
                    </button>

                    {/* Show style match if user has preferences */}
                    {preferences && (
                      <StyleMatchBadge
                        destination={stage.city}
                        preferences={preferences}
                        showIcon={false}
                      />
                    )}
                  </div>
                )}

                {/* Duration suggestion display for this stage */}
                {durationSuggestion && durationSuggestionForStage === index && (
                  <DurationSuggestionCard
                    suggestion={durationSuggestion}
                    onApply={applyDurationChip}
                    onClose={() => { clearDuration(); setDurationSuggestionForStage(null); }}
                  />
                )}
              </div>
            ))}

            {/* Add stage button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addStage}
              className="w-full border-dashed"
            >
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une ville
            </Button>

            {/* Total duration display */}
            {stages.length > 1 && (
              <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg">
                <span className="text-sm text-muted-foreground">Durée totale</span>
                <span className="text-lg font-bold text-primary">{totalDays} jours</span>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Fonctionne dans toutes les langues (français, anglais, chinois, arabe...)
          </p>
        </div>
      )}

      {/* ============ MODE INSPIRED ============ */}
      {mode === 'inspired' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-base font-medium">
              Décrivez votre envie de voyage
            </Label>
            <Textarea
              placeholder="Japon, vacances plage, road trip Italie du sud, city break en Europe..."
              value={inspireQuery}
              onChange={(e) => setInspireQuery(e.target.value)}
              className="min-h-20 text-base"
            />
          </div>

          <Button
            type="button"
            onClick={() => fetchDestinationSuggestions(inspireQuery, {
              origin: data.origin,
              activities: data.activities,
              budgetLevel: data.budgetLevel,
              groupType: data.groupType,
              durationDays: data.durationDays,
            })}
            disabled={!inspireQuery.trim() || loadingDestination}
            className="w-full"
          >
            {loadingDestination ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Génération en cours...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Suggérer des itinéraires
              </>
            )}
          </Button>

          {/* Destination suggestions */}
          {destinationSuggestions && destinationSuggestions.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-muted-foreground">
                Itinéraires suggérés
              </p>
              {destinationSuggestions.map((suggestion, index) => {
                const TypeIcon = TYPE_LABELS[suggestion.type]?.icon || Map;
                return (
                  <Card
                    key={index}
                    className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer group"
                    onClick={() => applyDestinationSuggestion(suggestion)}
                  >
                    <CardContent className="p-4 space-y-3">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-base truncate">{suggestion.title}</h3>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {suggestion.description}
                          </p>
                        </div>
                        <Badge variant="secondary" className="shrink-0 gap-1">
                          <TypeIcon className="h-3 w-3" />
                          {TYPE_LABELS[suggestion.type]?.label}
                        </Badge>
                      </div>

                      {/* Stages */}
                      <div className="flex items-center gap-1.5 text-sm flex-wrap">
                        {suggestion.stages.map((stage, si) => (
                          <span key={si} className="flex items-center gap-1">
                            {si > 0 && <span className="text-muted-foreground">→</span>}
                            <span className="font-medium">{stage.city}</span>
                            <span className="text-muted-foreground">{stage.days}j</span>
                          </span>
                        ))}
                      </div>

                      {/* Highlights */}
                      <div className="flex flex-wrap gap-1.5">
                        {suggestion.highlights.slice(0, 3).map((h, hi) => (
                          <Badge key={hi} variant="outline" className="text-xs font-normal">
                            {h}
                          </Badge>
                        ))}
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
                        <span>{suggestion.estimatedBudget}</span>
                        {suggestion.bestSeason && <span>{suggestion.bestSeason}</span>}
                        <span className="text-primary font-medium group-hover:underline">
                          Choisir →
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Date (common to both modes) */}
      <div className="space-y-2">
        <Label className="text-base font-medium">Date de départ</Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-full h-12 justify-start text-left font-normal text-base',
                !data.startDate && 'text-muted-foreground'
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {data.startDate ? (
                format(data.startDate, 'PPP', { locale: fr })
              ) : (
                <span>Sélectionnez une date</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={data.startDate}
              onSelect={(date) => date && onChange({ startDate: date })}
              disabled={(date) => date < new Date()}
              initialFocus
            />
          </PopoverContent>
        </Popover>
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
  const highlightEntries = Object.entries(suggestion.highlights);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <div>
              <p className="text-sm font-semibold">
                {suggestion.optimal} jours recommandés
              </p>
              <p className="text-xs text-muted-foreground">
                entre {suggestion.minimum} et {suggestion.maximum} jours
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
