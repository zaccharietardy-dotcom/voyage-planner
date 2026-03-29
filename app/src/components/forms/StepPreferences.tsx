'use client';

import { TripPreferences, PaceLevel } from '@/lib/types';

interface StepPreferencesProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

type ActivityType = 'beach' | 'nature' | 'culture' | 'gastronomy' | 'nightlife' | 'shopping' | 'adventure' | 'wellness';

const PACE_OPTIONS: { id: PaceLevel; emoji: string; label: string; description: string }[] = [
  { id: 'relaxed', emoji: '\u{1F422}', label: 'Tranquille', description: 'Peu d\u2019activités, du temps libre' },
  { id: 'moderate', emoji: '\u2696\uFE0F', label: 'Équilibré', description: 'Un bon mix activités et repos' },
  { id: 'intensive', emoji: '\u{1F680}', label: 'Intensif', description: 'Maximum de découvertes' },
];

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
    <div className="space-y-12 max-w-[600px] mx-auto w-full">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-[3.5rem] leading-none font-serif font-bold tracking-tight text-[#f8fafc]">
          Qu&apos;aimez-vous faire ?
        </h2>
        <p className="text-[17px] text-[#94a3b8] font-light">
          Sélectionnez vos centres d&apos;intérêt pour un voyage qui vous ressemble.
        </p>
      </div>

      <div className="space-y-10">
        <div className="space-y-4">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">Activités favorites</p>
          <div className="grid grid-cols-2 gap-4">
            {PREFERENCE_OPTIONS.map((opt) => {
              const isSelected = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  className={`flex items-center gap-4 rounded-[1.5rem] border p-5 text-left transition-all duration-300 active:scale-[0.97] group ${
                    isSelected
                      ? 'border-gold bg-[#0e1220] shadow-[0_10px_30px_rgba(197,160,89,0.15)] scale-[1.02]'
                      : 'border-white/[0.08] bg-[#0e1220]/50 hover:bg-[#0f1429] hover:border-white/20'
                  }`}
                  onClick={() => toggle(opt.id)}
                >
                  <span className={`text-3xl transition-transform duration-300 ${isSelected ? 'scale-110' : 'group-hover:scale-110 opacity-60 group-hover:opacity-100'}`}>{opt.emoji}</span>
                  <span className={`text-lg font-bold tracking-tight transition-colors ${isSelected ? 'text-white' : 'text-white/70 group-hover:text-white/90'}`}>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <button
            className="w-full text-center text-sm font-black uppercase tracking-[0.2em] text-gold/60 py-6 hover:text-gold transition-colors"
            onClick={skipAll}
          >
            Passer, surprenez-moi !
          </button>
        </div>

        <div className="space-y-4 pt-6 border-t border-white/[0.05]">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">Rythme du voyage</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PACE_OPTIONS.map((opt) => {
              const isSelected = (data.pace || 'moderate') === opt.id;
              return (
                <button
                  key={opt.id}
                  className={`flex flex-col items-center gap-2 rounded-[1.5rem] border p-6 text-center transition-all duration-300 active:scale-[0.97] group ${
                    isSelected
                      ? 'border-gold bg-[#0e1220] shadow-[0_10px_30px_rgba(197,160,89,0.15)] scale-[1.02]'
                      : 'border-white/[0.08] bg-[#0e1220]/50 hover:bg-[#0f1429] hover:border-white/20'
                  }`}
                  onClick={() => onChange({ pace: opt.id })}
                >
                  <span className={`text-4xl mb-2 transition-transform duration-300 ${isSelected ? 'scale-110' : 'group-hover:scale-110 opacity-60 group-hover:opacity-100'}`}>{opt.emoji}</span>
                  <span className={`text-[15px] font-bold tracking-tight transition-colors ${isSelected ? 'text-white' : 'text-white/70 group-hover:text-white/90'}`}>{opt.label}</span>
                  <span className="text-[11px] font-medium text-white/40 leading-tight mt-1">{opt.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
