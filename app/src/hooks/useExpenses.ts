'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import type { Expense, MemberBalance, SettlementSuggestion, Settlement } from '@/lib/types/expenses';

interface UseExpensesResult {
  expenses: Expense[];
  balances: MemberBalance[];
  suggestions: SettlementSuggestion[];
  settlements: Settlement[];
  isLoading: boolean;
  error: string | null;
  addExpense: (data: any) => Promise<void>;
  updateExpense: (expenseId: string, data: any) => Promise<void>;
  deleteExpense: (expenseId: string) => Promise<void>;
  addSettlement: (fromUserId: string, toUserId: string, amount: number) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useExpenses(tripId: string): UseExpensesResult {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<MemberBalance[]>([]);
  const [suggestions, setSuggestions] = useState<SettlementSuggestion[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = getSupabaseClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchExpenses = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/expenses`);
      if (res.ok) {
        const data = await res.json();
        setExpenses(data);
      }
    } catch (err) {
      console.error('Error fetching expenses:', err);
    }
  }, [tripId]);

  const fetchBalances = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/balances`);
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || []);
        setSuggestions(data.suggestions || []);
      }
    } catch (err) {
      console.error('Error fetching balances:', err);
    }
  }, [tripId]);

  const fetchSettlements = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/settlements`);
      if (res.ok) {
        const data = await res.json();
        setSettlements(data);
      }
    } catch (err) {
      console.error('Error fetching settlements:', err);
    }
  }, [tripId]);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([fetchExpenses(), fetchBalances(), fetchSettlements()]);
    } catch {
      setError('Erreur de chargement des dépenses');
    } finally {
      setIsLoading(false);
    }
  }, [fetchExpenses, fetchBalances, fetchSettlements]);

  // Realtime subscriptions
  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel(`expenses-${tripId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${tripId}` },
        () => {
          fetchExpenses();
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements', filter: `trip_id=eq.${tripId}` },
        () => {
          fetchSettlements();
          fetchBalances();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [tripId, supabase, fetchAll]);

  const addExpense = useCallback(async (data: any) => {
    const res = await fetch(`/api/trips/${tripId}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erreur');
    }
    await fetchExpenses();
    await fetchBalances();
  }, [tripId, fetchExpenses, fetchBalances]);

  const updateExpense = useCallback(async (expenseId: string, data: any) => {
    const res = await fetch(`/api/trips/${tripId}/expenses/${expenseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erreur');
    }
    await fetchExpenses();
    await fetchBalances();
  }, [tripId, fetchExpenses, fetchBalances]);

  const deleteExpense = useCallback(async (expenseId: string) => {
    const res = await fetch(`/api/trips/${tripId}/expenses/${expenseId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erreur');
    }
    await fetchExpenses();
    await fetchBalances();
  }, [tripId, fetchExpenses, fetchBalances]);

  const addSettlement = useCallback(async (fromUserId: string, toUserId: string, amount: number) => {
    const res = await fetch(`/api/trips/${tripId}/settlements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromUserId, toUserId, amount }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Erreur');
    }
    await fetchSettlements();
    await fetchBalances();
  }, [tripId, fetchSettlements, fetchBalances]);

  return {
    expenses,
    balances,
    suggestions,
    settlements,
    isLoading,
    error,
    addExpense,
    updateExpense,
    deleteExpense,
    addSettlement,
    refetch: fetchAll,
  };
}
