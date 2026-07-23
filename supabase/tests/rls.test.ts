// RLS (Row-Level Security) integration tests.
// Two-user setup: userA and userB are independent authenticated users.
// All cross-user isolation tests verify the separation of data.
// Requires: supabase start
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTestUser, signInAs, deleteTestUser,
  insertGlobalFood, deleteFood,
  testEmail, svcClient, anonClient,
} from "./helpers.js";

const EMAIL_A = testEmail("rls-userA");
const EMAIL_B = testEmail("rls-userB");

let userAId = "";
let userBId = "";
let clientA: SupabaseClient;
let clientB: SupabaseClient;

let globalFoodId = "";     // inserted via service role; owner_user_id = NULL
let userAFoodId = "";      // inserted by userA; owner_user_id = userA
let userBFoodId = "";      // inserted by userB; owner_user_id = userB

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  userAId = await createTestUser(EMAIL_A);
  userBId = await createTestUser(EMAIL_B);
  ({ client: clientA } = await signInAs(EMAIL_A));
  ({ client: clientB } = await signInAs(EMAIL_B));

  // Global food — inserted via service role (bypasses RLS)
  globalFoodId = await insertGlobalFood({ owner_user_id: null });

  // UserA's private food — inserted through userA's authenticated client
  const { data: foodA, error: errA } = await clientA.from("foods").insert({
    name: "UserA Private Food",
    normalized_name: "usera private food",
    source: "user_manual",
    calories_100g: 200,
    protein_100g: 20,
    carbs_100g: 40,
    fat_100g: 10,
    verified: false,
    owner_user_id: userAId,
  }).select("id").single();
  if (errA) throw new Error(`Setup: userA food insert failed: ${errA.message}`);
  userAFoodId = foodA.id;

  // UserB's private food
  const { data: foodB, error: errB } = await clientB.from("foods").insert({
    name: "UserB Private Food",
    normalized_name: "userb private food",
    source: "user_manual",
    calories_100g: 300,
    protein_100g: 30,
    carbs_100g: 60,
    fat_100g: 15,
    verified: false,
    owner_user_id: userBId,
  }).select("id").single();
  if (errB) throw new Error(`Setup: userB food insert failed: ${errB.message}`);
  userBFoodId = foodB.id;
});

afterAll(async () => {
  await deleteFood(globalFoodId);
  await deleteFood(userAFoodId);
  await deleteFood(userBFoodId);
  await deleteTestUser(userAId);
  await deleteTestUser(userBId);
});

// ── Foods: SELECT ─────────────────────────────────────────────────────────────

