'use client';

import { TripPreferences } from '@/lib/types';

interface StepPreferencesProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

type ActivityType = 'beach' | 'nature' | 'culture' | 'gastronomy' | 'nightlife' | 'shopping' | 'adventure' | 'wellness';

const PREFERENCE_OPTIONS: { id: ActivityType; emoji: string; label: string }[] = [
  { id: 'culture', emoji: '\u{1F3DB}\u{FE0F}', label: 'Culture' },
  { id: 'nature', emoji: '\u{1F333}', label: 'Nature' },
  { id: 'gastronomy', emoji: '\u{1F37D}\u{FE0F}', label: 'Foodie' },
  { id: 'adventure', emoji: '\u{26F0}\u{FE0F}', label: 'Aventure' },
  { id: 'beach', emoji: '\u{1F3D6}\u{FE0F}', label: 'Plage' },
  { id: 'shopping', emoji: '\u{1F6CD}\u{FE0F}', label: 'Shopping' },
  { id: 'nightlife', emoji: '\u{1F378}', label: 'Nightlife' },
  { id: 'wellness', emoji: '\u{1F9D8}', label: 'Wellness' },
];

export function StepPreferences({ data, onChange }: StepPreferencesProps) {
  const selected = data.activities || [];

  const toggle = (id: ActivityType) => {
    const next = selected.includes(id)
      ? selected.filter((a) => a !== id)
      : [...selected, id];
    onChange({ activities: next });
  };

  const skipAll = () => {
    // Select a balanced default set
    onChange({ activities: ['culture', 'gastronomy', 'nature'] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-serif font-bold mb-1">Vos centres d'intérêt</h2>
        <p className="text-sm text-muted-foreground">Sélectionnez vos préférences pour personnaliser l'itinéraire</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {PREFERENCE_OPTIONS.map((opt) => {
          const isSelected = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-all active:scale-[0.97] ${
                isSelected
                  ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                  : 'border-border/60 bg-card hover:border-primary/20'
              }`}
              onClick={() => toggle(opt.id)}
            >
              <span className="text-2xl">{opt.emoji}</span>
              <span className="text-sm font-medium">{opt.label}</span>
            </button>
          );
        })}
      </div>

      <button
        className="w-full text-center text-sm text-primary font-medium py-2 hover:underline"
        onClick={skipAll}
      >
        Passer, surprenez-moi !
      </button>
    </div>
  );
}
