import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';

const FREE_LIFETIME_LIMIT = 1;

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

    // Check lifetime quota for free users (1 free trip ever + extra_trips from purchases)
    const { count } = await supabase
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', user.id);

    const totalAllowed = FREE_LIFETIME_LIMIT + (profile?.extra_trips || 0);

    if (count !== null && count >= totalAllowed) {
      return NextResponse.json({
        allowed: false,
        reason: 'Votre voyage gratuit a été utilisé. Achetez un voyage ou passez à Pro pour des voyages illimités.',
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
