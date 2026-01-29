'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import type { SplitMethod } from '@/lib/types/expenses';

interface Participant {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

interface SplitEntry {
  userId: string;
  amount: number;
  shareValue?: number;
  included: boolean;
}

interface SplitMethodSelectorProps {
  totalAmount: number;
  participants: Participant[];
  splitMethod: SplitMethod;
  onSplitMethodChange: (method: SplitMethod) => void;
  onSplitsChange: (splits: { userId: string; amount: number; shareValue?: number }[]) => void;
}

export function SplitMethodSelector({
  totalAmount,
  participants,
  splitMethod,
  onSplitMethodChange,
  onSplitsChange,
}: SplitMethodSelectorProps) {
  const [entries, setEntries] = useState<SplitEntry[]>(() =>
    participants.map((p) => ({ userId: p.userId, amount: 0, shareValue: 1, included: true }))
  );

  useEffect(() => {
    // Reset entries when participants change
    setEntries(
      participants.map((p) => {
        const existing = entries.find((e) => e.userId === p.userId);
        return existing || { userId: p.userId, amount: 0, shareValue: 1, included: true };
      })
    );
  }, [participants.length]);

  useEffect(() => {
    const included = entries.filter((e) => e.included);
    if (included.length === 0) return;

    let splits: { userId: string; amount: number; shareValue?: number }[];

    switch (splitMethod) {
      case 'equal': {
        const perPerson = Math.round((totalAmount / included.length) * 100) / 100;
        splits = included.map((e) => ({ userId: e.userId, amount: perPerson }));
        // Fix rounding
        const diff = Math.round((totalAmount - perPerson * included.length) * 100) / 100;
        if (splits.length > 0 && diff !== 0) {
          splits[0].amount = Math.round((splits[0].amount + diff) * 100) / 100;
        }
        break;
      }
      case 'shares': {
        const totalShares = included.reduce((sum, e) => sum + (e.shareValue || 1), 0);
        splits = included.map((e) => ({
          userId: e.userId,
          amount: Math.round((totalAmount * (e.shareValue || 1) / totalShares) * 100) / 100,
          shareValue: e.shareValue || 1,
        }));
        break;
      }
      case 'percentage': {
        splits = included.map((e) => ({
          userId: e.userId,
          amount: Math.round((totalAmount * (e.shareValue || 0) / 100) * 100) / 100,
          shareValue: e.shareValue || 0,
        }));
        break;
      }
      case 'amounts': {
        splits = included.map((e) => ({
          userId: e.userId,
          amount: e.amount,
          shareValue: e.amount,
        }));
        break;
      }
      default:
        splits = [];
    }

    onSplitsChange(splits);
  }, [entries, splitMethod, totalAmount]);

  const toggleParticipant = (userId: string) => {
    setEntries((prev) => prev.map((e) => (e.userId === userId ? { ...e, included: !e.included } : e)));
  };

  const updateShareValue = (userId: string, value: number) => {
    setEntries((prev) => prev.map((e) => (e.userId === userId ? { ...e, shareValue: value } : e)));
  };

  const updateAmount = (userId: string, value: number) => {
    setEntries((prev) => prev.map((e) => (e.userId === userId ? { ...e, amount: value } : e)));
  };

  const included = entries.filter((e) => e.included);

  return (
    <div className="space-y-3">
      <div>
        <Label>Répartition</Label>
        <Select value={splitMethod} onValueChange={(v) => onSplitMethodChange(v as SplitMethod)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="equal">Parts égales</SelectItem>
            <SelectItem value="amounts">Montants personnalisés</SelectItem>
            <SelectItem value="shares">Par parts</SelectItem>
            <SelectItem value="percentage">Par pourcentage</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Participants</Label>
        {participants.map((p) => {
          const entry = entries.find((e) => e.userId === p.userId);
          if (!entry) return null;

          return (
            <div key={p.userId} className="flex items-center gap-2">
              <Checkbox
                checked={entry.included}
                onCheckedChange={() => toggleParticipant(p.userId)}
              />
              <span className="text-sm flex-1 truncate">{p.displayName}</span>

              {entry.included && splitMethod === 'equal' && (
                <span className="text-sm text-muted-foreground">
                  {(totalAmount / included.length).toFixed(2)} €
                </span>
              )}

              {entry.included && splitMethod === 'shares' && (
                <Input
                  type="number"
                  min={1}
                  className="w-20 h-8 text-sm"
                  value={entry.shareValue || 1}
                  onChange={(e) => updateShareValue(p.userId, Number(e.target.value) || 1)}
                />
              )}

              {entry.included && splitMethod === 'percentage' && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="w-20 h-8 text-sm"
                    value={entry.shareValue || 0}
                    onChange={(e) => updateShareValue(p.userId, Number(e.target.value) || 0)}
                  />
                  <span className="text-sm">%</span>
                </div>
              )}

              {entry.included && splitMethod === 'amounts' && (
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    className="w-24 h-8 text-sm"
                    value={entry.amount || 0}
                    onChange={(e) => updateAmount(p.userId, Number(e.target.value) || 0)}
                  />
                  <span className="text-sm">€</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {splitMethod === 'percentage' && (
        <p className="text-xs text-muted-foreground">
          Total : {included.reduce((sum, e) => sum + (e.shareValue || 0), 0)}%
          {included.reduce((sum, e) => sum + (e.shareValue || 0), 0) !== 100 && (
            <span className="text-destructive ml-1">(doit être 100%)</span>
          )}
        </p>
      )}

      {splitMethod === 'amounts' && (
        <p className="text-xs text-muted-foreground">
          Total : {included.reduce((sum, e) => sum + e.amount, 0).toFixed(2)} € / {totalAmount.toFixed(2)} €
          {Math.abs(included.reduce((sum, e) => sum + e.amount, 0) - totalAmount) > 0.01 && (
            <span className="text-destructive ml-1">(ne correspond pas au montant)</span>
          )}
        </p>
      )}
    </div>
  );
}
