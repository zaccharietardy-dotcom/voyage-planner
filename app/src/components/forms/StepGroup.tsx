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

const GROUP_OPTIONS: GroupType[] = ['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids'];

export function StepGroup({ data, onChange }: StepGroupProps) {
  const groupSize = data.groupSize || 1;

  const increment = () => {
    if (groupSize < 20) {
      onChange({ groupSize: groupSize + 1 });
    }
  };

  const decrement = () => {
    if (groupSize > 1) {
      onChange({ groupSize: groupSize - 1 });
    }
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
          {GROUP_OPTIONS.map((groupType) => (
            <button
              key={groupType}
              type="button"
              onClick={() => onChange({ groupType })}
              className={cn(
                'flex items-center gap-4 p-4 rounded-xl border-2 transition-all text-left',
                'hover:border-primary hover:bg-primary/5',
                data.groupType === groupType
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card'
              )}
            >
              <div
                className={cn(
                  'p-3 rounded-full',
                  data.groupType === groupType ? 'bg-primary text-primary-foreground' : 'bg-muted'
                )}
              >
                {GROUP_ICONS[groupType]}
              </div>
              <span className="font-medium">{GROUP_TYPE_LABELS[groupType]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
