import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';

const FREE_MONTHLY_LIMIT = 2;

/**
 * Lightweight pre-check before trip generation.
 * Returns { allowed, reason, action } without consuming any quota.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({
        allowed: false,
        reason: 'Connectez-vous pour générer votre premier voyage',
        action: 'login',
      });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, subscription_ends_at, extra_trips')
      .eq('id', user.id)
      .single();

    const entitlements = await fetchEntitlementsForUser(supabase, user.id);
    const billingState = deriveBillingState(profile, entitlements);

    if (billingState.status === 'pro') {
      return NextResponse.json({ allowed: true });
    }

    // Check monthly quota for free users
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .gte('created_at', startOfMonth.toISOString());

    const totalAllowed = FREE_MONTHLY_LIMIT + (profile?.extra_trips || 0);

    if (count !== null && count >= totalAllowed) {
      return NextResponse.json({
        allowed: false,
        reason: `Vous avez atteint votre limite de ${totalAllowed} voyage${totalAllowed > 1 ? 's' : ''} gratuit${totalAllowed > 1 ? 's' : ''} ce mois-ci`,
        action: 'upgrade',
        used: count,
        limit: totalAllowed,
      });
    }

    return NextResponse.json({
      allowed: true,
      remaining: totalAllowed - (count || 0),
    });
  } catch (error) {
    console.error('[preflight] Error:', error);
    // Fail open — don't block generation if preflight fails
    return NextResponse.json({ allowed: true });
  }
}
