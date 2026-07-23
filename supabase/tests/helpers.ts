// Shared test utilities for DB integration and RLS tests.
// All helpers use the service-role client for setup/teardown so they bypass
// the same RLS policies that the tests themselves are exercising.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://localhost:54321";

// Standard local-dev Supabase keys — override via environment variables.
// Obtain from: supabase status (after supabase start)
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7W9fDQlBjjoyez1ISgodRq0kxjI4DqprDjU";

export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hj04zWl196z2-SBc0";

const CLIENT_OPTS = { auth: { persistSession: false, autoRefreshToken: false } };

export function svcClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, CLIENT_OPTS);
}

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
}

// Create an auth user via the admin API. Returns the user's UUID.
export async function createTestUser(email: string): Promise<string> {
  const svc = svcClient();
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: "TestPassword123!",
    email_confirm: true,
  });
  if (error) throw new Error(`createTestUser failed: ${error.message}`);
  return data.user!.id;
}

// Sign in as an existing test user; returns an authenticated client + userId.
export async function signInAs(
  email: string,
): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(SUPABASE_URL, ANON_KEY, CLIENT_OPTS);
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: "TestPassword123!",
  });
  if (error) throw new Error(`signInAs(${email}) failed: ${error.message}`);
  return { client, userId: data.user!.id };
}

// Delete a test user by UUID.
export async function deleteTestUser(userId: string): Promise<void> {
  const svc = svcClient();
  await svc.auth.admin.deleteUser(userId);
}

// Insert a food row via the service role (bypasses RLS).
// Returns the new food UUID.
export async function insertGlobalFood(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const svc = svcClient();
  const { data, error } = await svc
    .from("foods")
    .insert({
      name: "Integration Test Food",
      normalized_name: "integration test food",
      source: "user_manual",
      calories_100g: 100,
      protein_100g: 10,
      carbs_100g: 20,
      fat_100g: 5,
      fibre_100g: 3,
      verified: true,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertGlobalFood failed: ${error.message}`);
  return data.id as string;
}

// Delete a food row (and cascade-delete any meal_items referencing it).
export async function deleteFood(foodId: string): Promise<void> {
  const svc = svcClient();
  await svc.from("foods").delete().eq("id", foodId);
}

// Delete ALL meals for a user (cleanup helper).
export async function deleteUserMeals(userId: string): Promise<void> {
  const svc = svcClient();
  await svc.from("meals").delete().eq("user_id", userId);
}

// Delete ALL portion history for a user.
export async function deleteUserPortionHistory(userId: string): Promise<void> {
  const svc = svcClient();
  await svc.from("user_food_portions").delete().eq("user_id", userId);
}

// Build a minimal valid fn_log_meal item object.
export function makeLogMealItem(foodId: string, overrides: Record<string, unknown> = {}) {
  return {
    food_id: foodId,
    raw_phrases: ["test item"],
    quantity: 150,
    unit: "g",
    portion_g: 150,
    calories: 150,
    protein_g: 15,
    carbs_g: 30,
    fat_g: 7.5,
    fibre_g: 4.5,
    match_confidence: "exact",
    portion_confidence: "exact",
    item_confidence: "high",
    nutrition_source: "usda_fdc",
    ...overrides,
  };
}

// Unique email helper (avoids collisions between test runs).
export function testEmail(label: string): string {
  return `${label}-${Date.now()}@test.local`;
}
