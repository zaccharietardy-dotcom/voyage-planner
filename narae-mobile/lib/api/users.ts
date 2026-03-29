import { supabase } from '@/lib/supabase/client';

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  subscription_status: string | null;
  extra_trips: number | null;
  referral_code: string | null;
}

export interface UserPreferences {
  id?: string;
  user_id: string;
  budget_level: string | null;
  activities: string[] | null;
  dietary: string[] | null;
  pace: string | null;
  group_type: string | null;
}

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data as UserProfile;
}

export async function fetchPreferences(userId: string): Promise<UserPreferences | null> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data as UserPreferences;
}

export async function updatePreferences(
  userId: string,
  prefs: Partial<Omit<UserPreferences, 'id' | 'user_id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('user_preferences')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' });

  if (error) throw new Error(error.message);
}

export async function updateProfile(
  userId: string,
  fields: Partial<Pick<UserProfile, 'display_name' | 'avatar_url'>>,
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', userId);

  if (error) throw new Error(error.message);
}
