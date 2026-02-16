export type BillingSource = 'none' | 'stripe' | 'app_store' | 'play_store' | 'mixed';

export type EntitlementStatus = 'active' | 'grace' | 'expired' | 'canceled';

export interface BillingStatusResponse {
  status: 'free' | 'pro' | 'canceled';
  expiresAt: string | null;
  source: BillingSource;
  canManageInApp: boolean;
  canManageOnWeb: boolean;
}

export interface MobilePurchaseState {
  isNative: boolean;
  platform: 'ios' | 'android' | 'web';
  canPurchaseInApp: boolean;
  canRestorePurchases: boolean;
}
