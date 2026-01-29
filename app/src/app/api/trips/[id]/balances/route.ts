import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { calculateBalances, optimizeSettlements } from '@/lib/services/settlementCalculator';

// GET /api/trips/[id]/balances
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

    // Check membership or ownership
    const { data: member } = await supabase
      .from('trip_members')
      .select('role')
      .eq('trip_id', id)
      .eq('user_id', user.id)
      .single();

    if (!member) {
      const { data: trip } = await supabase
        .from('trips')
        .select('owner_id')
        .eq('id', id)
        .eq('owner_id', user.id)
        .single();
      if (!trip) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
      }
    }

    // Fetch members from trip_members
    const { data: members } = await supabase
      .from('trip_members')
      .select('user_id, profiles:user_id (id, display_name, avatar_url)')
      .eq('trip_id', id);

    let memberInfos = (members || []).map((m: any) => ({
      userId: m.user_id,
      displayName: m.profiles?.display_name || 'Utilisateur',
      avatarUrl: m.profiles?.avatar_url || null,
    }));

    // Solo mode: if no members, use current user
    if (memberInfos.length === 0) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .eq('id', user.id)
        .single();
      memberInfos = [{
        userId: user.id,
        displayName: profile?.display_name || 'Moi',
        avatarUrl: profile?.avatar_url || null,
      }];
    }

    // Fetch expenses with splits
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, amount, payer_id, expense_splits (user_id, amount)')
      .eq('trip_id', id);

    const formattedExpenses = (expenses || []).map((e: any) => ({
      id: e.id,
      tripId: id,
      title: '',
      amount: Number(e.amount),
      currency: 'EUR',
      category: 'other' as const,
      date: '',
      payerId: e.payer_id,
      payerName: '',
      payerAvatar: null,
      splitMethod: 'equal' as const,
      splits: (e.expense_splits || []).map((s: any) => ({
        id: '',
        userId: s.user_id,
        displayName: '',
        avatarUrl: null,
        amount: Number(s.amount),
      })),
      createdBy: '',
      createdAt: '',
    }));

    // Fetch existing settlements
    const { data: settlements } = await supabase
      .from('settlements')
      .select('from_user_id, to_user_id, amount')
      .eq('trip_id', id);

    const balances = calculateBalances(formattedExpenses, memberInfos);

    // Adjust balances for existing settlements
    for (const s of settlements || []) {
      const from = balances.find((b) => b.userId === s.from_user_id);
      const to = balances.find((b) => b.userId === s.to_user_id);
      if (from && to) {
        from.netBalance += Number(s.amount);
        to.netBalance -= Number(s.amount);
      }
    }

    const suggestions = optimizeSettlements(balances);

    return NextResponse.json({ balances, suggestions });
  } catch (error) {
    console.error('Error calculating balances:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
