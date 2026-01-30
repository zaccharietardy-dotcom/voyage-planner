'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { TripPreferences, BudgetLevel, BUDGET_LABELS } from '@/lib/types';
import { Wallet, Coins, CreditCard, Gem } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Quel est votre budget ?</h2>
        <p className="text-muted-foreground">Définissez votre budget total pour le voyage</p>
      </div>

      {/* Niveaux de budget */}
      <div className="space-y-4">
        <Label className="text-base font-medium">Niveau de budget</Label>
        <div className="grid grid-cols-2 gap-4">
          {BUDGET_OPTIONS.map((budget) => (
            <button
              key={budget}
              type="button"
              onClick={() => onChange({ budgetLevel: budget, budgetCustom: undefined })}
              className={cn(
                'flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all',
                'hover:border-primary hover:bg-primary/5',
                data.budgetLevel === budget && !data.budgetCustom
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card'
              )}
            >
              <div
                className={cn(
                  'p-3 rounded-full mb-3',
                  data.budgetLevel === budget && !data.budgetCustom
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                )}
              >
                {BUDGET_ICONS[budget]}
              </div>
              <span className="font-semibold">{BUDGET_LABELS[budget].label}</span>
              <span className="text-sm text-muted-foreground mt-1">
                {BUDGET_LABELS[budget].range}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">ou</span>
        </div>
      </div>

      {/* Budget personnalisé */}
      <div className="space-y-3">
        <Label htmlFor="custom-budget" className="text-base font-medium">
          Budget personnalisé
        </Label>
        <div className="relative">
          <Input
            id="custom-budget"
            type="number"
            placeholder="2000"
            value={data.budgetCustom || ''}
            onChange={(e) => {
              const value = e.target.value ? parseInt(e.target.value) : undefined;
              onChange({ budgetCustom: value, budgetLevel: undefined });
            }}
            className="h-12 text-base pr-12"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
            €
          </span>
        </div>

        {/* Toggle total / par personne */}
        <div className="flex items-center gap-2 rounded-lg border p-1 bg-muted/50 w-fit">
          <button
            type="button"
            onClick={() => onChange({ budgetIsPerPerson: false })}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
              !data.budgetIsPerPerson
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Budget total
          </button>
          <button
            type="button"
            onClick={() => onChange({ budgetIsPerPerson: true })}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
              data.budgetIsPerPerson
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Par personne
          </button>
        </div>

        {data.budgetCustom && (
          <p className="text-sm text-muted-foreground">
            {data.budgetIsPerPerson
              ? `${data.budgetCustom}€ × ${data.groupSize || 1} = ${data.budgetCustom * (data.groupSize || 1)}€ total`
              : `${data.budgetCustom}€ total pour ${data.groupSize || 1} personne${(data.groupSize || 1) > 1 ? 's' : ''} (${Math.round(data.budgetCustom / (data.groupSize || 1))}€/pers)`
            }
          </p>
        )}
        {!data.budgetCustom && (
          <p className="text-sm text-muted-foreground">
            Budget {data.budgetIsPerPerson ? 'par personne' : 'total'} pour le voyage
          </p>
        )}
      </div>
    </div>
  );
}
