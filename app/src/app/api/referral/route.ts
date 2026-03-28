import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET — get current user's referral code + stats
export async function GET() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('referral_code, extra_trips')
      .eq('id', user.id)
      .single();

    // Count successful referrals
    const { count } = await (supabase as any)
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', user.id);

    return NextResponse.json({
      code: profile?.referral_code || null,
      referralCount: count || 0,
      extraTrips: profile?.extra_trips || 0,
    });
  } catch (error) {
    console.error('[referral] GET error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// POST — apply a referral code (called after signup)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

    const { code } = await request.json();
    if (!code || typeof code !== 'string' || code.length < 4) {
      return NextResponse.json({ error: 'Code invalide' }, { status: 400 });
    }

    const admin = getServiceClient();

    // Check if user already used a referral
    const { data: existingRef } = await admin
      .from('referrals')
      .select('id')
      .eq('referred_id', user.id)
      .single();

    if (existingRef) {
      return NextResponse.json({ error: 'Vous avez déjà utilisé un code parrainage' }, { status: 400 });
    }

    // Find referrer by code
    const { data: referrer } = await admin
      .from('profiles')
      .select('id, extra_trips')
      .eq('referral_code', code.toUpperCase().trim())
      .single();

    if (!referrer) {
      return NextResponse.json({ error: 'Code parrainage introuvable' }, { status: 404 });
    }

    if (referrer.id === user.id) {
      return NextResponse.json({ error: 'Vous ne pouvez pas utiliser votre propre code' }, { status: 400 });
    }

    // Record referral
    await admin.from('referrals').insert({
      referrer_id: referrer.id,
      referred_id: user.id,
      rewarded: true,
    });

    // Credit both: +1 extra trip each
    await Promise.all([
      admin.from('profiles').update({ extra_trips: (referrer.extra_trips || 0) + 1 }).eq('id', referrer.id),
      admin.from('profiles').update({ referred_by: referrer.id }).eq('id', user.id),
      admin.from('profiles')
        .select('extra_trips')
        .eq('id', user.id)
        .single()
        .then(({ data }: { data: { extra_trips?: number } | null }) =>
          admin.from('profiles').update({ extra_trips: (data?.extra_trips || 0) + 1 }).eq('id', user.id)
        ),
    ]);

    return NextResponse.json({ success: true, message: 'Code parrainage appliqué ! +1 voyage gratuit pour vous et votre parrain.' });
  } catch (error) {
    console.error('[referral] POST error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
