import Stripe from 'stripe';
import { createRouteHandlerClient } from '@/lib/supabase/server';

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-01-28.clover',
    });
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
    return profile.stripe_customer_id;
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
