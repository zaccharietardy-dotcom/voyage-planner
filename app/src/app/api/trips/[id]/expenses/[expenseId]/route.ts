import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// PATCH /api/trips/[id]/expenses/[expenseId]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  try {
    const { id, expenseId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Verify expense exists and user is creator
    const { data: expense } = await supabase
      .from('expenses')
      .select('id, created_by, trip_id')
      .eq('id', expenseId)
      .eq('trip_id', id)
      .single();

    if (!expense) {
      return NextResponse.json({ error: 'Dépense non trouvée' }, { status: 404 });
    }

    if (expense.created_by !== user.id) {
      return NextResponse.json({ error: 'Seul le créateur peut modifier cette dépense' }, { status: 403 });
    }

    const body = await request.json();
    const { title, amount, currency, category, date, notes, payerId, splitMethod, splits } = body;

    // Update expense
    const updateData: any = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (amount !== undefined) updateData.amount = amount;
    if (currency !== undefined) updateData.currency = currency;
    if (category !== undefined) updateData.category = category;
    if (date !== undefined) updateData.date = date;
    if (notes !== undefined) updateData.notes = notes;
    if (payerId !== undefined) updateData.payer_id = payerId;
    if (splitMethod !== undefined) updateData.split_method = splitMethod;

    const { error: updateError } = await supabase
      .from('expenses')
      .update(updateData)
      .eq('id', expenseId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Update splits if provided
    if (splits) {
      await supabase.from('expense_splits').delete().eq('expense_id', expenseId);
      const splitRows = splits.map((s: any) => ({
        expense_id: expenseId,
        user_id: s.userId,
        amount: s.amount,
        share_value: s.shareValue ?? null,
      }));
      await supabase.from('expense_splits').insert(splitRows);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating expense:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// DELETE /api/trips/[id]/expenses/[expenseId]
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  try {
    const { id, expenseId } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { data: expense } = await supabase
      .from('expenses')
      .select('id, created_by')
      .eq('id', expenseId)
      .eq('trip_id', id)
      .single();

    if (!expense) {
      return NextResponse.json({ error: 'Dépense non trouvée' }, { status: 404 });
    }

    if (expense.created_by !== user.id) {
      return NextResponse.json({ error: 'Seul le créateur peut supprimer cette dépense' }, { status: 403 });
    }

    const { error } = await supabase.from('expenses').delete().eq('id', expenseId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting expense:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
