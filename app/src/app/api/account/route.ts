import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET — export all user data as JSON (GDPR data portability)
export async function GET() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const [profileRes, tripsRes, prefsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('trips').select('*').eq('owner_id', user.id),
      supabase.from('user_preferences').select('*').eq('user_id', user.id).single(),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
      },
      profile: profileRes.data,
      preferences: prefsRes.data,
      trips: tripsRes.data || [],
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="narae-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (error) {
    console.error('[account] Export error:', error);
    return NextResponse.json({ error: 'Erreur export' }, { status: 500 });
  }
}

// DELETE — delete user account and all data (GDPR right to erasure)
export async function DELETE() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const admin = getAdminClient();

    // Delete user data (CASCADE should handle most, but be explicit)
    await Promise.all([
      admin.from('trips').delete().eq('owner_id', user.id),
      admin.from('trip_members').delete().eq('user_id', user.id),
      admin.from('profiles').delete().eq('id', user.id),
    ]);

    // Delete auth user (this is irreversible)
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.error('[account] Delete auth user error:', error);
      return NextResponse.json({ error: 'Erreur suppression' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Compte supprimé définitivement' });
  } catch (error) {
    console.error('[account] Delete error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
