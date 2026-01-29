export type ExpenseCategory = 'accommodation' | 'food' | 'transport' | 'activities' | 'shopping' | 'other';
export type SplitMethod = 'equal' | 'amounts' | 'shares' | 'percentage';

export interface ExpenseSplit {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  amount: number;
  shareValue?: number;
}

export interface Expense {
  id: string;
  tripId: string;
  title: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  date: string;
  notes?: string;
  payerId: string;
  payerName: string;
  payerAvatar: string | null;
  splitMethod: SplitMethod;
  splits: ExpenseSplit[];
  createdBy: string;
  createdAt: string;
}

export interface MemberBalance {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  totalPaid: number;
  totalOwed: number;
  netBalance: number; // positive = is owed money, negative = owes money
}

export interface SettlementSuggestion {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
}

export interface Settlement {
  id: string;
  tripId: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amount: number;
  settledAt: string;
}

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: 'accommodation', label: 'Hébergement', icon: '🏨' },
  { value: 'food', label: 'Nourriture', icon: '🍽️' },
  { value: 'transport', label: 'Transport', icon: '🚗' },
  { value: 'activities', label: 'Activités', icon: '🎯' },
  { value: 'shopping', label: 'Shopping', icon: '🛍️' },
  { value: 'other', label: 'Autre', icon: '📦' },
];
