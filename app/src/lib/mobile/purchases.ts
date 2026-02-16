import { getPlatform, isNativeApp } from '@/lib/mobile/runtime';

export type BillingPlan = 'monthly' | 'yearly';

export interface MobilePurchaseResult {
  success: boolean;
  message?: string;
}

let configuredUserId: string | null = null;

interface PurchasePackage {
  identifier?: string;
  packageType?: string;
  [key: string]: unknown;
}

interface PurchasesSdk {
  configure: (options: { apiKey: string; appUserID: string }) => Promise<void>;
  logIn?: (options: { appUserID: string }) => Promise<unknown>;
  getOfferings: () => Promise<{ current?: { availablePackages?: PurchasePackage[] } }>;
  purchasePackage: (options: { aPackage?: PurchasePackage; package?: PurchasePackage }) => Promise<unknown>;
  restorePurchases: () => Promise<unknown>;
}

function getRevenueCatApiKey(): string | null {
  const platform = getPlatform();
  if (platform === 'ios') return process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY || null;
  if (platform === 'android') return process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY || null;
  return null;
}

function getPurchasesSdk(): PurchasesSdk | null {
  try {
    if (typeof window === 'undefined') return null;
    const runtime = (window as Window & {
      Capacitor?: {
        Plugins?: {
          Purchases?: PurchasesSdk;
        };
      };
      Purchases?: PurchasesSdk;
    });
    return runtime.Capacitor?.Plugins?.Purchases || runtime.Purchases || null;
  } catch (error) {
    console.error('[IAP] RevenueCat SDK unavailable:', error);
    return null;
  }
}

async function ensureConfigured(appUserId: string): Promise<{ sdk: PurchasesSdk | null; error?: string }> {
  if (!isNativeApp()) {
    return { sdk: null, error: 'Achat in-app indisponible sur le web' };
  }

  const apiKey = getRevenueCatApiKey();
  if (!apiKey) {
    return { sdk: null, error: 'Clé RevenueCat manquante pour cette plateforme' };
  }

  const sdk = getPurchasesSdk();
  if (!sdk) {
    return { sdk: null, error: 'SDK RevenueCat indisponible' };
  }

  try {
    if (!configuredUserId) {
      await sdk.configure({
        apiKey,
        appUserID: appUserId,
      });
      configuredUserId = appUserId;
      return { sdk };
    }

    if (configuredUserId !== appUserId && typeof sdk.logIn === 'function') {
      await sdk.logIn({ appUserID: appUserId });
      configuredUserId = appUserId;
    }

    return { sdk };
  } catch (error) {
    console.error('[IAP] RevenueCat configure error:', error);
    return { sdk: null, error: 'Impossible d’initialiser les achats in-app' };
  }
}

function choosePackage(
  offerings: Awaited<ReturnType<PurchasesSdk['getOfferings']>>,
  plan: BillingPlan
): PurchasePackage | null {
  const available = offerings?.current?.availablePackages;
  if (!Array.isArray(available) || available.length === 0) {
    return null;
  }

  const normalized = plan === 'yearly' ? ['annual', 'year'] : ['monthly', 'month'];
  const byPlan = available.find((pkg) => {
    const id = `${pkg?.identifier || ''}`.toLowerCase();
    const type = `${pkg?.packageType || ''}`.toLowerCase();
    return normalized.some((key) => id.includes(key) || type.includes(key));
  });

  return byPlan || available[0];
}

export async function syncPurchasesWithBackend(): Promise<void> {
  try {
    await fetch('/api/billing/revenuecat/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('[IAP] Failed to sync RevenueCat entitlements:', error);
  }
}

export async function purchaseProPlan(
  plan: BillingPlan,
  appUserId: string
): Promise<MobilePurchaseResult> {
  const { sdk, error } = await ensureConfigured(appUserId);
  if (!sdk) {
    return { success: false, message: error };
  }

  try {
    const offerings = await sdk.getOfferings();
    const selectedPackage = choosePackage(offerings, plan);
    if (!selectedPackage) {
      return { success: false, message: 'Aucune offre in-app disponible' };
    }

    try {
      await sdk.purchasePackage({ aPackage: selectedPackage });
    } catch {
      await sdk.purchasePackage({ package: selectedPackage });
    }

    await syncPurchasesWithBackend();
    return { success: true };
  } catch (purchaseError: unknown) {
    const details = purchaseError as { message?: string; errorMessage?: string };
    const message =
      details?.message ||
      details?.errorMessage ||
      'Achat in-app annulé ou échoué';
    return { success: false, message };
  }
}

export async function restoreMobilePurchases(appUserId: string): Promise<MobilePurchaseResult> {
  const { sdk, error } = await ensureConfigured(appUserId);
  if (!sdk) {
    return { success: false, message: error };
  }

  try {
    await sdk.restorePurchases();
    await syncPurchasesWithBackend();
    return { success: true };
  } catch (restoreError: unknown) {
    const details = restoreError as { message?: string };
    return {
      success: false,
      message: details?.message || 'Restauration impossible pour le moment',
    };
  }
}
