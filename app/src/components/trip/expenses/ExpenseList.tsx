'use client';

import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ExpenseCard } from './ExpenseCard';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from '@/lib/types/expenses';

interface ExpenseListProps {
  expenses: Expense[];
  currentUserId: string;
  onDelete: (id: string) => void;
}

export function ExpenseList({ expenses, currentUserId, onDelete }: ExpenseListProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const filtered = categoryFilter === 'all'
    ? expenses
    : expenses.filter((e) => e.category === categoryFilter);

  const total = filtered.reduce((sum, e) => sum + e.amount, 0);

  if (expenses.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">Aucune dépense pour le moment</p>
        <p className="text-xs mt-1">Ajoute une dépense pour commencer le suivi</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue placeholder="Catégorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes</SelectItem>
            {EXPENSE_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.icon} {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-medium">{total.toFixed(2)} €</span>
      </div>

      <div className="space-y-2">
        {filtered.map((expense) => (
          <ExpenseCard
            key={expense.id}
            expense={expense}
            currentUserId={currentUserId}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
