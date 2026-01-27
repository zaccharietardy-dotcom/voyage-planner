// Client-side only - for use in client components
export { createClient, getSupabaseClient } from './client';

// Types
export * from './types';

// Note: Server-side functions (createServerSupabaseClient, createRouteHandlerClient)
// should be imported directly from '@/lib/supabase/server' in server components and route handlers
