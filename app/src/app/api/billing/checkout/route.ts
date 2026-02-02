import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { stripe, getOrCreateCustomer } from '@/lib/stripe';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const plan = body.plan || 'yearly'; // 'monthly' ou 'yearly'

    const priceId = plan === 'monthly'
      ? process.env.STRIPE_PRICE_ID!
      : process.env.STRIPE_PRICE_ID_YEARLY!;

    if (!priceId) {
      return NextResponse.json({ error: 'Prix non configuré' }, { status: 500 });
    }

    const customerId = await getOrCreateCustomer(user.id, user.email!);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/pricing?success=true`,
      cancel_url: `${baseUrl}/pricing?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 });
  }
}
