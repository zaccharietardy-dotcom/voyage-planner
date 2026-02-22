import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { upsertBillingEntitlement } from '@/lib/server/billingEntitlements';
import type { Database, Json } from '@/lib/supabase/types';
import { timingSafeEqual } from 'node:crypto';

function getAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface RevenueCatEvent {
  type?: string;
  store?: string;
  app_user_id?: string;
  expiration_at_ms?: string | number;
  expiration_at?: string;
  original_transaction_id?: string;
  transaction_id?: string;
  product_id?: string;
}

interface RevenueCatWebhookPayload {
  event?: RevenueCatEvent;
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) return false;

  const header = request.headers.get('authorization') || '';
  const bearerMatch = header.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) return false;

  const provided = bearerMatch[1];
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function mapRevenueCatSource(store: string | undefined): 'app_store' | 'play_store' | null {
  const normalized = `${store || ''}`.toUpperCase();
  if (normalized.includes('APP_STORE')) return 'app_store';
  if (normalized.includes('PLAY_STORE') || normalized.includes('GOOGLE')) return 'play_store';
  return null;
}

function mapRevenueCatStatus(eventType: string | undefined): 'active' | 'grace' | 'expired' | 'canceled' {
  const normalized = `${eventType || ''}`.toUpperCase();
  if (['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE'].includes(normalized)) {
    return 'active';
  }
  if (['BILLING_ISSUE', 'SUBSCRIPTION_PAUSED'].includes(normalized)) {
    return 'grace';
  }
  if (['CANCELLATION'].includes(normalized)) {
    return 'canceled';
  }
  return 'expired';
}

export async function POST(request: NextRequest) {
  if (!process.env.REVENUECAT_WEBHOOK_SECRET) {
    console.error('[RevenueCat webhook] rejected request', { reason: 'missing_webhook_secret' });
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }

  if (!isAuthorized(request)) {
    console.warn('[RevenueCat webhook] rejected request', { reason: 'unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as RevenueCatWebhookPayload | null;
  const event = payload?.event;

  if (!event) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const appUserId = event.app_user_id as string | undefined;
  const source = mapRevenueCatSource(event.store);

  if (!appUserId || !source) {
    return NextResponse.json({ received: true, skipped: true });
  }

  try {
    const supabase = getAdminClient();
    const entitlementStatus = mapRevenueCatStatus(event.type);
    const expiresAt = event.expiration_at_ms
      ? new Date(Number(event.expiration_at_ms)).toISOString()
      : event.expiration_at
        ? new Date(event.expiration_at).toISOString()
        : null;

    await upsertBillingEntitlement(supabase, {
      userId: appUserId,
      source,
      status: entitlementStatus,
      expiresAt,
      externalSubscriptionId: event.original_transaction_id || event.transaction_id || null,
      productId: event.product_id || null,
      payload: JSON.parse(JSON.stringify(payload)) as Json,
    });

    await supabase
      .from('profiles')
      .update({
        subscription_status: entitlementStatus === 'active' || entitlementStatus === 'grace' ? 'pro' : 'free',
        subscription_ends_at: expiresAt,
      })
      .eq('id', appUserId);

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[RevenueCat webhook] error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
