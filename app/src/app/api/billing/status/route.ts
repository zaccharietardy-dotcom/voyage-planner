import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, subscription_ends_at')
      .eq('id', user.id)
      .single();

    return NextResponse.json({
      status: profile?.subscription_status || 'free',
      expiresAt: profile?.subscription_ends_at || null,
    });
  } catch (error) {
    console.error('Error fetching subscription status:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
