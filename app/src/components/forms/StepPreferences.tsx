'use client';

import { TripPreferences, PaceLevel } from '@/lib/types';
import { useTranslation } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';

interface StepPreferencesProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

type ActivityType = 'beach' | 'nature' | 'culture' | 'gastronomy' | 'nightlife' | 'shopping' | 'adventure' | 'wellness';

const PACE_IDS: { id: PaceLevel; emoji: string; labelKey: TranslationKey; descKey: TranslationKey }[] = [
  { id: 'relaxed', emoji: '\u{1F422}', labelKey: 'plan.pref.paceRelaxed', descKey: 'plan.pref.paceRelaxedDesc' },
  { id: 'moderate', emoji: '\u2696\uFE0F', labelKey: 'plan.pref.paceModerate', descKey: 'plan.pref.paceModerateDesc' },
  { id: 'intensive', emoji: '\u{1F680}', labelKey: 'plan.pref.paceIntensive', descKey: 'plan.pref.paceIntensiveDesc' },
];

const ACTIVITY_IDS: { id: ActivityType; emoji: string; labelKey: TranslationKey }[] = [
  { id: 'culture', emoji: '\u{1F3DB}\u{FE0F}', labelKey: 'plan.pref.culture' },
  { id: 'nature', emoji: '\u{1F333}', labelKey: 'plan.pref.nature' },
  { id: 'gastronomy', emoji: '\u{1F37D}\u{FE0F}', labelKey: 'plan.pref.foodie' },
  { id: 'adventure', emoji: '\u{26F0}\u{FE0F}', labelKey: 'plan.pref.adventure' },
  { id: 'beach', emoji: '\u{1F3D6}\u{FE0F}', labelKey: 'plan.pref.beach' },
  { id: 'shopping', emoji: '\u{1F6CD}\u{FE0F}', labelKey: 'plan.pref.shopping' },
  { id: 'nightlife', emoji: '\u{1F378}', labelKey: 'plan.pref.nightlife' },
  { id: 'wellness', emoji: '\u{1F9D8}', labelKey: 'plan.pref.wellness' },
];

export function StepPreferences({ data, onChange }: StepPreferencesProps) {
  const { t } = useTranslation();
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
    <div className="space-y-12 max-w-[650px] mx-auto w-full">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-5xl font-serif font-bold tracking-tight text-white">
          {t('plan.pref.title')}
        </h2>
        <p className="text-lg text-muted-foreground font-light">
          {t('plan.pref.subtitle')}
        </p>
      </div>

      <div className="space-y-12">
        <div className="space-y-6">
          <p className="text-center text-[10px] font-black uppercase tracking-[0.3em] text-white/40">{t('plan.pref.activities')}</p>
          
          <div className="flex flex-wrap justify-center gap-3">
            {ACTIVITY_IDS.map((opt) => {
              const isSelected = selected.includes(opt.id);
              return (
                <button
                  key={opt.id}
                  className={`
                    flex items-center gap-3 px-6 py-4 rounded-full border-2 transition-all duration-500 active:scale-[0.95] group
                    ${isSelected
                      ? 'border-gold bg-gold/10 text-white shadow-[0_0_30px_rgba(197,160,89,0.2)]'
                      : 'border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/20 hover:bg-white/[0.05]'
                    }
                  `}
                  onClick={() => toggle(opt.id)}
                >
                  <span className={`text-2xl transition-transform duration-500 ${isSelected ? 'scale-110' : 'group-hover:scale-110 grayscale group-hover:grayscale-0'}`}>
                    {opt.emoji}
                  </span>
                  <span className="text-sm font-black uppercase tracking-widest leading-none">
                    {t(opt.labelKey)}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            className="w-full text-center text-[10px] font-black uppercase tracking-[0.3em] text-gold/40 py-4 hover:text-gold transition-colors"
            onClick={skipAll}
          >
            {t('plan.pref.skipSurprise')}
          </button>
        </div>

        <div className="space-y-6 pt-10 border-t border-white/[0.05]">
          <p className="text-center text-[10px] font-black uppercase tracking-[0.3em] text-white/40">{t('plan.pref.pace')}</p>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {PACE_IDS.map((opt) => {
              const isSelected = (data.pace || 'moderate') === opt.id;
              return (
                <button
                  key={opt.id}
                  className={`
                    flex flex-col items-center gap-3 rounded-3xl border-2 p-6 text-center transition-all duration-500 active:scale-[0.95] group
                    ${isSelected
                      ? 'border-gold bg-gold/10 shadow-[0_0_30px_rgba(197,160,89,0.2)]'
                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.05]'
                    }
                  `}
                  onClick={() => onChange({ pace: opt.id })}
                >
                  <span className={`text-4xl mb-1 transition-transform duration-500 ${isSelected ? 'scale-110' : 'grayscale group-hover:grayscale-0'}`}>
                    {opt.emoji}
                  </span>
                  <span className={`text-sm font-black uppercase tracking-widest transition-colors ${isSelected ? 'text-gold' : 'text-white/70'}`}>
                    {t(opt.labelKey)}
                  </span>
                  <span className="text-[10px] font-bold text-white/40 leading-tight uppercase tracking-wider">
                    {t(opt.descKey)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
