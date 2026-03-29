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
    <div className="space-y-12 max-w-[600px] mx-auto w-full">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-[3.5rem] leading-none font-serif font-bold tracking-tight text-[#f8fafc]">
          Avec qui partez-vous ?
        </h2>
        <p className="text-[17px] text-[#94a3b8] font-light">
          Pour adapter les activités et le rythme de votre séjour.
        </p>
      </div>

      <div className="space-y-10">
        {/* Nombre de personnes */}
        <div className="space-y-4">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">Nombre de voyageurs</p>
          <div className="flex items-center justify-center gap-8 p-10 rounded-[2.5rem] border border-white/[0.08] bg-[#0e1220]/50 shadow-inner relative overflow-hidden">
            <div className="absolute inset-0 bg-gold/5 blur-3xl opacity-20" />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-16 w-16 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/30 transition-all"
              onClick={decrement}
              disabled={groupSize <= 1}
            >
              <Minus className="h-6 w-6 text-white" />
            </Button>
            <div className="text-center min-w-[120px] z-10">
              <span className="text-[5rem] leading-none font-serif font-bold text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.2)]">{groupSize}</span>
              <p className="text-[11px] font-bold uppercase tracking-widest text-gold/80 mt-4">
                {groupSize === 1 ? 'Voyageur' : 'Voyageurs'}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-16 w-16 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/30 transition-all"
              onClick={increment}
              disabled={groupSize >= 20}
            >
              <Plus className="h-6 w-6 text-white" />
            </Button>
          </div>
        </div>

        {/* Type de groupe */}
        <div className="space-y-4">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">Type de voyage</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {availableOptions.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleGroupTypeChange(type)}
                className={cn(
                  'flex items-center gap-5 p-5 rounded-[1.5rem] border transition-all duration-300 relative group text-left',
                  data.groupType === type
                    ? 'border-gold bg-[#0e1220] shadow-[0_10px_30px_rgba(197,160,89,0.15)] scale-[1.02]'
                    : 'border-white/[0.08] bg-[#0e1220]/50 hover:bg-[#0f1429] hover:border-white/20'
                )}
              >
                <div
                  className={cn(
                    'p-4 rounded-2xl transition-all duration-300',
                    data.groupType === type ? 'bg-gold text-black shadow-lg shadow-gold/30' : 'bg-white/5 text-white/40 group-hover:text-white/60'
                  )}
                >
                  {GROUP_ICONS[type]}
                </div>
                <span className={cn(
                  'text-lg font-bold tracking-tight transition-colors',
                  data.groupType === type ? 'text-white' : 'text-white/70 group-hover:text-white/90'
                )}>
                  {GROUP_TYPE_LABELS[type]}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
