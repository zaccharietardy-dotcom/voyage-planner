import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  getPublicEnv,
  isAdminEmail,
  isInternalToolRoute,
  isInternalToolsEnabled,
} from '@/lib/runtime-config';

function notFoundResponse(requestId: string): NextResponse {
  const response = new NextResponse('Not Found', { status: 404 });
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const publicEnv = getPublicEnv();
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isInternalToolRoute(request.nextUrl.pathname)) {
    if (!isInternalToolsEnabled() || !isAdminEmail(user?.email)) {
      return notFoundResponse(requestId);
    }
  }

  supabaseResponse.headers.set('x-request-id', requestId);
  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
