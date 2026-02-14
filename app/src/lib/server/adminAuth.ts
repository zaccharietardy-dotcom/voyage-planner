import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

const DEFAULT_ADMIN_EMAILS = ['zaccharietardy@gmail.com'];

function getAdminEmails(): Set<string> {
  const fromEnv = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  const emails = fromEnv.length > 0 ? fromEnv : DEFAULT_ADMIN_EMAILS;
  return new Set(emails);
}

export interface AdminUser {
  id: string;
  email: string;
}

export async function requireAdmin():
  Promise<{ ok: true; user: AdminUser } | { ok: false; response: NextResponse }> {
  const supabase = await createRouteHandlerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }),
    };
  }

  const email = (user.email || '').toLowerCase();
  if (!email || !getAdminEmails().has(email)) {
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
