import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();

  const query = request.nextUrl.searchParams.get('q');
  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }

  const searchTerm = `%${query}%`;

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, username, bio')
    .or(`display_name.ilike.${searchTerm},username.ilike.${searchTerm}`)
    .neq('id', user?.id || '')
    .limit(20);

  if (error) {
    console.error('Search error:', error);
    return NextResponse.json([]);
  }

  return NextResponse.json(profiles || []);
}
