import type { Expense, MemberBalance, SettlementSuggestion } from '@/lib/types/expenses';

interface MemberInfo {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateBalances(
  expenses: Expense[],
  members: MemberInfo[]
): MemberBalance[] {
  const balanceMap = new Map<string, { paid: number; owed: number }>();

  // Initialize all members
  for (const m of members) {
    balanceMap.set(m.userId, { paid: 0, owed: 0 });
  }

  for (const expense of expenses) {
    // Add what the payer paid
    const payerBalance = balanceMap.get(expense.payerId);
    if (payerBalance) {
      payerBalance.paid += expense.amount;
    }

    // Add what each participant owes
    for (const split of expense.splits) {
      const splitBalance = balanceMap.get(split.userId);
      if (splitBalance) {
        splitBalance.owed += split.amount;
      }
    }
  }

  return members.map((m) => {
    const b = balanceMap.get(m.userId) || { paid: 0, owed: 0 };
    return {
      userId: m.userId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      totalPaid: round2(b.paid),
      totalOwed: round2(b.owed),
      netBalance: round2(b.paid - b.owed),
    };
  });
}

export function optimizeSettlements(
  balances: MemberBalance[]
): SettlementSuggestion[] {
  // Greedy algorithm: match largest debtor with largest creditor
  const debtors = balances
    .filter((b) => b.netBalance < -0.01)
    .map((b) => ({ ...b, remaining: -b.netBalance }))
    .sort((a, b) => b.remaining - a.remaining);

  const creditors = balances
    .filter((b) => b.netBalance > 0.01)
    .map((b) => ({ ...b, remaining: b.netBalance }))
    .sort((a, b) => b.remaining - a.remaining);

  const settlements: SettlementSuggestion[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = round2(Math.min(debtors[i].remaining, creditors[j].remaining));
    if (amount > 0.01) {
      settlements.push({
        fromUserId: debtors[i].userId,
        fromName: debtors[i].displayName,
        toUserId: creditors[j].userId,
        toName: creditors[j].displayName,
        amount,
      });
    }
    debtors[i].remaining = round2(debtors[i].remaining - amount);
    creditors[j].remaining = round2(creditors[j].remaining - amount);
    if (debtors[i].remaining < 0.01) i++;
    if (creditors[j].remaining < 0.01) j++;
  }

  return settlements;
}
