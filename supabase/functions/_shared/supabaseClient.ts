import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// Service-role client — bypasses RLS. Used for cross-tier lookups (global
// cache, USDA/OFF-sourced foods) and for writes that RLS would otherwise
// block (global_food_cache, api_cache, system_settings, food_synonyms).
// Never expose this key to the client — it only ever lives in Edge Function
// environment variables (Supabase secrets).
export function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// User-scoped client — runs under the caller's JWT, so RLS applies normally.
// Used purely to validate the session (auth.getUser()); functions then use
// the service client for the actual reads/writes described above.
export function getUserClient(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    },
  );
}
