export type ExpenseCategory = 'accommodation' | 'food' | 'transport' | 'activities' | 'shopping' | 'other';
export type SplitMethod = 'equal' | 'amounts' | 'shares' | 'percentage';

export interface ExpenseSplit {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  amount: number;
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
  netBalance: number;
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

export const CATEGORY_LABELS: Record<ExpenseCategory, { label: string; emoji: string }> = {
  accommodation: { label: 'Hébergement', emoji: '🏨' },
  food: { label: 'Nourriture', emoji: '🍔' },
  transport: { label: 'Transport', emoji: '🚗' },
  activities: { label: 'Activités', emoji: '🎭' },
  shopping: { label: 'Shopping', emoji: '🛍️' },
  other: { label: 'Autre', emoji: '💰' },
};
