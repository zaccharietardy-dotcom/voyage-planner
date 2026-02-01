import { createRouteHandlerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function generateShareCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// POST /api/trips/[id]/clone - Clone a trip with new dates/group
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { start_date, end_date, group_size, budget_level } = await request.json();
    if (!start_date) return NextResponse.json({ error: 'start_date requis' }, { status: 400 });

    // Fetch source trip
    const { data: sourceTrip, error: fetchError } = await supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !sourceTrip) {
      return NextResponse.json({ error: 'Voyage source non trouvé' }, { status: 404 });
    }

    // Verify access (public or member)
    if (sourceTrip.visibility === 'private' && sourceTrip.owner_id !== user.id) {
      const { data: member } = await supabase
        .from('trip_members')
        .select('id')
        .eq('trip_id', id)
        .eq('user_id', user.id)
        .single();
      if (!member) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
    }

    // Deep clone trip data
    const sourceData = typeof sourceTrip.data === 'object' ? { ...sourceTrip.data as any } : {};
    const sourcePrefs = typeof sourceTrip.preferences === 'object' ? { ...sourceTrip.preferences as any } : {};

    // Calculate date offset
    const origStart = new Date(sourceTrip.start_date);
    const newStart = new Date(start_date);
    const dayOffset = Math.round((newStart.getTime() - origStart.getTime()) / (1000 * 60 * 60 * 24));

    // Update preferences
    sourcePrefs.startDate = start_date;
    if (group_size) sourcePrefs.groupSize = group_size;
    if (budget_level) sourcePrefs.budgetLevel = budget_level;

    // Shift dates in days
    if (sourceData.days && Array.isArray(sourceData.days)) {
      sourceData.days = sourceData.days.map((day: any) => {
        if (day.date) {
          const d = new Date(day.date);
          d.setDate(d.getDate() + dayOffset);
          day.date = d.toISOString().split('T')[0];
        }
        return day;
      });
    }

    // Update group size in data
    if (group_size) {
      sourceData.preferences = { ...sourceData.preferences, groupSize: group_size };
    }

    // Calculate new end date
    const durationDays = sourceTrip.duration_days || 7;
    const endDateObj = new Date(start_date);
    endDateObj.setDate(endDateObj.getDate() + durationDays - 1);
    const endDateStr = end_date || endDateObj.toISOString().split('T')[0];

    // Create cloned trip
    const { data: clonedTrip, error: cloneError } = await supabase
      .from('trips')
      .insert({
        owner_id: user.id,
        name: `${sourceTrip.name} (copie)`,
        title: `${sourceTrip.title || sourceTrip.name} (copie)`,
        destination: sourceTrip.destination,
        start_date: start_date,
        end_date: endDateStr,
        duration_days: durationDays,
        preferences: sourcePrefs,
        data: sourceData,
        share_code: generateShareCode(),
        visibility: 'private',
        cloned_from: id,
      })
      .select()
      .single();

    if (cloneError) return NextResponse.json({ error: cloneError.message }, { status: 500 });

    // Add as owner member
    await supabase.from('trip_members').insert({
      trip_id: clonedTrip.id,
      user_id: user.id,
      role: 'owner',
    });

    // Increment clone count on source
    try {
      await supabase
        .from('trips')
        .update({ clone_count: ((sourceTrip as any).clone_count || 0) + 1 })
        .eq('id', id);
    } catch { /* ignore */ }

    return NextResponse.json(clonedTrip);
  } catch (error) {
    console.error('Clone error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
