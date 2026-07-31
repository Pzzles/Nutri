// Node.js helpers for Phase 4 integration tests.
// Mirrors supabase/tests/helpers.ts — kept local to avoid cross-workspace imports.
// Requires: supabase start (local Supabase running)

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://localhost:54421";

// Default to well-known local dev keys; override via env.
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const NO_PERSIST = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

export function svcClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, NO_PERSIST);
}

export async function createTestUser(email: string): Promise<string> {
  const { data, error } = await svcClient().auth.admin.createUser({
    email,
    password: "TestPassword123!",
    email_confirm: true,
  });
  if (error) throw new Error(`createTestUser failed: ${error.message}`);
  return data.user!.id;
}

export async function signInAs(email: string): Promise<{ session: Session; userId: string }> {
  const client = createClient(SUPABASE_URL, ANON_KEY, NO_PERSIST);
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: "TestPassword123!",
  });
  if (error) throw new Error(`signInAs(${email}) failed: ${error.message}`);
  return { session: data.session!, userId: data.user!.id };
}

export async function deleteTestUser(userId: string): Promise<void> {
  await svcClient().auth.admin.deleteUser(userId);
}

export async function cleanupUser(userId: string): Promise<void> {
  const svc = svcClient();
  // Cascade order: meals cascade-deletes meal_items; saved_meals cascade-deletes saved_meal_items.
  await svc.from("meals").delete().eq("user_id", userId);
  await svc.from("saved_meals").delete().eq("user_id", userId);
  await svc.from("daily_log_status").delete().eq("user_id", userId);
  await svc.from("user_food_cache").delete().eq("user_id", userId);
}

export function testEmail(label: string): string {
  return `${label}-${Date.now()}@test.local`;
}
