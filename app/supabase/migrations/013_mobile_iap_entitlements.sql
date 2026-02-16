-- ============================================================
-- Migration 013: Mobile IAP entitlements (Stripe + App Store + Play Store)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.billing_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('stripe', 'app_store', 'play_store')),
  external_customer_id TEXT,
  external_subscription_id TEXT,
  product_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'grace', 'expired', 'canceled')),
  expires_at TIMESTAMPTZ,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_entitlements_user
  ON public.billing_entitlements(user_id);

CREATE INDEX IF NOT EXISTS idx_billing_entitlements_user_source
  ON public.billing_entitlements(user_id, source);

CREATE INDEX IF NOT EXISTS idx_billing_entitlements_subscription
  ON public.billing_entitlements(source, external_subscription_id);

CREATE OR REPLACE FUNCTION public.update_billing_entitlements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_billing_entitlements_updated_at ON public.billing_entitlements;
CREATE TRIGGER trigger_billing_entitlements_updated_at
  BEFORE UPDATE ON public.billing_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_billing_entitlements_updated_at();

ALTER TABLE public.billing_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own billing entitlements" ON public.billing_entitlements;
CREATE POLICY "Users can view own billing entitlements"
  ON public.billing_entitlements FOR SELECT
  USING (auth.uid() = user_id);
