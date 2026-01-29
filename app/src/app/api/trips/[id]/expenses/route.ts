import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

async function verifyAccess(supabase: any, tripId: string, userId: string) {
  // Check trip_members first
  const { data: member } = await supabase
    .from('trip_members')
    .select('role')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .single();
  if (member) return member;

  // Fallback: check if user is trip owner (solo mode)
  const { data: trip } = await supabase
    .from('trips')
    .select('owner_id')
    .eq('id', tripId)
    .eq('owner_id', userId)
    .single();
  if (trip) return { role: 'owner' };

  return null;
}

// GET /api/trips/[id]/expenses
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const member = await verifyAccess(supabase, id, user.id);
    if (!member) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Fetch expenses with payer profile
    const { data: expenses, error } = await supabase
      .from('expenses')
      .select(`
        *,
        payer:payer_id (id, display_name, avatar_url),
        expense_splits (id, user_id, amount, share_value)
      `)
      .eq('trip_id', id)
      .order('date', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch profiles for split users
    const userIds = new Set<string>();
    for (const exp of expenses || []) {
      for (const split of exp.expense_splits || []) {
        userIds.add(split.user_id);
      }
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url')
      .in('id', Array.from(userIds));

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    const formatted = (expenses || []).map((e: any) => ({
      id: e.id,
      tripId: e.trip_id,
      title: e.title,
      amount: Number(e.amount),
      currency: e.currency,
      category: e.category,
      date: e.date,
      notes: e.notes,
      payerId: e.payer_id,
      payerName: e.payer?.display_name || 'Utilisateur',
      payerAvatar: e.payer?.avatar_url || null,
      splitMethod: e.split_method,
      splits: (e.expense_splits || []).map((s: any) => {
        const profile = profileMap.get(s.user_id);
        return {
          id: s.id,
          userId: s.user_id,
          displayName: profile?.display_name || 'Utilisateur',
          avatarUrl: profile?.avatar_url || null,
          amount: Number(s.amount),
          shareValue: s.share_value ? Number(s.share_value) : undefined,
        };
      }),
      createdBy: e.created_by,
      createdAt: e.created_at,
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST /api/trips/[id]/expenses
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const member = await verifyAccess(supabase, id, user.id);
    if (!member) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    const body = await request.json();
    const { title, amount, currency, category, date, notes, payerId, splitMethod, splits } = body;

    if (!title || !amount || !date || !payerId || !splits?.length) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
    }

    // Insert expense
    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        trip_id: id,
        title,
        amount,
        currency: currency || 'EUR',
        category: category || 'other',
        date,
        notes: notes || null,
        payer_id: payerId,
        split_method: splitMethod || 'equal',
        created_by: user.id,
      })
      .select()
      .single();

    if (expenseError) {
      return NextResponse.json({ error: expenseError.message }, { status: 500 });
    }

    // Insert splits
    const splitRows = splits.map((s: any) => ({
      expense_id: expense.id,
      user_id: s.userId,
      amount: s.amount,
      share_value: s.shareValue ?? null,
    }));

    const { error: splitsError } = await supabase
      .from('expense_splits')
      .insert(splitRows);

    if (splitsError) {
      // Rollback expense
      await supabase.from('expenses').delete().eq('id', expense.id);
      return NextResponse.json({ error: splitsError.message }, { status: 500 });
    }

    return NextResponse.json({ id: expense.id }, { status: 201 });
  } catch (error) {
    console.error('Error creating expense:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
