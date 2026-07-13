import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL?.trim() ?? '';
export const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export function createPublicSupabaseClient() {
  if (!hasSupabaseConfig) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
