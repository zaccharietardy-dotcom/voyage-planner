import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { token, platform } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token requis' }, { status: 400 });
    }

    // Upsert device token (avoid duplicates)
    // Table created via migration — cast needed until types are regenerated
    const { error } = await (supabase as any)
      .from('push_tokens')
      .upsert(
        {
          user_id: user.id,
          token,
          platform: platform || 'web',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'token' }
      );

    if (error) {
      console.error('[register-device] Upsert error:', error);
      return NextResponse.json({ error: 'Erreur enregistrement' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[register-device] Error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
