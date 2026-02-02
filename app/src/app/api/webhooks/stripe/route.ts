import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';

// Use service role client to bypass RLS (webhook has no user session)
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Webhook signature verification failed:', message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  const supabase = getAdminClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerId = session.customer as string;

      if (session.mode === 'subscription') {
        // Abonnement Pro
        const subscriptionId = session.subscription as string;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const periodEnd = (subscription as unknown as { current_period_end: number }).current_period_end;

        await supabase
          .from('profiles')
          .update({
            subscription_status: 'pro',
            subscription_id: subscriptionId,
            subscription_ends_at: new Date(periodEnd * 1000).toISOString(),
          })
          .eq('stripe_customer_id', customerId);

        console.log(`[Stripe] Subscription activated for customer ${customerId}`);
      } else if (session.mode === 'payment') {
        // Paiement à l'unité — incrémenter extra_trips
        const metadata = session.metadata as Record<string, string> | null;
        if (metadata?.type === 'one_time_trip') {
          const { data: profile } = await supabase
            .from('profiles')
            .select('extra_trips')
            .eq('stripe_customer_id', customerId)
            .single();

          await supabase
            .from('profiles')
            .update({
              extra_trips: (profile?.extra_trips || 0) + 1,
            })
            .eq('stripe_customer_id', customerId);

          console.log(`[Stripe] Extra trip purchased for customer ${customerId}`);
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer as string;
      const status = subscription.status === 'active' ? 'pro' : 'free';
      const periodEnd = (subscription as unknown as { current_period_end: number }).current_period_end;

      await supabase
        .from('profiles')
        .update({
          subscription_status: status,
          subscription_ends_at: new Date(periodEnd * 1000).toISOString(),
        })
        .eq('stripe_customer_id', customerId);

      console.log(`[Stripe] Subscription updated for customer ${customerId}: ${status}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer as string;

      await supabase
        .from('profiles')
        .update({
          subscription_status: 'free',
          subscription_id: null,
          subscription_ends_at: null,
        })
        .eq('stripe_customer_id', customerId);

      console.log(`[Stripe] Subscription canceled for customer ${customerId}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = invoice.customer as string;
      console.error(`[Stripe] Payment failed for customer ${customerId}`);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
