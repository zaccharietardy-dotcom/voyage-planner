'use client';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { SettlementCard } from './SettlementCard';
import type { MemberBalance, SettlementSuggestion, Settlement } from '@/lib/types/expenses';

interface BalanceOverviewProps {
  balances: MemberBalance[];
  suggestions: SettlementSuggestion[];
  settlements: Settlement[];
  onSettle: (fromUserId: string, toUserId: string, amount: number) => Promise<void>;
}

export function BalanceOverview({ balances, suggestions, settlements, onSettle }: BalanceOverviewProps) {
  if (balances.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">Aucun solde à afficher</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Balances */}
      <div>
        <h4 className="text-sm font-medium mb-2">Soldes</h4>
        <div className="space-y-1.5">
          {balances.map((b) => (
            <div key={b.userId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50">
              <span className="text-sm truncate">{b.displayName}</span>
              <span
                className={cn(
                  'text-sm font-medium',
                  b.netBalance > 0.01 && 'text-green-600',
                  b.netBalance < -0.01 && 'text-red-600',
                  Math.abs(b.netBalance) <= 0.01 && 'text-muted-foreground'
                )}
              >
                {b.netBalance > 0 ? '+' : ''}{b.netBalance.toFixed(2)} €
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Settlement suggestions */}
      {suggestions.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Remboursements suggérés</h4>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <SettlementCard key={i} suggestion={s} onSettle={onSettle} />
            ))}
          </div>
        </div>
      )}

      {/* Past settlements */}
      {settlements.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Remboursements effectués</h4>
          <div className="space-y-1.5">
            {settlements.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/20">
                <span className="text-xs text-muted-foreground">
                  {s.fromName} → {s.toName}
                </span>
                <span className="text-xs font-medium text-green-600">{s.amount.toFixed(2)} €</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
