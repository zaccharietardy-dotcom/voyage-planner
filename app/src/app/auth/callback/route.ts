import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function normalizeInternalRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return '/mes-voyages';
  return raw;
}

function normalizeAppRedirect(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('com.naraevoyage.app://')) return null;
  return raw;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const origin = requestUrl.origin;
  const internalRedirect = normalizeInternalRedirect(requestUrl.searchParams.get('redirect'));
  const appRedirect = normalizeAppRedirect(requestUrl.searchParams.get('app_redirect'));

  // Vérifier s'il y a une erreur OAuth
  const errorParam = requestUrl.searchParams.get('error');
  const errorDescription = requestUrl.searchParams.get('error_description');

  if (errorParam) {
    console.error('OAuth error:', errorParam, errorDescription);
    if (appRedirect) {
      const target = new URL(appRedirect);
      target.searchParams.set('error', errorParam);
      target.searchParams.set('redirect', internalRedirect);
      return NextResponse.redirect(target.toString());
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorParam)}`);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // The `setAll` method was called from a Server Component.
            }
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      if (appRedirect && data.session.access_token && data.session.refresh_token) {
        const target = new URL(appRedirect);
        target.searchParams.set('access_token', data.session.access_token);
        target.searchParams.set('refresh_token', data.session.refresh_token);
        target.searchParams.set('redirect', internalRedirect);
        return NextResponse.redirect(target.toString());
      }

      return NextResponse.redirect(`${origin}${internalRedirect}`);
    }

    console.error('Session exchange error:', error);
    if (appRedirect) {
      const target = new URL(appRedirect);
      target.searchParams.set('error', 'session_error');
      target.searchParams.set('redirect', internalRedirect);
      return NextResponse.redirect(target.toString());
    }
    return NextResponse.redirect(`${origin}/login?error=session_error`);
  }

  // Pas de code - rediriger vers login
  if (appRedirect) {
    const target = new URL(appRedirect);
    target.searchParams.set('error', 'missing_code');
    target.searchParams.set('redirect', internalRedirect);
    return NextResponse.redirect(target.toString());
  }
  return NextResponse.redirect(`${origin}/login`);
}
