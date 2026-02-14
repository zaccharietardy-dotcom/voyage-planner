import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';

type DbClient = SupabaseClient<Database>;

interface CloseFriendRow {
  requester_id: string;
  target_id: string;
}

export async function getAcceptedCloseFriendIds(
  supabase: DbClient,
  userId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('close_friends')
    .select('requester_id, target_id')
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
    .eq('status', 'accepted');

  const rows: CloseFriendRow[] = data || [];
  const ids = rows.map((row) => (row.requester_id === userId ? row.target_id : row.requester_id));
  return new Set(ids);
}

export async function isAcceptedCloseFriend(
  supabase: DbClient,
  userId: string,
  otherUserId: string
): Promise<boolean> {
  const closeFriendIds = await getAcceptedCloseFriendIds(supabase, userId);
  return closeFriendIds.has(otherUserId);
}
