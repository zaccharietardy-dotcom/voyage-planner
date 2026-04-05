import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { Expense, ExpenseSplit, MemberBalance, SettlementSuggestion, Settlement, ExpenseCategory, SplitMethod } from '@/lib/types/expenses';

interface TripMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

export function useExpenses(tripId: string) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch trip members (owner + editors/viewers)
      const { data: memberRows } = await supabase
        .from('trip_members')
        .select('user_id, profiles!inner(display_name, avatar_url)')
        .eq('trip_id', tripId);

      // Also fetch trip owner
      const { data: tripRow } = await supabase
        .from('trips')
        .select('owner_id, profiles!inner(display_name, avatar_url)')
        .eq('id', tripId)
        .single();

      const memberMap = new Map<string, TripMember>();
      if (tripRow) {
        const p = (tripRow as any).profiles;
        memberMap.set(tripRow.owner_id, {
          userId: tripRow.owner_id,
          displayName: p?.display_name || 'Organisateur',
          avatarUrl: p?.avatar_url || null,
        });
      }
      for (const m of (memberRows ?? [])) {
        const p = (m as any).profiles;
        memberMap.set(m.user_id, {
          userId: m.user_id,
          displayName: p?.display_name || 'Membre',
          avatarUrl: p?.avatar_url || null,
        });
      }
      setMembers(Array.from(memberMap.values()));

      // Fetch expenses with splits
      const { data: expenseRows } = await supabase
        .from('expenses')
        .select('*, expense_splits(*)')
        .eq('trip_id', tripId)
        .order('date', { ascending: false });

      const formatted: Expense[] = (expenseRows ?? []).map((e: any) => {
        const payer = memberMap.get(e.payer_id);
        return {
          id: e.id,
          tripId: e.trip_id,
          title: e.title,
          amount: parseFloat(e.amount),
          currency: e.currency || 'EUR',
          category: e.category as ExpenseCategory,
          date: e.date,
          notes: e.notes,
          payerId: e.payer_id,
          payerName: payer?.displayName || 'Inconnu',
          payerAvatar: payer?.avatarUrl || null,
          splitMethod: e.split_method as SplitMethod,
          splits: (e.expense_splits ?? []).map((s: any) => {
            const member = memberMap.get(s.user_id);
            return {
              id: s.id,
              userId: s.user_id,
              displayName: member?.displayName || 'Membre',
              avatarUrl: member?.avatarUrl || null,
              amount: parseFloat(s.amount),
            };
          }),
          createdBy: e.created_by,
          createdAt: e.created_at,
        };
      });
      setExpenses(formatted);

      // Fetch settlements
      const { data: settlementRows } = await supabase
        .from('settlements')
        .select('*')
        .eq('trip_id', tripId)
        .order('settled_at', { ascending: false });

      const formattedSettlements: Settlement[] = (settlementRows ?? []).map((s: any) => ({
        id: s.id,
        tripId: s.trip_id,
        fromUserId: s.from_user_id,
        fromName: memberMap.get(s.from_user_id)?.displayName || 'Membre',
        toUserId: s.to_user_id,
        toName: memberMap.get(s.to_user_id)?.displayName || 'Membre',
        amount: parseFloat(s.amount),
        settledAt: s.settled_at,
      }));
      setSettlements(formattedSettlements);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  }, [tripId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addExpense = useCallback(async (data: {
    title: string;
    amount: number;
    category: ExpenseCategory;
    date: string;
    notes?: string;
    payerId: string;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Insert expense
    const { data: expense, error } = await supabase
      .from('expenses')
      .insert({
        trip_id: tripId,
        title: data.title,
        amount: data.amount,
        category: data.category,
        date: data.date,
        notes: data.notes,
        payer_id: data.payerId,
        split_method: 'equal',
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !expense) return;

    // Equal split among all members
    const splitAmount = Math.round((data.amount / members.length) * 100) / 100;
    const splits = members.map((m, i) => ({
      expense_id: expense.id,
      user_id: m.userId,
      amount: i === members.length - 1
        ? Math.round((data.amount - splitAmount * (members.length - 1)) * 100) / 100
        : splitAmount,
    }));

    await supabase.from('expense_splits').insert(splits);
    await fetchAll();
  }, [tripId, members, fetchAll]);

  const deleteExpense = useCallback(async (expenseId: string) => {
    await supabase.from('expenses').delete().eq('id', expenseId);
    await fetchAll();
  }, [fetchAll]);

  const addSettlement = useCallback(async (fromUserId: string, toUserId: string, amount: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('settlements').insert({
      trip_id: tripId,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount,
      created_by: user.id,
    });
    await fetchAll();
  }, [tripId, fetchAll]);

  // Calculate balances
  const balances: MemberBalance[] = members.map((m) => {
    let totalPaid = 0;
    let totalOwed = 0;
    for (const exp of expenses) {
      if (exp.payerId === m.userId) totalPaid += exp.amount;
      const split = exp.splits.find((s) => s.userId === m.userId);
      if (split) totalOwed += split.amount;
    }
    // Adjust for settlements
    for (const s of settlements) {
      if (s.fromUserId === m.userId) totalPaid += s.amount;
      if (s.toUserId === m.userId) totalOwed += s.amount;
    }
    return {
      ...m,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalOwed: Math.round(totalOwed * 100) / 100,
      netBalance: Math.round((totalPaid - totalOwed) * 100) / 100,
    };
  });

  // Settlement suggestions
  const suggestions: SettlementSuggestion[] = [];
  const debtors = balances.filter((b) => b.netBalance < -0.01).map((b) => ({ ...b, remaining: Math.abs(b.netBalance) }));
  const creditors = balances.filter((b) => b.netBalance > 0.01).map((b) => ({ ...b, remaining: b.netBalance }));
  debtors.sort((a, b) => b.remaining - a.remaining);
  creditors.sort((a, b) => b.remaining - a.remaining);

  for (const d of debtors) {
    for (const c of creditors) {
      if (d.remaining < 0.01 || c.remaining < 0.01) continue;
      const amount = Math.round(Math.min(d.remaining, c.remaining) * 100) / 100;
      suggestions.push({
        fromUserId: d.userId,
        fromName: d.displayName,
        toUserId: c.userId,
        toName: c.displayName,
        amount,
      });
      d.remaining -= amount;
      c.remaining -= amount;
    }
  }

  return {
    expenses,
    members,
    balances,
    suggestions,
    settlements,
    isLoading,
    addExpense,
    deleteExpense,
    addSettlement,
    refetch: fetchAll,
  };
}
