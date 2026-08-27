import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { appConfig } from "../config";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!appConfig.hasSupabase) return null;
  client ??= createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export function requireSupabase(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  return supabase;
}
