import { NextRequest, NextResponse } from 'next/server';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';
import { resolveRequestAuth } from '@/lib/server/requestAuth';
import {
  evaluateGenerationAdmission,
  evaluateAdmissionWithProviderReadiness,
  getProviderReadinessSnapshot,
} from '@/app/api/generate/admission';
import { getBudgetPolicySnapshot } from '@/lib/services/apiCostGuard';

const FREE_LIFETIME_LIMIT = 1;

function resolveBudgetProfile(queryProfile: string | null): 'dense' | 'medium' | 'spread' {
  if (queryProfile === 'dense' || queryProfile === 'medium' || queryProfile === 'spread') {
    return queryProfile;
  }
  return 'dense';
}

function reasonForAdmissionBlock(reasonCode: string): string {
  switch (reasonCode) {
    case 'cooldown_active':
      return 'Une génération identique est déjà récente. Patiente un peu avant de relancer.';
    case 'dedupe_hit':
      return 'Même demande détectée: un résultat récent peut être réutilisé.';
    case 'quality_live_daily_cap':
      return 'Cadence live atteinte pour aujourd’hui.';
    case 'provider_not_ready':
      return 'Un provider requis est indisponible ou en quota.';
    default:
      return 'Admission temporairement bloquée.';
  }
}

/**
 * Lightweight pre-check before trip generation.
 * Returns { allowed, reason, action } without consuming any quota.
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const requestFingerprint = (url.searchParams.get('requestFingerprint') || '').trim();
    const probeProviders = url.searchParams.get('probeProviders') === '1';
    const budgetProfile = resolveBudgetProfile(url.searchParams.get('budgetProfile'));

    const { supabase, user } = await resolveRequestAuth(request);

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

    const providerReadiness = await getProviderReadinessSnapshot({ probe: probeProviders });
    const budgetPolicySnapshot = getBudgetPolicySnapshot(budgetProfile);

    const baseAdmission = requestFingerprint
      ? evaluateGenerationAdmission({ userId: user.id, requestFingerprint })
      : {
          allowed: true,
          reasonCode: 'admission_allowed' as const,
          requestFingerprint: 'preflight_no_fingerprint',
        };
    const admission = evaluateAdmissionWithProviderReadiness({
      admission: baseAdmission,
      providerReadiness,
    });

    if (billingState.status === 'pro') {
      return NextResponse.json({
        allowed: admission.allowed,
        admission: {
          allowed: admission.allowed,
          reasonCode: admission.reasonCode,
          requestFingerprint: requestFingerprint || null,
          cooldownSeconds: admission.cooldownRemainingMs
            ? Math.ceil(admission.cooldownRemainingMs / 1000)
            : 0,
          replayAvailable: Boolean(admission.replayTrip),
        },
        providerReadiness,
        budgetPolicySnapshot,
        ...(admission.allowed
          ? {}
          : {
              reason: reasonForAdmissionBlock(admission.reasonCode),
              action: admission.reasonCode === 'provider_not_ready' ? 'retry_later' : 'wait',
            }),
      });
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
        admission: {
          allowed: false,
          reasonCode: 'quota_exceeded',
          requestFingerprint: requestFingerprint || null,
          cooldownSeconds: 0,
          replayAvailable: Boolean(admission.replayTrip),
        },
        providerReadiness,
        budgetPolicySnapshot,
      });
    }

    return NextResponse.json({
      allowed: admission.allowed,
      remaining: totalAllowed - (count || 0),
      admission: {
        allowed: admission.allowed,
        reasonCode: admission.reasonCode,
        requestFingerprint: requestFingerprint || null,
        cooldownSeconds: admission.cooldownRemainingMs
          ? Math.ceil(admission.cooldownRemainingMs / 1000)
          : 0,
        replayAvailable: Boolean(admission.replayTrip),
      },
      providerReadiness,
      budgetPolicySnapshot,
      ...(admission.allowed
        ? {}
        : {
            reason: reasonForAdmissionBlock(admission.reasonCode),
            action: admission.reasonCode === 'provider_not_ready' ? 'retry_later' : 'wait',
          }),
    });
  } catch (error) {
    console.error('[preflight] Error:', error);
    // Fail open — don't block generation if preflight fails
    return NextResponse.json({
      allowed: true,
      admission: {
        allowed: true,
        reasonCode: 'admission_allowed',
      },
      providerReadiness: {
        checkedAt: new Date().toISOString(),
        fromCache: false,
        requiredProviders: ['gemini', 'serpapi', 'google_places'],
        overall: 'ready',
        blockedProviders: [],
        providers: {
          gemini: { configured: true, status: 'ready' },
          serpapi: { configured: true, status: 'ready' },
          google_places: { configured: true, status: 'ready' },
        },
      },
      budgetPolicySnapshot: getBudgetPolicySnapshot('dense'),
    });
  }
}
