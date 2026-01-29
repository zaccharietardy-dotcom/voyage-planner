'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { EXPENSE_CATEGORIES, type Expense } from '@/lib/types/expenses';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ExpenseCardProps {
  expense: Expense;
  currentUserId: string;
  onDelete?: (id: string) => void;
}

export function ExpenseCard({ expense, currentUserId, onDelete }: ExpenseCardProps) {
  const categoryInfo = EXPENSE_CATEGORIES.find((c) => c.value === expense.category);

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-lg shrink-0">{categoryInfo?.icon || '📦'}</span>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{expense.title}</p>
            <p className="text-xs text-muted-foreground">
              Payé par {expense.payerName} · {format(new Date(expense.date), 'd MMM', { locale: fr })}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {expense.splits.length} participant{expense.splits.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="font-semibold text-sm">{expense.amount.toFixed(2)} €</span>
          {expense.createdBy === currentUserId && onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(expense.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
