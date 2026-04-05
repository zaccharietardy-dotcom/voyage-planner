import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Alert, FlatList } from 'react-native';
import {
  Plus, Wallet, ArrowRight, Check, Trash2, DollarSign,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fonts, radius } from '@/lib/theme';
import { useExpenses } from '@/hooks/useExpenses';
import { CATEGORY_LABELS, type ExpenseCategory } from '@/lib/types/expenses';

interface Props {
  tripId: string;
}

type Tab = 'expenses' | 'balances';

const CATEGORIES: ExpenseCategory[] = ['food', 'activities', 'transport', 'accommodation', 'shopping', 'other'];

export function ExpensesPanel({ tripId }: Props) {
  const { expenses, members, balances, suggestions, settlements, isLoading, addExpense, deleteExpense, addSettlement } = useExpenses(tripId);
  const [tab, setTab] = useState<Tab>('expenses');
  const [showAdd, setShowAdd] = useState(false);

  // Add form state
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('food');
  const [notes, setNotes] = useState('');

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  const handleAdd = async () => {
    if (!title.trim() || !amount.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const { data: { user } } = await (await import('@/lib/supabase/client')).supabase.auth.getUser();
    if (!user) return;

    await addExpense({
      title: title.trim(),
      amount: parseFloat(amount),
      category,
      date: new Date().toISOString().split('T')[0],
      notes: notes.trim() || undefined,
      payerId: user.id,
    });

    setTitle('');
    setAmount('');
    setCategory('food');
    setNotes('');
    setShowAdd(false);
  };

  const handleDelete = (expenseId: string, expenseTitle: string) => {
    Alert.alert('Supprimer', `Supprimer "${expenseTitle}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); deleteExpense(expenseId); },
      },
    ]);
  };

  const handleSettle = (fromId: string, fromName: string, toId: string, toName: string, settleAmount: number) => {
    Alert.alert(
      'Confirmer le remboursement',
      `${fromName} a payé ${settleAmount.toFixed(2)}€ à ${toName} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); addSettlement(fromId, toId, settleAmount); },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ padding: 20, gap: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5 }}>
              Total dépenses
            </Text>
            <Text style={{ color: colors.gold, fontSize: 32, fontFamily: fonts.display, marginTop: 4 }}>
              {Math.round(totalExpenses)}€
            </Text>
          </View>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowAdd(true); }}
            style={{
              width: 48, height: 48, borderRadius: 16, backgroundColor: colors.gold,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Plus size={22} color="#000" />
          </Pressable>
        </View>

        {/* Tab pills */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['expenses', 'Dépenses'], ['balances', 'Soldes']] as [Tab, string][]).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => { Haptics.selectionAsync(); setTab(key); }}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                backgroundColor: tab === key ? colors.gold : colors.surface,
                borderWidth: 1, borderColor: tab === key ? colors.gold : colors.borderSubtle,
              }}
            >
              <Text style={{ color: tab === key ? '#000' : colors.textSecondary, fontSize: 13, fontFamily: fonts.sansBold }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === 'expenses' ? (
        <FlatList
          data={expenses}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 20 }}
          ListEmptyComponent={
            <Text style={{ color: colors.textMuted, textAlign: 'center', paddingVertical: 40, fontSize: 14 }}>
              Aucune dépense enregistrée
            </Text>
          }
          renderItem={({ item: expense }) => {
            const cat = CATEGORY_LABELS[expense.category];
            return (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14,
                borderWidth: 1, borderColor: colors.borderSubtle,
              }}>
                <View style={{
                  width: 42, height: 42, borderRadius: 12,
                  backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 20 }}>{cat.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.sansBold }} numberOfLines={1}>
                    {expense.title}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>
                    Payé par {expense.payerName} · {expense.splits.length} pers.
                  </Text>
                </View>
                <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.sansBold }}>
                  {expense.amount.toFixed(2)}€
                </Text>
                <Pressable onPress={() => handleDelete(expense.id, expense.title)}>
                  <Trash2 size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 16, paddingBottom: 20 }}>
          {/* Balances */}
          <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.display }}>Soldes</Text>
          {balances.map((b) => (
            <View key={b.userId} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14,
              borderWidth: 1, borderColor: colors.borderSubtle,
            }}>
              <Avatar url={b.avatarUrl} name={b.displayName} size="sm" />
              <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.sansBold, flex: 1 }}>
                {b.displayName}
              </Text>
              <Text style={{
                fontSize: 15, fontFamily: fonts.sansBold,
                color: b.netBalance > 0.01 ? '#22C55E' : b.netBalance < -0.01 ? '#EF4444' : colors.textMuted,
              }}>
                {b.netBalance > 0 ? '+' : ''}{b.netBalance.toFixed(2)}€
              </Text>
            </View>
          ))}

          {/* Settlement suggestions */}
          {suggestions.length > 0 ? (
            <>
              <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.display, marginTop: 8 }}>Remboursements</Text>
              {suggestions.map((s, i) => (
                <Pressable
                  key={i}
                  onPress={() => handleSettle(s.fromUserId, s.fromName, s.toUserId, s.toName, s.amount)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14,
                    borderWidth: 1, borderColor: colors.borderSubtle,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 13, flex: 1 }}>
                    <Text style={{ fontFamily: fonts.sansBold }}>{s.fromName}</Text>
                    {' → '}
                    <Text style={{ fontFamily: fonts.sansBold }}>{s.toName}</Text>
                  </Text>
                  <Text style={{ color: colors.gold, fontSize: 15, fontFamily: fonts.sansBold }}>
                    {s.amount.toFixed(2)}€
                  </Text>
                  <View style={{
                    width: 32, height: 32, borderRadius: 10,
                    backgroundColor: 'rgba(34,197,94,0.1)', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Check size={16} color="#22C55E" />
                  </View>
                </Pressable>
              ))}
            </>
          ) : null}

          {/* Past settlements */}
          {settlements.length > 0 ? (
            <>
              <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.display, marginTop: 8 }}>Historique</Text>
              {settlements.map((s) => (
                <View key={s.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14,
                  borderWidth: 1, borderColor: colors.borderSubtle, opacity: 0.6,
                }}>
                  <Check size={14} color="#22C55E" />
                  <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1 }}>
                    {s.fromName} → {s.toName}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sansBold }}>
                    {s.amount.toFixed(2)}€
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Add Expense Sheet */}
      <BottomSheet isOpen={showAdd} onClose={() => setShowAdd(false)} height={0.7}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: colors.text, fontSize: 20, fontFamily: fonts.display }}>
            Nouvelle dépense
          </Text>

          {/* Title */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 }}>
              Description
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              style={inputStyle}
              placeholderTextColor={colors.textMuted}
              placeholder="Dîner, musée, taxi..."
            />
          </View>

          {/* Amount */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 }}>
              Montant (€)
            </Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              style={inputStyle}
              placeholderTextColor={colors.textMuted}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />
          </View>

          {/* Category */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 }}>
              Catégorie
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {CATEGORIES.map((cat) => {
                const { label, emoji } = CATEGORY_LABELS[cat];
                return (
                  <Pressable
                    key={cat}
                    onPress={() => { Haptics.selectionAsync(); setCategory(cat); }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                      backgroundColor: category === cat ? colors.gold : colors.surface,
                      borderWidth: 1, borderColor: category === cat ? colors.gold : colors.borderSubtle,
                      flexDirection: 'row', gap: 6, alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>{emoji}</Text>
                    <Text style={{ color: category === cat ? '#000' : colors.textSecondary, fontSize: 12, fontFamily: fonts.sansBold }}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Notes */}
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 }}>
              Notes (optionnel)
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              style={[inputStyle, { minHeight: 60, textAlignVertical: 'top' }]}
              placeholderTextColor={colors.textMuted}
              placeholder="Détails..."
              multiline
            />
          </View>

          <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center' }}>
            Partagé équitablement entre {members.length} membre{members.length > 1 ? 's' : ''}
          </Text>

          {/* Add button */}
          <Pressable onPress={handleAdd} style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16,
          }}>
            <DollarSign size={18} color="#000" />
            <Text style={{ color: '#000', fontSize: 14, fontFamily: fonts.sansBold }}>Ajouter la dépense</Text>
          </Pressable>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const inputStyle = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  paddingHorizontal: 16,
  paddingVertical: 13,
  color: colors.text,
  fontSize: 15,
  fontFamily: 'Inter-Regular',
} as const;
