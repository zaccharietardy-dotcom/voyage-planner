'use client';

import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  TripPreferences,
  ActivityType,
  DietaryType,
  ACTIVITY_LABELS,
  DIETARY_LABELS,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { getMustSeeAttractions, Attraction } from '@/lib/services/attractions';
import { MapPin, Star, Clock, Ticket } from 'lucide-react';

interface StepActivitiesProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

const ACTIVITY_OPTIONS: ActivityType[] = [
  'beach',
  'nature',
  'culture',
  'gastronomy',
  'nightlife',
  'shopping',
  'adventure',
  'wellness',
];

const DIETARY_OPTIONS: DietaryType[] = [
  'none',
  'vegetarian',
  'vegan',
  'halal',
  'kosher',
  'gluten_free',
];

export function StepActivities({ data, onChange }: StepActivitiesProps) {
  const activities = data.activities || [];
  const dietary = data.dietary || [];
  const [suggestions, setSuggestions] = useState<Attraction[]>([]);
  const [selectedAttractions, setSelectedAttractions] = useState<Set<string>>(new Set());

  // Charger les suggestions basées sur la destination
  useEffect(() => {
    if (data.destination) {
      const mustSee = getMustSeeAttractions(data.destination);
      setSuggestions(mustSee);

      // Si mustSee existe déjà, parser les attractions sélectionnées
      if (data.mustSee) {
        const selected = new Set<string>();
        mustSee.forEach((a) => {
          if (data.mustSee?.toLowerCase().includes(a.name.toLowerCase())) {
            selected.add(a.id);
          }
        });
        setSelectedAttractions(selected);
      }
    }
  }, [data.destination]);

  const toggleActivity = (activity: ActivityType) => {
    const newActivities = activities.includes(activity)
      ? activities.filter((a) => a !== activity)
      : [...activities, activity];
    onChange({ activities: newActivities });
  };

  const toggleDietary = (diet: DietaryType) => {
    if (diet === 'none') {
      onChange({ dietary: ['none'] });
      return;
    }

    const withoutNone = dietary.filter((d) => d !== 'none');
    const newDietary = withoutNone.includes(diet)
      ? withoutNone.filter((d) => d !== diet)
      : [...withoutNone, diet];
    onChange({ dietary: newDietary.length === 0 ? ['none'] : newDietary });
  };

  const toggleAttraction = (attraction: Attraction) => {
    const newSelected = new Set(selectedAttractions);
    if (newSelected.has(attraction.id)) {
      newSelected.delete(attraction.id);
    } else {
      newSelected.add(attraction.id);
    }
    setSelectedAttractions(newSelected);

    // Mettre à jour le champ mustSee
    const selectedNames = suggestions
      .filter((a) => newSelected.has(a.id))
      .map((a) => a.name);
    onChange({ mustSee: selectedNames.join(', ') });
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Que voulez-vous faire ?</h2>
        <p className="text-muted-foreground">Sélectionnez vos types d'activités préférés</p>
      </div>

      {/* Types d'activités */}
      <div className="space-y-4">
        <Label className="text-base font-medium">
          Activités <span className="text-muted-foreground font-normal">(plusieurs choix possibles)</span>
        </Label>
        <div className="flex flex-wrap gap-3">
          {ACTIVITY_OPTIONS.map((activity) => (
            <button
              key={activity}
              type="button"
              onClick={() => toggleActivity(activity)}
              className={cn(
                'px-4 py-2.5 rounded-full border-2 transition-all text-sm font-medium',
                'hover:border-primary hover:bg-primary/5',
                activities.includes(activity)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card'
              )}
            >
              {ACTIVITY_LABELS[activity]}
            </button>
          ))}
        </div>
        {activities.length === 0 && (
          <p className="text-sm text-amber-600">Sélectionnez au moins une activité</p>
        )}
      </div>

      {/* Suggestions d'incontournables basées sur la destination */}
      {suggestions.length > 0 && (
        <div className="space-y-4">
          <Label className="text-base font-medium">
            Incontournables à {data.destination}{' '}
            <span className="text-muted-foreground font-normal">(cliquez pour sélectionner)</span>
          </Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {suggestions.map((attraction) => (
              <button
                key={attraction.id}
                type="button"
                onClick={() => toggleAttraction(attraction)}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all',
                  'hover:border-primary/50 hover:bg-primary/5',
                  selectedAttractions.has(attraction.id)
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-card'
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                    selectedAttractions.has(attraction.id)
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground/30'
                  )}
                >
                  {selectedAttractions.has(attraction.id) && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{attraction.name}</div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {attraction.description}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {Math.round(attraction.duration / 60)}h{attraction.duration % 60 > 0 ? (attraction.duration % 60).toString().padStart(2, '0') : ''}
                    </span>
                    {attraction.estimatedCost > 0 && (
                      <span className="flex items-center gap-1">
                        <Ticket className="h-3 w-3" />
                        ~{attraction.estimatedCost}€
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      {attraction.rating.toFixed(1)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Régimes alimentaires */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Régime alimentaire</Label>
        <div className="flex flex-wrap gap-3">
          {DIETARY_OPTIONS.map((diet) => (
            <button
              key={diet}
              type="button"
              onClick={() => toggleDietary(diet)}
              className={cn(
                'px-4 py-2.5 rounded-full border-2 transition-all text-sm font-medium',
                'hover:border-primary hover:bg-primary/5',
                dietary.includes(diet)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card'
              )}
            >
              {DIETARY_LABELS[diet]}
            </button>
          ))}
        </div>
      </div>

      {/* Champ texte pour autres incontournables */}
      <div className="space-y-3">
        <Label htmlFor="must-see" className="text-base font-medium">
          Autres lieux à inclure{' '}
          <span className="text-muted-foreground font-normal">(optionnel)</span>
        </Label>
        <Textarea
          id="must-see"
          placeholder="Ajoutez d'autres lieux que vous souhaitez visiter..."
          value={data.mustSee || ''}
          onChange={(e) => onChange({ mustSee: e.target.value })}
          className="min-h-[80px] text-base resize-none"
        />
      </div>
    </div>
  );
}
