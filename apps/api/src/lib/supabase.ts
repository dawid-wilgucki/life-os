import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types';

/**
 * Service-role Supabase client. Bypasses RLS — only ever used inside the
 * Worker, never exposed to the browser. Single-user app, so one client per
 * request is fine.
 */
export function createSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
