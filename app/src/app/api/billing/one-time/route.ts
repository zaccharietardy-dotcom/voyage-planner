import { NextResponse } from 'next/server';
import { stripe, getOrCreateCustomer } from '@/lib/stripe';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function POST() {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const priceId = process.env.STRIPE_PRICE_ID_ONE_TIME;
    if (!priceId) {
      return NextResponse.json({ error: 'Prix one-time non configuré' }, { status: 500 });
    }

    const customerId = await getOrCreateCustomer(user.id, user.email!);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/pricing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/pricing?canceled=true`,
      metadata: {
        user_id: user.id,
        type: 'one_time_trip',
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating one-time checkout:', error);
    return NextResponse.json({ error: 'Erreur lors de la création du paiement' }, { status: 500 });
  }
}
