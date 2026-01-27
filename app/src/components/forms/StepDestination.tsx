'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CalendarIcon, MapPin, Star, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { TripPreferences } from '@/lib/types';

interface MustSeeAttraction {
  id: string;
  name: string;
  type: string;
  description?: string;
  duration?: number;
  estimatedCost?: number;
}

interface StepDestinationProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

export function StepDestination({ data, onChange }: StepDestinationProps) {
  const [mustSeeAttractions, setMustSeeAttractions] = useState<MustSeeAttraction[]>([]);
  const [isLoadingAttractions, setIsLoadingAttractions] = useState(false);
  const [selectedMustSee, setSelectedMustSee] = useState<string[]>(
    data.mustSee ? data.mustSee.split(',').map(s => s.trim()).filter(Boolean) : []
  );

  // Charger les incontournables quand la destination change
  const fetchMustSeeAttractions = useCallback(async (destination: string) => {
    if (!destination || destination.length < 2) {
      setMustSeeAttractions([]);
      return;
    }

    setIsLoadingAttractions(true);
    try {
      const response = await fetch(`/api/attractions?city=${encodeURIComponent(destination)}&mustSee=true`);
      if (response.ok) {
        const data = await response.json();
        setMustSeeAttractions(data.attractions || []);
      }
    } catch (error) {
      console.error('Erreur chargement attractions:', error);
    } finally {
      setIsLoadingAttractions(false);
    }
  }, []);

  // Debounce pour éviter trop d'appels API
  useEffect(() => {
    const timer = setTimeout(() => {
      if (data.destination) {
        fetchMustSeeAttractions(data.destination);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [data.destination, fetchMustSeeAttractions]);

  // Mettre à jour les préférences quand les sélections changent
  useEffect(() => {
    onChange({ mustSee: selectedMustSee.join(', ') });
  }, [selectedMustSee, onChange]);

  const handleMustSeeToggle = (attractionName: string) => {
    setSelectedMustSee(prev => {
      if (prev.includes(attractionName)) {
        return prev.filter(n => n !== attractionName);
      } else {
        return [...prev, attractionName];
      }
    });
  };

  const getTypeEmoji = (type: string) => {
    const emojis: Record<string, string> = {
      culture: '🏛️',
      nature: '🌳',
      gastronomy: '🍽️',
      beach: '🏖️',
      shopping: '🛍️',
      nightlife: '🎉',
      adventure: '🎢',
      wellness: '🧘',
    };
    return emojis[type] || '📍';
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Où voulez-vous aller ?</h2>
        <p className="text-muted-foreground">Définissez votre destination et vos dates de voyage</p>
      </div>

      {/* Ville de départ */}
      <div className="space-y-2">
        <Label htmlFor="origin" className="text-base font-medium">
          Ville de départ
        </Label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="origin"
            placeholder="Paris, France"
            value={data.origin || ''}
            onChange={(e) => onChange({ origin: e.target.value })}
            className="pl-10 h-12 text-base"
          />
        </div>
      </div>

      {/* Ville d'arrivée */}
      <div className="space-y-2">
        <Label htmlFor="destination" className="text-base font-medium">
          Destination
        </Label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="destination"
            placeholder="Barcelone, Londres, Tokyo, 北京..."
            value={data.destination || ''}
            onChange={(e) => onChange({ destination: e.target.value })}
            className="pl-10 h-12 text-base"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Fonctionne dans toutes les langues (français, anglais, chinois, arabe...)
        </p>
      </div>

      {/* Incontournables */}
      {(isLoadingAttractions || mustSeeAttractions.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-500" />
            <Label className="text-base font-medium">Incontournables à inclure</Label>
            {isLoadingAttractions && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {mustSeeAttractions.length > 0 && (
            <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto">
              {mustSeeAttractions.map((attraction) => (
                <label
                  key={attraction.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                    selectedMustSee.includes(attraction.name)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <Checkbox
                    checked={selectedMustSee.includes(attraction.name)}
                    onCheckedChange={() => handleMustSeeToggle(attraction.name)}
                  />
                  <span className="text-lg">{getTypeEmoji(attraction.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{attraction.name}</p>
                    {attraction.duration && (
                      <p className="text-xs text-muted-foreground">
                        ~{Math.round(attraction.duration / 60)}h
                        {attraction.estimatedCost ? ` · ${attraction.estimatedCost}€` : ' · Gratuit'}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}

          {mustSeeAttractions.length === 0 && !isLoadingAttractions && data.destination && (
            <p className="text-sm text-muted-foreground italic">
              Aucun incontournable trouvé pour cette destination. Vous pourrez en ajouter manuellement.
            </p>
          )}

          {selectedMustSee.length > 0 && (
            <p className="text-xs text-primary">
              {selectedMustSee.length} incontournable{selectedMustSee.length > 1 ? 's' : ''} sélectionné{selectedMustSee.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Date de départ */}
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

      {/* Durée du voyage */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Label className="text-base font-medium">Durée du voyage</Label>
          <span className="text-2xl font-bold text-primary">
            {data.durationDays || 7} jours
          </span>
        </div>
        <Slider
          value={[data.durationDays || 7]}
          onValueChange={([value]) => onChange({ durationDays: value })}
          min={1}
          max={30}
          step={1}
          className="py-4"
        />
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>1 jour</span>
          <span>30 jours</span>
        </div>
      </div>
    </div>
  );
}