describe("foods — SELECT policies", () => {
  it("authenticated user can see global foods (owner_user_id IS NULL)", async () => {
    const { data, error } = await clientA
      .from("foods")
      .select("id")
      .eq("id", globalFoodId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(globalFoodId);
  });

  it("user can see their own private foods", async () => {
    const { data, error } = await clientA
      .from("foods")
      .select("id")
      .eq("id", userAFoodId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(userAFoodId);
  });

  it("user cannot see another user's private foods", async () => {
    const { data } = await clientA
      .from("foods")
      .select("id")
      .eq("id", userBFoodId)
      .maybeSingle();
    expect(data).toBeNull(); // RLS hides it
  });

  it("unauthenticated (anon) client can see global foods", async () => {
    const { data, error } = await anonClient()
      .from("foods")
      .select("id")
      .eq("id", globalFoodId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(globalFoodId);
  });

  it("unauthenticated client cannot see private foods", async () => {
    const { data } = await anonClient()
      .from("foods")
      .select("id")
      .eq("id", userAFoodId)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

// ── Foods: INSERT ─────────────────────────────────────────────────────────────

describe("foods — INSERT policies", () => {
  it("user can insert a private food with own owner_user_id and verified=false", async () => {
    const { data, error } = await clientA.from("foods").insert({
      name: "New Private Food",
      normalized_name: "new private food",
      source: "user_manual",
      calories_100g: 150,
      protein_100g: 5,
      carbs_100g: 20,
      fat_100g: 3,
      verified: false,
      owner_user_id: userAId,
    }).select("id").single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();

    // cleanup
    await deleteFood(data.id);
  });

  it("user cannot insert a food with verified=true (security: only trusted sources can be verified)", async () => {
    const { error } = await clientA.from("foods").insert({
      name: "Fake Verified Food",
      normalized_name: "fake verified food",
      source: "user_manual",
      calories_100g: 100,
      protein_100g: 5,
      carbs_100g: 10,
      fat_100g: 3,
      verified: true,       // ← policy blocks this
      owner_user_id: userAId,
    });
    expect(error).not.toBeNull();
  });

  it("user cannot insert a food with owner_user_id = NULL (global food creation is service-role-only)", async () => {
    const { error } = await clientA.from("foods").insert({
      name: "Attempted Global Food",
      normalized_name: "attempted global food",
      source: "user_manual",
      calories_100g: 100,
      protein_100g: 5,
      carbs_100g: 10,
      fat_100g: 3,
      verified: false,
      owner_user_id: null,  // ← policy blocks this
    });
    expect(error).not.toBeNull();
  });
});

// ── Foods: UPDATE ─────────────────────────────────────────────────────────────

describe("foods — UPDATE policies", () => {
  it("user can update their own private food", async () => {
    const { error } = await clientA.from("foods")
      .update({ name: "Updated Name" })
      .eq("id", userAFoodId);
    expect(error).toBeNull();
  });

  it("user cannot update another user's private food", async () => {
    const { error } = await clientA.from("foods")
      .update({ name: "Hijacked" })
      .eq("id", userBFoodId);
    // The update silently affects 0 rows (RLS filters the target row).
    // Supabase returns no error but also no changed rows.
    expect(error).toBeNull();

    // Verify the food was not modified
    const { data } = await svcClient().from("foods").select("name").eq("id", userBFoodId).single();
    expect(data!.name).toBe("UserB Private Food");
  });
});

// ── Meals: cross-user isolation ───────────────────────────────────────────────

describe("meals — cross-user isolation", () => {
  let mealAId = "";

  beforeAll(async () => {
    // Insert a meal for userA via the service role
    const { data } = await svcClient().from("meals").insert({
      user_id: userAId,
      meal_type: "breakfast",
      meal_confidence: "high",
      eaten_at: new Date().toISOString(),
      logged_date: "2026-07-23",
    }).select("id").single();
    mealAId = data!.id;
  });

  afterAll(async () => {
    await svcClient().from("meals").delete().eq("id", mealAId);
  });

  it("userA can see their own meal", async () => {
    const { data, error } = await clientA.from("meals").select("id").eq("id", mealAId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(mealAId);
  });

  it("userB cannot see userA's meal", async () => {
    const { data } = await clientB.from("meals").select("id").eq("id", mealAId).maybeSingle();
    expect(data).toBeNull();
  });

  it("unauthenticated client cannot see any meals", async () => {
    const { data } = await anonClient().from("meals").select("id").eq("id", mealAId).maybeSingle();
    expect(data).toBeNull();
  });
});

// ── Shared tables ─────────────────────────────────────────────────────────────

describe("global_food_cache — readable by authenticated users", () => {
  it("authenticated user can SELECT from global_food_cache", async () => {
    const { error } = await clientA.from("global_food_cache").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("unauthenticated client can SELECT from global_food_cache", async () => {
    const { error } = await anonClient().from("global_food_cache").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("authenticated user cannot INSERT into global_food_cache", async () => {
    const { error } = await clientA.from("global_food_cache").insert({
      query: "test", food_id: globalFoodId, score: 1,
    });
    expect(error).not.toBeNull();
  });
});

describe("food_synonyms — readable by all, not writable by users", () => {
  it("authenticated user can SELECT from food_synonyms", async () => {
    const { error } = await clientA.from("food_synonyms").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("authenticated user cannot INSERT into food_synonyms", async () => {
    const { error } = await clientA.from("food_synonyms").insert({ synonym: "hack", canonical_name: "hack" });
    expect(error).not.toBeNull();
  });
});

describe("system_settings — readable by all, not writable by users", () => {
  it("authenticated user can SELECT from system_settings", async () => {
    const { error } = await clientA.from("system_settings").select("*").limit(1);
    expect(error).toBeNull();
  });

  it("authenticated user cannot INSERT into system_settings", async () => {
    const { error } = await clientA.from("system_settings").insert({ key: "test", value: "test" });
    expect(error).not.toBeNull();
  });
});

describe("api_cache — inaccessible to regular users (service role only)", () => {
  it("authenticated user cannot SELECT from api_cache", async () => {
    const { data, error } = await clientA.from("api_cache").select("*").limit(1);
    // RLS is enabled with zero user-facing policies — returns empty or errors
    expect(data).toEqual([]);
    // Note: Supabase returns an empty array (not an error) when RLS blocks all rows
  });

  it("authenticated user cannot INSERT into api_cache", async () => {
    const { error } = await clientA.from("api_cache").insert({
      cache_key: "test",
      provider: "test",
      payload_json: {},
      expires_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });
});
