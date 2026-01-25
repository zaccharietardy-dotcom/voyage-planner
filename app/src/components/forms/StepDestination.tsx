'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { TripPreferences } from '@/lib/types';

interface StepDestinationProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

export function StepDestination({ data, onChange }: StepDestinationProps) {
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
            placeholder="Barcelone, Espagne"
            value={data.destination || ''}
            onChange={(e) => onChange({ destination: e.target.value })}
            className="pl-10 h-12 text-base"
          />
        </div>
      </div>

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
