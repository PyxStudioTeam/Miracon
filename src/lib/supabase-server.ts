import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { hasSupabaseConfig, supabaseAnonKey, supabaseUrl } from './supabase';

export function createAstroSupabaseClient(cookies: AstroCookies, request: Request) {
  if (!hasSupabaseConfig) {
    return null;
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('Cookie') ?? '')
          .filter((cookie): cookie is { name: string; value: string } => typeof cookie.value === 'string');
      },
      setAll(values) {
        values.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
      },
    },
  });
}
