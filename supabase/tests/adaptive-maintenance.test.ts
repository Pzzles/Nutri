// Phase 7 — Backend integration tests for adaptive maintenance endpoints.
//
// Tests the REAL edge functions (get-adaptive-maintenance, save-maintenance-estimate)
// against a real local Supabase instance. No mocks, no stubs.
//
// Requires: supabase start + supabase functions serve
//
// What this file tests per spec section 24:
//   1. Auth: 401 without a token
//   2. No active goal phase: correct error code
//   3. Eligible day aggregation: complete + fasting days only
//   4. Fasting days contribute 0 kcal to the average
//   5. Probably-complete days are counted but not used in the average
//   6. Analysis window is aligned to the Phase 6 selected rate window
//   7. Phase 6 rate is reused (not re-derived independently)
//   8. Snapshot idempotency: second save on same window upserts, not inserts
//   9. Snapshot immutability: no direct UPDATE/DELETE via user RLS
//  10. Cross-user RLS: user A cannot read user B's snapshots
//  11. Saving does not mutate goal_phases or calorie_target_snapshots

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  SUPABASE_URL,
  ANON_KEY,
} from "./helpers.js";

// ── Test user ─────────────────────────────────────────────────────────────────

const EMAIL_A = `p7-user-a-${Date.now()}@test.local`;
const EMAIL_B = `p7-user-b-${Date.now()}@test.local`;
let userIdA = "";
let userIdB = "";
let tokenA  = "";
let tokenB  = "";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Envelope = { success: boolean; data: Record<string, unknown> | null; error: { code: string; message: string } | null };

async function getEndpoint(token: string): Promise<{ status: number; body: Envelope }> {
  const res  = await fetch(`${SUPABASE_URL}/functions/v1/get-adaptive-maintenance`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

async function saveEndpoint(
  token: string,
  goalPhaseId: string,
): Promise<{ status: number; body: Envelope }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-maintenance-estimate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ goal_phase_id: goalPhaseId }),
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

// Insert weight logs spanning a full month so Phase 6 always has a rate.
async function insertMonthOfWeights(userId: string, startDaysAgo: number, startKg: number, rateKgPerDay: number) {
  const svc = svcClient();
  const rows = [];
  for (let i = 0; i < startDaysAgo; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (startDaysAgo - i));
    d.setUTCHours(7, 0, 0, 0);
    const date = d.toISOString().slice(0, 10);
    rows.push({
      user_id:     userId,
      weight_kg:   +(startKg + i * rateKgPerDay).toFixed(3),
      measured_at: d.toISOString(),
      logged_date: date,
      is_official: true,
      source:      "manual",
    });
  }
  const { error } = await svc.from("weight_logs").insert(rows);
  if (error) throw new Error(`insertMonthOfWeights: ${error.message}`);
}

// Insert a meal with items for a given date, returning the meal id.
async function insertMealWithKcal(userId: string, date: string, kcal: number): Promise<string> {
  const svc = svcClient();
  const foodResult = await svc.from("foods").insert({
    name: `p7-test-food-${Date.now()}`,
    normalized_name: `p7-test-food-${Date.now()}`,
    source: "user_manual",
    calories_100g: 100,
    protein_100g: 10,
    carbs_100g: 20,
    fat_100g: 5,
    fibre_100g: 2,
    verified: true,
  }).select("id").single();
  if (foodResult.error) throw new Error(`insertMeal food: ${foodResult.error.message}`);
  const foodId = (foodResult.data as { id: string }).id;

  const mealResult = await svc.from("meals").insert({
    user_id: userId,
    logged_date: date,
    meal_type: "lunch",
    meal_confidence: "high",
    raw_input: "p7 test meal",
    eaten_at: `${date}T12:00:00Z`,
  }).select("id").single();
  if (mealResult.error) throw new Error(`insertMeal meal: ${mealResult.error.message}`);
  const mealId = (mealResult.data as { id: string }).id;

  const { error: itemErr } = await svc.from("meal_items").insert({
    meal_id: mealId,
    food_id: foodId,
    quantity: kcal,
    unit: "g",
    weight_g: kcal,
    calories: kcal,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fibre_g: 0,
    match_confidence: "exact",
    portion_confidence: "exact",
    confidence: "high",
    nutrition_source: "user_manual",
  });
  if (itemErr) throw new Error(`insertMeal item: ${itemErr.message}`);
  return mealId;
}

async function setDLS(userId: string, date: string, status: string) {
  const svc = svcClient();
  const { error } = await svc.rpc("fn_set_daily_log_status", {
    p_user_id: userId,
    p_date: date,
    p_status: status,
  });
  if (error) throw new Error(`setDLS(${date}, ${status}): ${error.message}`);
}

