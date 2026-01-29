'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2 } from 'lucide-react';
import { useExpenses } from '@/hooks/useExpenses';
import { AddExpenseDialog } from './AddExpenseDialog';
import { ExpenseList } from './ExpenseList';
import { BalanceOverview } from './BalanceOverview';
import { toast } from 'sonner';

interface Member {
  userId: string;
  profile: { displayName: string; avatarUrl: string | null };
}

interface ExpensesPanelProps {
  tripId: string;
  members: Member[];
  currentUserId: string;
}

export function ExpensesPanel({ tripId, members, currentUserId }: ExpensesPanelProps) {
  const {
    expenses,
    balances,
    suggestions,
    settlements,
    isLoading,
    addExpense,
    deleteExpense,
    addSettlement,
  } = useExpenses(tripId);

  const handleDelete = async (id: string) => {
    try {
      await deleteExpense(id);
      toast.success('Dépense supprimée');
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Dépenses partagées</h3>
        <AddExpenseDialog
          members={members}
          currentUserId={currentUserId}
          onAdd={addExpense}
        />
      </div>

      <Tabs defaultValue="expenses">
        <TabsList className="w-full">
          <TabsTrigger value="expenses" className="flex-1">
            Dépenses ({expenses.length})
          </TabsTrigger>
          <TabsTrigger value="balances" className="flex-1">
            Soldes
          </TabsTrigger>
        </TabsList>
        <TabsContent value="expenses" className="mt-3">
          <ExpenseList
            expenses={expenses}
            currentUserId={currentUserId}
            onDelete={handleDelete}
          />
        </TabsContent>
        <TabsContent value="balances" className="mt-3">
          <BalanceOverview
            balances={balances}
            suggestions={suggestions}
            settlements={settlements}
            onSettle={addSettlement}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
