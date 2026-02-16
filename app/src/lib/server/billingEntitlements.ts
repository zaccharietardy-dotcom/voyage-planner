import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/types';
import type { BillingSource, EntitlementStatus } from '@/lib/types';

type ServerSupabase = SupabaseClient<Database>;
type BillingEntitlementRow = Database['public']['Tables']['billing_entitlements']['Row'];

interface ProfileBillingFields {
  subscription_status: string | null;
  subscription_ends_at: string | null;
}

export interface DerivedBillingState {
  status: 'free' | 'pro' | 'canceled';
  expiresAt: string | null;
  source: BillingSource;
  canManageInApp: boolean;
  canManageOnWeb: boolean;
}

function isEntitlementActive(entitlement: Pick<BillingEntitlementRow, 'status' | 'expires_at'>): boolean {
  const status = entitlement.status;
  if (status !== 'active' && status !== 'grace') return false;
  if (!entitlement.expires_at) return true;
  return new Date(entitlement.expires_at).getTime() > Date.now();
}

function isLegacyStripeActive(profile: ProfileBillingFields | null): boolean {
  if (!profile) return false;
  if (profile.subscription_status !== 'pro') return false;
  if (!profile.subscription_ends_at) return true;
  return new Date(profile.subscription_ends_at).getTime() > Date.now();
}

function pickExpiresAt(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).toISOString());
  if (valid.length === 0) return null;
  return valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
}

function deriveSource(
  activeEntitlements: BillingEntitlementRow[],
  legacyStripeActive: boolean
): BillingSource {
  const set = new Set<BillingSource>();
  if (legacyStripeActive) set.add('stripe');
  activeEntitlements.forEach((item) => set.add(item.source));

  if (set.size === 0) return 'none';
  if (set.size > 1) return 'mixed';
  return Array.from(set)[0] || 'none';
}

export function deriveBillingState(
  profile: ProfileBillingFields | null,
  entitlements: BillingEntitlementRow[]
): DerivedBillingState {
  const activeEntitlements = entitlements.filter(isEntitlementActive);
  const legacyStripeActive = isLegacyStripeActive(profile);
  const isPro = legacyStripeActive || activeEntitlements.length > 0;
  const source = deriveSource(activeEntitlements, legacyStripeActive);
  const expiresAt = pickExpiresAt([
    profile?.subscription_ends_at || null,
    ...activeEntitlements.map((entry) => entry.expires_at),
  ]);

  return {
    status: isPro ? 'pro' : 'free',
    expiresAt,
    source,
    canManageInApp: source === 'app_store' || source === 'play_store' || source === 'mixed',
    canManageOnWeb: source === 'stripe' || source === 'none' || source === 'mixed',
  };
}

function isMissingTableError(error: unknown): boolean {
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError?.code === '42P01' ||
    String(maybeError?.message || '').includes('billing_entitlements')
  );
}

export async function fetchEntitlementsForUser(
  supabase: ServerSupabase,
  userId: string
): Promise<BillingEntitlementRow[]> {
  const { data, error } = await supabase
    .from('billing_entitlements')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    if (!isMissingTableError(error)) {
      console.error('[Billing] Failed to fetch entitlements:', error);
    }
    return [];
  }

  return data || [];
}

export interface UpsertEntitlementInput {
  userId: string;
  source: Exclude<BillingSource, 'none' | 'mixed'>;
  status: EntitlementStatus;
  expiresAt?: string | null;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
  productId?: string | null;
  payload?: Json | null;
}

export async function upsertBillingEntitlement(
  supabase: ServerSupabase,
  input: UpsertEntitlementInput
): Promise<void> {
  const base = supabase
    .from('billing_entitlements')
    .select('id')
    .eq('user_id', input.userId)
    .eq('source', input.source);

  const scoped = input.externalSubscriptionId
    ? base.eq('external_subscription_id', input.externalSubscriptionId)
    : input.productId
      ? base.eq('product_id', input.productId)
      : base;

  const { data: existing, error: existingError } = await scoped.limit(1).maybeSingle();

  if (existingError && !isMissingTableError(existingError)) {
    console.error('[Billing] Failed to read entitlement before upsert:', existingError);
    return;
  }

  if (existing?.id) {
    const { error } = await supabase
      .from('billing_entitlements')
      .update({
        status: input.status,
        expires_at: input.expiresAt || null,
        external_customer_id: input.externalCustomerId || null,
        external_subscription_id: input.externalSubscriptionId || null,
        product_id: input.productId || null,
        payload: input.payload || null,
      })
      .eq('id', existing.id);

    if (error && !isMissingTableError(error)) {
      console.error('[Billing] Failed to update entitlement:', error);
    }
    return;
  }

  const { error } = await supabase.from('billing_entitlements').insert({
    user_id: input.userId,
    source: input.source,
    status: input.status,
    expires_at: input.expiresAt || null,
    external_customer_id: input.externalCustomerId || null,
    external_subscription_id: input.externalSubscriptionId || null,
    product_id: input.productId || null,
    payload: input.payload || null,
  });

  if (error && !isMissingTableError(error)) {
    console.error('[Billing] Failed to insert entitlement:', error);
  }
}
