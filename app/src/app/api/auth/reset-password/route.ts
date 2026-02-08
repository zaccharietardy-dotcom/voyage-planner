import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured');
  return new Resend(key);
}

// Client admin Supabase pour générer les liens de réinitialisation
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email requis' },
        { status: 400 }
      );
    }

    // Générer le lien de réinitialisation via Supabase Admin
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/auth/callback?redirect=/reset-password`,
      },
    });

    if (linkError) {
      console.error('Supabase link error:', linkError);
      // Ne pas révéler si l'email existe ou non pour des raisons de sécurité
      return NextResponse.json({ success: true });
    }

    const resetUrl = linkData.properties?.action_link;

    if (!resetUrl) {
      // Ne pas révéler l'erreur pour des raisons de sécurité
      return NextResponse.json({ success: true });
    }

    await sendResetEmail(email, resetUrl);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Send reset password error:', error);
    // Toujours retourner success pour ne pas révéler si l'email existe
    return NextResponse.json({ success: true });
  }
}

async function sendResetEmail(email: string, resetUrl: string) {
  const { error } = await getResend().emails.send({
    from: 'Narae Voyage <noreply@naraevoyage.com>',
    to: email,
    subject: 'Réinitialisez votre mot de passe - Narae Voyage',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f5;">
        <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="background: linear-gradient(135deg, #1e3a5f 0%, #0f2744 100%); padding: 30px; border-radius: 16px 16px 0 0; text-align: center;">
            <div style="width: 60px; height: 60px; margin: 0 auto 16px; background: rgba(255,255,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              <span style="font-size: 32px;">🔐</span>
            </div>
            <h1 style="color: #f4d03f; margin: 0; font-size: 24px; font-weight: 600;">
              Narae Voyage
            </h1>
          </div>

          <div style="background: white; padding: 40px 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <h2 style="color: #1e3a5f; margin: 0 0 16px; font-size: 20px;">
              Réinitialisation du mot de passe
            </h2>

            <p style="color: #6b7280; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
              Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
            </p>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}"
                 style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Réinitialiser mon mot de passe
              </a>
            </div>

            <p style="color: #9ca3af; font-size: 14px; line-height: 1.6; margin: 24px 0 0;">
              Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :
            </p>
            <p style="color: #6b7280; font-size: 12px; word-break: break-all; background: #f9fafb; padding: 12px; border-radius: 6px; margin: 8px 0 0;">
              ${resetUrl}
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;" />

            <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
              <p style="color: #92400e; font-size: 14px; margin: 0;">
                <strong>⚠️ Ce lien expire dans 1 heure.</strong><br/>
                Si vous n'avez pas demandé cette réinitialisation, ignorez cet email. Votre mot de passe restera inchangé.
              </p>
            </div>

            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              Pour des raisons de sécurité, ce lien ne peut être utilisé qu'une seule fois.
            </p>
          </div>

          <p style="color: #9ca3af; font-size: 11px; text-align: center; margin-top: 24px;">
            © 2026 Narae Voyage. Tous droits réservés.
          </p>
        </div>
      </body>
      </html>
    `,
  });

  if (error) {
    console.error('Resend error:', error);
  }
}
