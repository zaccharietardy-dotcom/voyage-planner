import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/send';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const { type, message, page } = await request.json();

    if (!message || typeof message !== 'string' || message.length > 1000) {
      return NextResponse.json({ error: 'Message invalide' }, { status: 400 });
    }

    // Store feedback in Supabase (table may not exist yet — best effort)
    try {
      await (supabase as any).from('feedback').insert({
        user_id: user.id,
        type: type || 'other',
        message,
        page: page || null,
        user_email: user.email,
      });
    } catch (e) {
      console.error('[feedback] Insert failed (table may not exist):', e);
    }

    // Also send email to team (best effort)
    const adminEmail = process.env.ADMIN_EMAIL || 'contact@naraevoyage.com';
    sendEmail({
      to: adminEmail,
      subject: `[Feedback ${type}] ${message.substring(0, 50)}...`,
      html: `
        <p><strong>Type:</strong> ${type}</p>
        <p><strong>User:</strong> ${user.email}</p>
        <p><strong>Page:</strong> ${page || 'N/A'}</p>
        <hr/>
        <p>${message}</p>
      `,
    }).catch((e) => console.error('[feedback] Email failed:', e));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[feedback] Error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
