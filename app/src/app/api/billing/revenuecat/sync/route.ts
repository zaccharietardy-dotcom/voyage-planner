import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import {
  deriveBillingState,
  fetchEntitlementsForUser,
  upsertBillingEntitlement,
} from '@/lib/server/billingEntitlements';
import type { Database, Json } from '@/lib/supabase/types';

function getAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface RevenueCatSubscription {
  store?: string;
  expires_date?: string | null;
  original_purchase_transaction_id?: string;
  transaction_id?: string;
}

interface RevenueCatSubscriberPayload {
  subscriber?: {
    subscriptions?: Record<string, RevenueCatSubscription>;
  };
}

function mapStoreToSource(store?: string): 'app_store' | 'play_store' | null {
  const normalized = `${store || ''}`.toUpperCase();
  if (normalized.includes('APP_STORE')) return 'app_store';
  if (normalized.includes('PLAY_STORE') || normalized.includes('GOOGLE')) return 'play_store';
  return null;
}

function deriveStatus(expiresDate?: string | null): 'active' | 'expired' {
  if (!expiresDate) return 'active';
  return new Date(expiresDate).getTime() > Date.now() ? 'active' : 'expired';
}

export async function POST() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const apiKey = process.env.REVENUECAT_SECRET_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'RevenueCat non configuré' }, { status: 500 });
    }

    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json(
        { error: `RevenueCat sync failed: ${response.status}`, body },
        { status: 502 }
      );
    }

    const payload = (await response.json()) as RevenueCatSubscriberPayload;
    const subscriptions = payload?.subscriber?.subscriptions || {};

    const admin = getAdminClient();
    for (const [productId, subscription] of Object.entries(subscriptions)) {
      const source = mapStoreToSource(subscription?.store);
      if (!source) continue;

      const expiresAt = subscription?.expires_date || null;
      const status = deriveStatus(expiresAt);

      await upsertBillingEntitlement(admin, {
        userId: user.id,
        source,
        status,
        expiresAt,
        externalSubscriptionId:
          subscription?.original_purchase_transaction_id ||
          subscription?.transaction_id ||
          productId,
        productId,
        payload: JSON.parse(JSON.stringify(payload)) as Json,
      });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, subscription_ends_at')
      .eq('id', user.id)
      .single();

    const entitlements = await fetchEntitlementsForUser(supabase, user.id);
    const state = deriveBillingState(profile, entitlements);

    await admin
      .from('profiles')
      .update({
        subscription_status: state.status,
        subscription_ends_at: state.expiresAt,
      })
      .eq('id', user.id);

    return NextResponse.json({
      ok: true,
      status: state.status,
      source: state.source,
      expiresAt: state.expiresAt,
    });
  } catch (error) {
    console.error('[RevenueCat sync] error:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
