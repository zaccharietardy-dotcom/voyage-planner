'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check } from 'lucide-react';
import type { SettlementSuggestion } from '@/lib/types/expenses';
import { toast } from 'sonner';

interface SettlementCardProps {
  suggestion: SettlementSuggestion;
  onSettle: (fromUserId: string, toUserId: string, amount: number) => Promise<void>;
}

export function SettlementCard({ suggestion, onSettle }: SettlementCardProps) {
  const [settling, setSettling] = useState(false);

  const handleSettle = async () => {
    setSettling(true);
    try {
      await onSettle(suggestion.fromUserId, suggestion.toUserId, suggestion.amount);
      toast.success('Remboursement enregistré');
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setSettling(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border">
      <div className="flex items-center gap-1.5 text-sm min-w-0">
        <span className="truncate">{suggestion.fromName}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{suggestion.toName}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-medium">{suggestion.amount.toFixed(2)} €</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={handleSettle}
          disabled={settling}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
