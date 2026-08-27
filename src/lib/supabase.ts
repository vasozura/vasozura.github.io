import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { appConfig } from "../config";

let client: SupabaseClient | null = null;
let passwordRecovery = typeof window !== "undefined" && new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";

export function isPasswordRecovery(): boolean {
  return passwordRecovery;
}

export function clearPasswordRecovery(): void {
  passwordRecovery = false;
}

export function getSupabase(): SupabaseClient | null {
  if (!appConfig.hasSupabase) return null;
  if (!client) {
    client = createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") passwordRecovery = true;
    });
  }
  return client;
}

export function requireSupabase(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  return supabase;
}
