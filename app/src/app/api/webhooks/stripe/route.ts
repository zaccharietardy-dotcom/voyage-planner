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

  try {
    const supabase = getAdminClient();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer as string;

        if (session.mode === 'subscription') {
          const subscriptionId = session.subscription as string;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          // Extract current_period_end safely from the subscription object
          const subData = JSON.parse(JSON.stringify(subscription));
          const periodEnd = subData.current_period_end;
          const endsAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          const { error: updateError } = await supabase
            .from('profiles')
            .update({
              subscription_status: 'pro',
              subscription_id: subscriptionId,
              subscription_ends_at: endsAt,
            })
            .eq('stripe_customer_id', customerId);

          if (updateError) {
            console.error(`[Stripe] Supabase update error:`, updateError);
            return NextResponse.json({ error: `DB error: ${updateError.message}` }, { status: 500 });
          }

        } else if (session.mode === 'payment') {
          const metadata = session.metadata as Record<string, string> | null;
          if (metadata?.type === 'one_time_trip') {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('extra_trips')
              .eq('stripe_customer_id', customerId)
              .single();

            const { error: updateError } = await supabase
              .from('profiles')
              .update({
                extra_trips: (profileData?.extra_trips || 0) + 1,
              })
              .eq('stripe_customer_id', customerId);

            if (updateError) {
              console.error(`[Stripe] Supabase update error:`, updateError);
              return NextResponse.json({ error: `DB error: ${updateError.message}` }, { status: 500 });
            }

          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;
        const status = subscription.status === 'active' ? 'pro' : 'free';
        const subData = JSON.parse(JSON.stringify(subscription));
        const periodEnd = subData.current_period_end;
        const endsAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

        await supabase
          .from('profiles')
          .update({
            subscription_status: status,
            subscription_ends_at: endsAt,
          })
          .eq('stripe_customer_id', customerId);

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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Stripe] Webhook handler error:', message, err);
    return NextResponse.json({ error: `Handler error: ${message}` }, { status: 500 });
  }
}