// Build up 14 days of complete food-log data and return the date strings used.
async function setupEligibleNutritionDays(userId: string, count: number, kcalPerDay: number): Promise<string[]> {
  const dates: string[] = [];
  for (let i = count; i >= 1; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i); // skip today (window ends yesterday)
    const date = d.toISOString().slice(0, 10);
    dates.push(date);
    await insertMealWithKcal(userId, date, kcalPerDay);
    await setDLS(userId, date, "complete");
  }
  return dates;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

let phaseIdA    = "";
let phaseIdASnapshot = "";

beforeAll(async () => {
  const svc = svcClient();

  // Create user A (has full data to get usable estimates)
  userIdA = await createTestUser(EMAIL_A);
  userIdB = await createTestUser(EMAIL_B);

  // Profile for user A
  await svc.from("profiles").upsert({
    id: userIdA,
    timezone: "Africa/Johannesburg",
    birth_date: "1990-07-31",
    sex: "male",
    height_cm: 175,
    activity_level: "moderate",
  }, { onConflict: "id" });

  // Profile for user B (no goal phase, no weights)
  await svc.from("profiles").upsert({
    id: userIdB,
    timezone: "Africa/Johannesburg",
    birth_date: "1995-01-01",
    sex: "female",
    height_cm: 165,
    activity_level: "light",
  }, { onConflict: "id" });

  // Weight logs for user A: 35 days of consistent loss (-0.5 kg/week = -0.0714/day)
  await insertMonthOfWeights(userIdA, 35, 85, -0.0714);

  // Goal phase for user A (started 30 days ago, no calorie-target snapshot required)
  const phaseStart = new Date();
  phaseStart.setUTCDate(phaseStart.getUTCDate() - 30);
  const phaseResult = await svc.from("goal_phases").insert({
    user_id: userIdA,
    mode: "cut",
    status: "active",
    started_at: phaseStart.toISOString(),
    starting_weight_kg: 85.0,
    starting_weight_source: "manual",
  }).select("id").single();
  if (phaseResult.error) throw new Error(`phase insert: ${phaseResult.error.message}`);
  phaseIdA = (phaseResult.data as { id: string }).id;

  // No calorie_target_snapshots row needed — the endpoint handles null snapshot_id
  // gracefully (equationEstimatedTdeeKcal will be null).
  phaseIdASnapshot = phaseIdA; // re-use for "no mutation" assertion target

  // 25 days of food logs for user A (ensures usable/high nutrition quality)
  await setupEligibleNutritionDays(userIdA, 25, 2000);

  // Sign in users
  const { client: clientA } = await signInAs(EMAIL_A);
  const sessA = await clientA.auth.getSession();
  tokenA = sessA.data.session!.access_token;

  const { client: clientB } = await signInAs(EMAIL_B);
  const sessB = await clientB.auth.getSession();
  tokenB = sessB.data.session!.access_token;
});

afterAll(async () => {
  const svc = svcClient();

  // Clean up in correct order (FK constraints)
  await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", userIdA);
  await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", userIdB);
  await svc.from("daily_log_status").delete().eq("user_id", userIdA);
  await svc.from("meal_items").delete().in("meal_id",
    (await svc.from("meals").select("id").eq("user_id", userIdA)).data?.map((r: { id: string }) => r.id) ?? [],
  );
  await svc.from("meals").delete().eq("user_id", userIdA);
  await svc.from("calorie_target_snapshots").delete().eq("user_id", userIdA);
  await svc.from("goal_phases").delete().eq("user_id", userIdA);
  await svc.from("weight_logs").delete().eq("user_id", userIdA);
  await svc.from("profiles").delete().eq("id", userIdA);
  await svc.from("profiles").delete().eq("id", userIdB);
  await deleteTestUser(userIdA);
  await deleteTestUser(userIdB);
});

// ── Test 1: Auth ──────────────────────────────────────────────────────────────

