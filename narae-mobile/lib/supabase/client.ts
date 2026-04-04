import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { appEnv } from '@/lib/env';

export const supabase = createClient(appEnv.EXPO_PUBLIC_SUPABASE_URL, appEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
