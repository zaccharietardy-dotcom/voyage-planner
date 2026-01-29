'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus } from 'lucide-react';
import { EXPENSE_CATEGORIES, type ExpenseCategory, type SplitMethod } from '@/lib/types/expenses';
import { SplitMethodSelector } from './SplitMethodSelector';
import { toast } from 'sonner';

interface Member {
  userId: string;
  profile: { displayName: string; avatarUrl: string | null };
}

interface AddExpenseDialogProps {
  members: Member[];
  currentUserId: string;
  onAdd: (data: any) => Promise<void>;
}

export function AddExpenseDialog({ members, currentUserId, onAdd }: AddExpenseDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('other');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [payerId, setPayerId] = useState(currentUserId);
  const [splitMethod, setSplitMethod] = useState<SplitMethod>('equal');
  const [splits, setSplits] = useState<{ userId: string; amount: number; shareValue?: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const participants = members.map((m) => ({
    userId: m.userId,
    displayName: m.profile.displayName,
    avatarUrl: m.profile.avatarUrl,
  }));

  const handleSubmit = async () => {
    if (!title.trim() || !amount || !splits.length) {
      toast.error('Remplis tous les champs requis');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('Montant invalide');
      return;
    }

    setSubmitting(true);
    try {
      await onAdd({
        title: title.trim(),
        amount: numAmount,
        category,
        date,
        notes: notes.trim() || undefined,
        payerId,
        splitMethod,
        splits: splits.map((s) => ({
          userId: s.userId,
          amount: s.amount,
          shareValue: s.shareValue,
        })),
      });
      toast.success('Dépense ajoutée');
      setOpen(false);
      // Reset
      setTitle('');
      setAmount('');
      setCategory('other');
      setNotes('');
      setSplitMethod('equal');
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" />
          Ajouter
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvelle dépense</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Titre</Label>
            <Input
              placeholder="Ex: Restaurant, Taxi..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Montant (€)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Catégorie</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.icon} {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Payé par</Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.profile.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <SplitMethodSelector
            totalAmount={parseFloat(amount) || 0}
            participants={participants}
            splitMethod={splitMethod}
            onSplitMethodChange={setSplitMethod}
            onSplitsChange={setSplits}
          />

          <div>
            <Label>Notes (optionnel)</Label>
            <Textarea
              placeholder="Détails supplémentaires..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <Button onClick={handleSubmit} disabled={submitting} className="w-full">
            {submitting ? 'Ajout...' : 'Ajouter la dépense'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