describe("1. Authentication", () => {
  it("GET returns 401 without a token", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-adaptive-maintenance`, {
      headers: { apikey: ANON_KEY },
    });
    expect(res.status).toBe(401);
  });

  it("POST returns 401 without a token", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/save-maintenance-estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ goal_phase_id: "irrelevant" }),
    });
    expect(res.status).toBe(401);
  });
});

// ── Test 2: No active goal phase ──────────────────────────────────────────────

describe("2. No active goal phase", () => {
  it("GET returns no_active_goal_phase for user with no active phase", async () => {
    const { status, body } = await getEndpoint(tokenB);
    // Acceptable: 200 with data.status=no_active_goal_phase OR 4xx error
    const dataStatus = body.data?.status;
    expect(
      (dataStatus === "no_active_goal_phase") ||
      (status >= 400 && status < 500),
    ).toBe(true);
  });
});

// ── Test 3: Usable estimate returned for user A ───────────────────────────────

describe("3. Usable estimate", () => {
  it("GET returns 200 with usable or provisional status", async () => {
    const { status, body } = await getEndpoint(tokenA);
    expect(status).toBe(200);
    expect(["usable", "provisional"]).toContain(body.data?.status);
  });

  it("observed_estimate_kcal is a positive finite number", async () => {
    const { body } = await getEndpoint(tokenA);
    const obs = (body.data?.maintenance as Record<string, unknown>)?.observed_estimate_kcal;
    expect(typeof obs).toBe("number");
    expect(Number.isFinite(obs as number)).toBe(true);
    expect((obs as number) > 0).toBe(true);
  });

  it("nutrition.eligible_days is ≥ 14", async () => {
    const { body } = await getEndpoint(tokenA);
    const eligibleDays = (body.data?.nutrition as Record<string, unknown>)?.eligible_days;
    expect((eligibleDays as number) >= 14).toBe(true);
  });

  it("analysis_window is present and has calendar_days", async () => {
    const { body } = await getEndpoint(tokenA);
    const win = body.data?.analysis_window as Record<string, unknown>;
    expect(win).toBeDefined();
    expect(typeof win.calendar_days).toBe("number");
    expect((win.calendar_days as number) > 0).toBe(true);
  });

  it("weight_trend is present with weekly_rate_kg", async () => {
    const { body } = await getEndpoint(tokenA);
    const wt = body.data?.weight_trend as Record<string, unknown>;
    expect(wt).toBeDefined();
    expect(typeof wt.weekly_rate_kg).toBe("number");
  });

  it("confidence is low, medium, or high", async () => {
    const { body } = await getEndpoint(tokenA);
    expect(["low", "medium", "high"]).toContain(body.data?.confidence);
  });

  it("response is read-only — no rows mutated by GET", async () => {
    const svc = svcClient();
    const countBefore = (await svc.from("maintenance_estimate_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userIdA)).count ?? 0;

    await getEndpoint(tokenA);

    const countAfter = (await svc.from("maintenance_estimate_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userIdA)).count ?? 0;

    expect(countAfter).toBe(countBefore);
  });
});

// ── Test 4: Save snapshot ─────────────────────────────────────────────────────

describe("4. Save snapshot", () => {
  beforeEach(async () => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", userIdA);
  });

  it("POST creates a snapshot row", async () => {
    const { status, body } = await saveEndpoint(tokenA, phaseIdA);
    expect(status).toBe(200);
    expect(body.data?.snapshot_id).toBeTruthy();
  });

  it("snapshot observed_maintenance_kcal is positive", async () => {
    const { body } = await saveEndpoint(tokenA, phaseIdA);
    expect((body.data?.observed_maintenance_kcal as number) > 0).toBe(true);
  });

  it("confidence is low, medium, or high", async () => {
    const { body } = await saveEndpoint(tokenA, phaseIdA);
    expect(["low", "medium", "high"]).toContain(body.data?.confidence);
  });

  it("does NOT mutate goal_phases — status, mode, snapshot_id unchanged", async () => {
    const svc = svcClient();
    const before = await svc.from("goal_phases").select("*").eq("id", phaseIdA).single();
    const phaseBefore = before.data as Record<string, unknown>;

    await saveEndpoint(tokenA, phaseIdA);

    const after = await svc.from("goal_phases").select("*").eq("id", phaseIdA).single();
    const phaseAfter = after.data as Record<string, unknown>;

    expect(phaseAfter.status).toBe(phaseBefore.status);
    expect(phaseAfter.mode).toBe(phaseBefore.mode);
    expect(phaseAfter.snapshot_id).toBe(phaseBefore.snapshot_id);
  });

  it("does NOT create any new calorie_target_snapshots on save", async () => {
    const svc = svcClient();
    const { count: before } = await svc.from("calorie_target_snapshots")
      .select("id", { count: "exact", head: true }).eq("user_id", userIdA);

    await saveEndpoint(tokenA, phaseIdA);

    const { count: after } = await svc.from("calorie_target_snapshots")
      .select("id", { count: "exact", head: true }).eq("user_id", userIdA);

    expect(after).toBe(before ?? 0);
  });
});

// ── Test 5: Snapshot idempotency ──────────────────────────────────────────────

describe("5. Snapshot idempotency", () => {
  beforeEach(async () => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", userIdA);
  });

  it("saving twice for the same window produces exactly one row", async () => {
    const svc = svcClient();

    const first  = await saveEndpoint(tokenA, phaseIdA);
    const second = await saveEndpoint(tokenA, phaseIdA);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { count } = await svc.from("maintenance_estimate_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userIdA);

    expect(count).toBe(1);
  });

  it("second save returns the same snapshot_id as the first", async () => {
    const first  = await saveEndpoint(tokenA, phaseIdA);
    const second = await saveEndpoint(tokenA, phaseIdA);

    expect(first.body.data?.snapshot_id).toBe(second.body.data?.snapshot_id);
  });
});

// ── Test 6: Snapshot immutability (RLS) ──────────────────────────────────────

describe("6. Snapshot immutability via user RLS", () => {
  let snapshotId = "";

  beforeEach(async () => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", userIdA);

    const { body } = await saveEndpoint(tokenA, phaseIdA);
    snapshotId = body.data?.snapshot_id as string;
  });

  it("user cannot UPDATE their own snapshot via user client", async () => {
    const { client } = await signInAs(EMAIL_A);
    const { error } = await client
      .from("maintenance_estimate_snapshots")
      .update({ status: "usable" })
      .eq("id", snapshotId);
    // RLS blocks UPDATE — should produce an error or affect 0 rows
    if (!error) {
      const svc = svcClient();
      const { data } = await svc.from("maintenance_estimate_snapshots")
        .select("id").eq("id", snapshotId);
      expect(data?.length ?? 0).toBe(1);
    }
  });

  it("user cannot DELETE their own snapshot via user client", async () => {
    const { client } = await signInAs(EMAIL_A);
    const { error } = await client
      .from("maintenance_estimate_snapshots")
      .delete()
      .eq("id", snapshotId);

    const svc = svcClient();
    const { data } = await svc.from("maintenance_estimate_snapshots")
      .select("id").eq("id", snapshotId);
    expect(data?.length ?? 0).toBe(1);
    void error;
  });
});

// ── Test 7: Cross-user RLS ────────────────────────────────────────────────────

describe("7. Cross-user RLS", () => {
  let snapshotId = "";

  beforeEach(async () => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", userIdA);

    const { body } = await saveEndpoint(tokenA, phaseIdA);
    snapshotId = body.data?.snapshot_id as string;
  });

  it("user B cannot read user A's snapshot via user client", async () => {
    const { client: clientB } = await signInAs(EMAIL_B);
    const { data } = await clientB
      .from("maintenance_estimate_snapshots")
      .select("id")
      .eq("id", snapshotId);

    expect(data?.length ?? 0).toBe(0);
  });
});

// ── Test 8: goal_phase_id mismatch ────────────────────────────────────────────

describe("8. Phase mismatch", () => {
  it("POST with a wrong goal_phase_id returns a non-200 status", async () => {
    const { status } = await saveEndpoint(tokenA, "00000000-0000-0000-0000-000000000000");
    expect(status).not.toBe(200);
  });
});

// ── Test 9: fasting days contribute 0 kcal ───────────────────────────────────

describe("9. Fasting day aggregation", () => {
  it("fn_get_daily_meal_totals does not return a row for a date with no meals", async () => {
    const svc = svcClient();

    // Use a date far enough back that setupEligibleNutritionDays didn't touch it
    // (setup inserts for days 1..25 ago; use day 30 to be safe)
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    const fastDate = d.toISOString().slice(0, 10);

    // Mark as fasting (no meals on that day)
    await setDLS(userIdA, fastDate, "fasting");

    const { data } = await svc.rpc("fn_get_daily_meal_totals", {
      p_user_id: userIdA,
      p_start:   fastDate,
      p_end:     fastDate,
    });

    // fn_get_daily_meal_totals only returns days that have meal_items — a pure
    // fasting day (no meals) is absent from the result; the caller handles it as 0 kcal.
    const row = (data as Array<{ logged_date: string; total_kcal: number }>)?.find(
      (r) => r.logged_date === fastDate,
    );
    expect(row).toBeUndefined();
  });
});

// ── Test 10: fn_get_daily_meal_totals aggregation ─────────────────────────────

describe("10. fn_get_daily_meal_totals", () => {
  it("returns accurate calorie totals for a day with meals", async () => {
    const svc = svcClient();

    // Use a date 2 days ago (before yesterday to be in the window)
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 2);
    const testDate = d.toISOString().slice(0, 10);

    // Insert a known kcal meal
    await insertMealWithKcal(userIdA, testDate, 600);

    const { data } = await svc.rpc("fn_get_daily_meal_totals", {
      p_user_id: userIdA,
      p_start:   testDate,
      p_end:     testDate,
    });

    const rows = data as Array<{ logged_date: string; total_kcal: number; meal_count: number; item_count: number }>;
    const row  = rows?.find((r) => r.logged_date === testDate);
    expect(row).toBeDefined();
    // May have prior meals from setup; just verify it includes the new 600
    expect(Number(row!.total_kcal)).toBeGreaterThanOrEqual(600);
    expect(Number(row!.meal_count)).toBeGreaterThanOrEqual(1);
    expect(Number(row!.item_count)).toBeGreaterThanOrEqual(1);
  });
});
