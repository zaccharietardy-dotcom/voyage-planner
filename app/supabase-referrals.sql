-- Migration: Add referral system
-- Run this in Supabase Dashboard → SQL Editor

-- Add referral_code to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES auth.users(id);

-- Generate unique referral codes for existing users (6 char alphanumeric)
UPDATE profiles
SET referral_code = upper(substr(md5(id::text || now()::text), 1, 6))
WHERE referral_code IS NULL;

-- Auto-generate referral code for new users via trigger
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := upper(substr(md5(NEW.id::text || now()::text), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_referral_code ON profiles;
CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_referral_code();

-- Track referral completions
CREATE TABLE IF NOT EXISTS referrals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id uuid NOT NULL REFERENCES auth.users(id),
  referred_id uuid NOT NULL REFERENCES auth.users(id),
  rewarded boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(referred_id)
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see own referrals"
  ON referrals FOR SELECT
  USING (auth.uid() = referrer_id);
