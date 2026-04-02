import Stripe from 'stripe';
import { createRouteHandlerClient } from '@/lib/supabase/server';

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return _stripe;
}

export async function getOrCreateCustomer(userId: string, email: string): Promise<string> {
  const supabase = await createRouteHandlerClient();

  // Check if user already has a Stripe customer ID
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  if (profile?.stripe_customer_id) {
    // Verify the customer still exists in Stripe (handles test→live migration)
    try {
      await getStripe().customers.retrieve(profile.stripe_customer_id);
      return profile.stripe_customer_id;
    } catch {
      // Customer doesn't exist (e.g. test mode ID used in live mode) — create a new one
    }
  }

  // Create a new Stripe customer
  const customer = await getStripe().customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });

  // Save the customer ID
  await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);

  return customer.id;
}
