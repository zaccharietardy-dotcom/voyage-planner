import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

function getAdminEmails(): Set<string> {
  const fromEnv = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  return new Set(fromEnv);
}

export interface AdminUser {
  id: string;
  email: string;
}

export async function requireAdmin():
  Promise<{ ok: true; user: AdminUser } | { ok: false; response: NextResponse }> {
  const adminEmails = getAdminEmails();
  if (adminEmails.size === 0) {
    console.error('[AdminAuth] ADMIN_EMAILS is not configured; refusing admin access');
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Service administrateur indisponible: ADMIN_EMAILS non configuré' },
        { status: 503 }
      ),
    };
  }

  const supabase = await createRouteHandlerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }),
    };
  }

  const email = (user.email || '').toLowerCase();
  if (!email || !adminEmails.has(email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Accès administrateur requis' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user: {
      id: user.id,
      email,
    },
  };
}
