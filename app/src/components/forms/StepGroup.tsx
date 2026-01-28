'use client';

import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { TripPreferences, GroupType, GROUP_TYPE_LABELS } from '@/lib/types';
import { Minus, Plus, User, Users, Heart, Baby } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StepGroupProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

const GROUP_ICONS: Record<GroupType, React.ReactNode> = {
  solo: <User className="h-6 w-6" />,
  couple: <Heart className="h-6 w-6" />,
  friends: <Users className="h-6 w-6" />,
  family_with_kids: <Baby className="h-6 w-6" />,
  family_without_kids: <Users className="h-6 w-6" />,
};

const MIN_GROUP_SIZE: Record<GroupType, number> = {
  solo: 1,
  couple: 2,
  friends: 2,
  family_with_kids: 2,
  family_without_kids: 2,
};

const ALL_GROUP_OPTIONS: GroupType[] = ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'];

export function StepGroup({ data, onChange }: StepGroupProps) {
  const groupSize = data.groupSize || 2;
  const groupType = data.groupType;

  // Filtrer les options disponibles selon la taille du groupe
  const availableOptions = ALL_GROUP_OPTIONS.filter((type) => {
    if (groupSize === 1) return type === 'solo';
    if (groupSize >= 2) return type !== 'solo';
    return true;
  });

  const increment = () => {
    if (groupSize < 20) {
      const newSize = groupSize + 1;
      const updates: Partial<TripPreferences> = { groupSize: newSize };
      // Si on passe de 1 à 2, et le type était solo, le reset
      if (newSize >= 2 && groupType === 'solo') {
        updates.groupType = 'couple';
      }
      onChange(updates);
    }
  };

  const decrement = () => {
    if (groupSize > 1) {
      const newSize = groupSize - 1;
      const updates: Partial<TripPreferences> = { groupSize: newSize };
      // Si on passe à 1, forcer solo
      if (newSize === 1) {
        updates.groupType = 'solo';
      }
      onChange(updates);
    }
  };

  const handleGroupTypeChange = (type: GroupType) => {
    const minSize = MIN_GROUP_SIZE[type];
    const updates: Partial<TripPreferences> = { groupType: type };
    // Ajuster la taille minimum si nécessaire
    if (groupSize < minSize) {
      updates.groupSize = minSize;
    }
    // Solo = exactement 1
    if (type === 'solo') {
      updates.groupSize = 1;
    }
    onChange(updates);
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Avec qui partez-vous ?</h2>
        <p className="text-muted-foreground">Indiquez la taille et le type de votre groupe</p>
      </div>

      {/* Nombre de personnes */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Nombre de voyageurs</Label>
        <div className="flex items-center justify-center gap-6 p-6 rounded-xl border bg-card">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-full"
            onClick={decrement}
            disabled={groupSize <= 1}
          >
            <Minus className="h-5 w-5" />
          </Button>
          <div className="text-center min-w-[100px]">
            <span className="text-5xl font-bold text-primary">{groupSize}</span>
            <p className="text-sm text-muted-foreground mt-1">
              {groupSize === 1 ? 'personne' : 'personnes'}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-12 w-12 rounded-full"
            onClick={increment}
            disabled={groupSize >= 20}
          >
            <Plus className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Type de groupe */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Type de voyage</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {availableOptions.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => handleGroupTypeChange(type)}
              className={cn(
                'flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
                'hover:border-primary hover:bg-primary/5',
                data.groupType === type
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card'
              )}
            >
              <div
                className={cn(
                  'p-3 rounded-full',
                  data.groupType === type ? 'bg-primary text-primary-foreground' : 'bg-muted'
                )}
              >
                {GROUP_ICONS[type]}
              </div>
              <span className="font-medium">{GROUP_TYPE_LABELS[type]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
