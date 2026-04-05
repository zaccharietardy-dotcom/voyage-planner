import Purchases, { LOG_LEVEL, type PurchasesPackage, type CustomerInfo } from 'react-native-purchases';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const IOS_KEY = Constants.expoConfig?.extra?.REVENUECAT_IOS_KEY
  || process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
  || '';
const ANDROID_KEY = Constants.expoConfig?.extra?.REVENUECAT_ANDROID_KEY
  || process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
  || '';

let initialized = false;

/**
 * Initialize RevenueCat — call once at app startup after auth.
 */
export async function initPurchases(userId?: string): Promise<void> {
  if (initialized) return;

  const apiKey = Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
  if (!apiKey) {
    console.warn('[Purchases] No RevenueCat API key configured for', Platform.OS);
    return;
  }

  if (__DEV__) {
    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  }

  Purchases.configure({ apiKey, appUserID: userId || null });
  initialized = true;
  console.log('[Purchases] RevenueCat initialized for', Platform.OS);
}

/**
 * Set the RevenueCat user ID (call after login).
 */
export async function loginPurchases(userId: string): Promise<void> {
  if (!initialized) return;
  try {
    await Purchases.logIn(userId);
  } catch (e) {
    console.warn('[Purchases] Login failed:', e);
  }
}

/**
 * Clear user on logout.
 */
export async function logoutPurchases(): Promise<void> {
  if (!initialized) return;
  try {
    await Purchases.logOut();
  } catch (e) {
    console.warn('[Purchases] Logout failed:', e);
  }
}

/**
 * Get available subscription packages.
 */
export async function getPackages(): Promise<PurchasesPackage[]> {
  if (!initialized) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages || [];
  } catch (e) {
    console.warn('[Purchases] Failed to get offerings:', e);
    return [];
  }
}

/**
 * Purchase a package. Returns the updated CustomerInfo on success, null on cancel/error.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<CustomerInfo | null> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (e: any) {
    if (e.userCancelled) {
      return null; // User cancelled — not an error
    }
    console.error('[Purchases] Purchase failed:', e);
    throw e;
  }
}

/**
 * Restore previous purchases (required by Apple).
 */
export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!initialized) return null;
  try {
    const customerInfo = await Purchases.restorePurchases();
    return customerInfo;
  } catch (e) {
    console.warn('[Purchases] Restore failed:', e);
    throw e;
  }
}

/**
 * Check if user has active "pro" entitlement.
 */
export async function checkProStatus(): Promise<boolean> {
  if (!initialized) return false;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo.entitlements.active['pro'] !== undefined;
  } catch {
    return false;
  }
}
