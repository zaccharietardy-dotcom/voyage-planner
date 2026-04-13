'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { TripPreferences, BudgetLevel, BUDGET_LABELS } from '@/lib/types';
import { Wallet, Coins, CreditCard, Gem, ChefHat, UtensilsCrossed, Shuffle, Settings2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';

interface StepBudgetProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

const BUDGET_ICONS: Record<BudgetLevel, React.ReactNode> = {
  economic: <Coins className="h-6 w-6" />,
  moderate: <Wallet className="h-6 w-6" />,
  comfort: <CreditCard className="h-6 w-6" />,
  luxury: <Gem className="h-6 w-6" />,
};

const BUDGET_OPTIONS: BudgetLevel[] = ['economic', 'moderate', 'comfort', 'luxury'];

export function StepBudget({ data, onChange }: StepBudgetProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-8 max-w-[500px] mx-auto w-full">
      <div className="text-center space-y-4">
        <h2 className="text-2xl md:text-3xl leading-tight font-serif font-bold tracking-tight text-[#f8fafc]">
          {t('plan.budget.title')}
        </h2>
        <p className="text-[17px] text-[#94a3b8] font-light">
          {t('plan.budget.subtitle')}
        </p>
      </div>

      <div className="space-y-10">
        {/* Niveaux de budget */}
        <div className="space-y-4">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">{t('plan.budget.comfortLevel')}</p>
          <div className="grid grid-cols-2 gap-4">
            {BUDGET_OPTIONS.map((budget) => (
              <button
                key={budget}
                type="button"
                onClick={() => onChange({ budgetLevel: budget, budgetCustom: undefined })}
                className={cn(
                  'flex flex-col items-center justify-center p-6 rounded-[1.5rem] border transition-all duration-300 group',
                  data.budgetLevel === budget && !data.budgetCustom
                    ? 'border-gold bg-[#0e1220] shadow-[0_10px_30px_rgba(197,160,89,0.15)] scale-[1.02]'
                    : 'border-white/[0.08] bg-[#0e1220]/50 hover:bg-[#0f1429] hover:border-white/20'
                )}
              >
                <div
                  className={cn(
                    'p-4 rounded-2xl mb-4 transition-all duration-300',
                    data.budgetLevel === budget && !data.budgetCustom
                      ? 'bg-gold text-black shadow-lg shadow-gold/30'
                      : 'bg-white/5 text-white/40 group-hover:text-white/60'
                  )}
                >
                  {BUDGET_ICONS[budget]}
                </div>
                <span className={cn(
                  'text-lg font-bold tracking-tight transition-colors',
                  data.budgetLevel === budget && !data.budgetCustom ? 'text-white' : 'text-white/70 group-hover:text-white/90'
                )}>
                  {t(`plan.budgetLevels.${budget === 'economic' ? 'budget' : budget}`)}
                </span>
                <span className="text-xs font-medium text-white/40 mt-1">
                  {BUDGET_LABELS[budget].range}
                </span>
              </button>
            ))}
          </div>
        </div>

      {/* Divider */}
      <div className="relative pt-4 pb-2">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-white/[0.05]" />
        </div>
        <div className="relative flex justify-center text-[10px] uppercase tracking-widest font-bold">
          <span className="bg-[#050814] px-4 text-white/30">{t('plan.budget.orPrecise')}</span>
        </div>
      </div>

      {/* Budget personnalisé */}
      <div className="space-y-4">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gold/20 rounded-[1.2rem] blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
          <div className="relative">
            <Input
              id="custom-budget"
              type="number"
              placeholder={t('plan.budget.placeholder')}
              min="0"
              value={data.budgetCustom || ''}
              onChange={(e) => {
                const rawValue = e.target.value;
                if (rawValue === '') {
                  onChange({ budgetCustom: undefined, budgetLevel: undefined });
                  return;
                }
                const parsedValue = parseInt(rawValue);
                if (isNaN(parsedValue) || parsedValue < 0) {
                  return;
                }
                onChange({ budgetCustom: parsedValue, budgetLevel: undefined });
              }}
              className="pl-6 pr-16 h-[64px] text-xl rounded-[1.2rem] bg-[#0e1220]/50 border-white/[0.08] text-white placeholder:text-white/30 focus:border-white/20 focus:bg-[#0f1429] focus-visible:ring-0 shadow-inner transition-all font-bold tracking-wide"
            />
            <span className="absolute right-6 top-1/2 -translate-y-1/2 text-gold font-bold text-xl">
              €
            </span>
          </div>
        </div>

        {/* Toggle total / par personne */}
        <div className="flex items-center justify-center gap-2 rounded-[1.2rem] border border-white/[0.05] p-1.5 bg-[#0e1220]/30 w-fit mx-auto">
          <button
            type="button"
            onClick={() => onChange({ budgetIsPerPerson: false })}
            className={cn(
              'px-5 py-2.5 rounded-xl text-sm font-bold transition-all',
              !data.budgetIsPerPerson
                ? 'bg-gold text-black shadow-md'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            )}
          >
            {t('plan.budget.total')}
          </button>
          <button
            type="button"
            onClick={() => onChange({ budgetIsPerPerson: true })}
            className={cn(
              'px-5 py-2.5 rounded-xl text-sm font-bold transition-all',
              data.budgetIsPerPerson
                ? 'bg-gold text-black shadow-md'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            )}
          >
            {t('plan.budget.perPerson')}
          </button>
        </div>

        {data.budgetCustom && (
          <p className="text-[13px] text-center text-white/50 font-medium">
            {data.budgetIsPerPerson
              ? `${data.budgetCustom}€ × ${data.groupSize || 1} = ${data.budgetCustom * (data.groupSize || 1)}€ total`
              : `${data.budgetCustom}€ total pour ${data.groupSize || 1} personne${(data.groupSize || 1) > 1 ? 's' : ''} (${Math.round(data.budgetCustom / (data.groupSize || 1))}€/pers)`
            }
          </p>
        )}
      </div>

      {/* Préférence repas */}
      <div className="space-y-4 pt-6 border-t border-white/[0.05]">
        <p className="text-center text-[11px] font-bold uppercase tracking-[0.2em] text-white/50 mb-4">{t('plan.budget.mealPreference')}</p>
        <div className="grid grid-cols-2 gap-4">
          {([
            { value: 'auto', label: t('plan.budget.mealAuto'), desc: t('plan.budget.mealAutoDesc'), icon: <Zap className="h-5 w-5" /> },
            { value: 'mostly_cooking', label: t('plan.budget.mealCooking'), desc: t('plan.budget.mealCookingDesc'), icon: <ChefHat className="h-5 w-5" /> },
            { value: 'mostly_restaurants', label: t('plan.budget.mealRestaurants'), desc: t('plan.budget.mealRestaurantsDesc'), icon: <UtensilsCrossed className="h-5 w-5" /> },
            { value: 'balanced', label: t('plan.budget.mealBalanced'), desc: t('plan.budget.mealBalancedDesc'), icon: <Shuffle className="h-5 w-5" /> },
          ] as { value: 'auto' | 'mostly_cooking' | 'mostly_restaurants' | 'balanced'; label: string; desc: string; icon: React.ReactNode }[]).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ mealPreference: option.value })}
              className={cn(
                'flex items-center gap-4 p-4 rounded-[1.2rem] border transition-all text-left duration-300 group',
                (data.mealPreference || 'auto') === option.value
                  ? 'border-gold bg-[#0e1220] shadow-[0_10px_30px_rgba(197,160,89,0.1)] scale-[1.02]'
                  : 'border-white/[0.08] bg-[#0e1220]/50 hover:bg-[#0f1429] hover:border-white/20'
              )}
            >
              <div
                className={cn(
                  'p-3 rounded-2xl shrink-0 transition-colors',
                  (data.mealPreference || 'auto') === option.value
                    ? 'bg-gold text-black shadow-lg shadow-gold/30'
                    : 'bg-white/5 text-white/40 group-hover:text-white/60'
                )}
              >
                {option.icon}
              </div>
              <div>
                <span className={cn(
                  'font-bold text-[14px] transition-colors',
                  (data.mealPreference || 'auto') === option.value ? 'text-white' : 'text-white/70 group-hover:text-white/90'
                )}>
                  {option.label}
                </span>
                <p className="text-[11px] text-white/40 mt-0.5">{option.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
