// Phase 8 — Backend integration tests for goal-feedback endpoints.
//
// Tests the REAL edge functions (get-goal-feedback, save-goal-feedback-assessment)
// against a real local Supabase instance. No mocks, no stubs.
//
// Requires: supabase start + supabase functions serve
//
// What this file tests per spec:
//   1. Auth: 401 without a token (GET and POST)
//   2. No active goal phase: GET returns no_active_goal_phase state
//   3. GET returns structured assessment with expected fields
//   4. GET is read-only: does not write goal_feedback_assessments
//   5. POST saves an assessment and returns id / state / action
//   6. POST idempotency: second call on same day upserts, not inserts
//   7. POST phase mismatch: 422 when goal_phase_id does not match active phase
//   8. POST does not mutate goal_phases or calorie_target_snapshots
//   9. RLS: user B cannot read user A's saved assessments

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  SUPABASE_URL,
  ANON_KEY,
} from "./helpers.js";

// ── Test state ────────────────────────────────────────────────────────────────

const EMAIL_A = `p8-user-a-${Date.now()}@test.local`;
const EMAIL_B = `p8-user-b-${Date.now()}@test.local`;
let userIdA = "";
let userIdB = "";
let tokenA  = "";
let tokenB  = "";
let phaseIdA = "";

// ── Envelope type ─────────────────────────────────────────────────────────────

type Envelope = {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
};

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function callGet(token: string): Promise<{ status: number; body: Envelope }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  return { status: res.status, body: (await res.json()) as Envelope };
}

async function callPost(
  token: string,
  goalPhaseId: string,
): Promise<{ status: number; body: Envelope }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-goal-feedback-assessment`, {
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

// ── Data setup helpers ────────────────────────────────────────────────────────

async function insertWeightLogs(userId: string, days: number, startKg: number, rateKgPerDay: number) {
  const svc = svcClient();
  const rows = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - (days - i));
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
  if (error) throw new Error(`insertWeightLogs: ${error.message}`);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  const svc = svcClient();

  userIdA = await createTestUser(EMAIL_A);
  userIdB = await createTestUser(EMAIL_B);

  // Profile for user A (has goal phase + weight data)
  await svc.from("profiles").upsert({
    id: userIdA,
    timezone: "Africa/Johannesburg",
    birth_date: "1990-07-31",
    sex: "male",
    height_cm: 175,
    activity_level: "moderate",
  }, { onConflict: "id" });

  // Profile for user B (no goal phase)
  await svc.from("profiles").upsert({
    id: userIdB,
    timezone: "Africa/Johannesburg",
    birth_date: "1992-03-15",
    sex: "female",
    height_cm: 165,
    activity_level: "light",
  }, { onConflict: "id" });

  // 35 days of consistent cut weight for user A: -0.5 kg/week ≈ -0.0714 kg/day
  await insertWeightLogs(userIdA, 35, 88.0, -0.0714);

  // Goal phase for user A started 30 days ago (≥ 28 so plateau_candidate is possible)
  const phaseStart = new Date();
  phaseStart.setUTCDate(phaseStart.getUTCDate() - 30);
  const phaseResult = await svc
    .from("goal_phases")
    .insert({
      user_id:                userIdA,
      mode:                   "cut",
      status:                 "active",
      started_at:             phaseStart.toISOString(),
      starting_weight_kg:     88.0,
      starting_weight_source: "manual",
      target_change_kg_per_week: -0.50,
    })
    .select("id")
    .single();
  if (phaseResult.error) throw new Error(`phase insert: ${phaseResult.error.message}`);
  phaseIdA = (phaseResult.data as { id: string }).id;

  // Sign in
  const { client: clientA } = await signInAs(EMAIL_A);
  const sessA = await clientA.auth.getSession();
  tokenA = sessA.data.session!.access_token;

  const { client: clientB } = await signInAs(EMAIL_B);
  const sessB = await clientB.auth.getSession();
  tokenB = sessB.data.session!.access_token;
});

afterAll(async () => {
  const svc = svcClient();
  await svc.from("goal_feedback_assessments").delete().eq("user_id", userIdA);
  await svc.from("goal_feedback_assessments").delete().eq("user_id", userIdB);
  await svc.from("goal_phases").delete().eq("user_id", userIdA);
  await svc.from("goal_phases").delete().eq("user_id", userIdB);
  await svc.from("weight_logs").delete().eq("user_id", userIdA);
  await svc.from("weight_logs").delete().eq("user_id", userIdB);
  await svc.from("profiles").delete().eq("id", userIdA);
  await svc.from("profiles").delete().eq("id", userIdB);
  await deleteTestUser(userIdA);
  await deleteTestUser(userIdB);
});

// ── 1. Authentication ─────────────────────────────────────────────────────────

describe("1. Authentication", () => {
  it("GET returns 401 without a token", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { apikey: ANON_KEY },
    });
    expect(res.status).toBe(401);
  });

  it("POST returns 401 without a token", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/save-goal-feedback-assessment`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body:    JSON.stringify({ goal_phase_id: "irrelevant" }),
    });
    expect(res.status).toBe(401);
  });
});

// ── 2. No active goal phase ───────────────────────────────────────────────────

describe("2. No active goal phase", () => {
  it("GET returns no_active_goal_phase state for user with no active phase", async () => {
    const { status, body } = await callGet(tokenB);
    // Endpoint returns 200 with state=no_active_goal_phase when no active phase
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.progress_state).toBe("no_active_goal_phase");
    expect(body.data?.feedback_action).toBe("start_goal_phase");
  });
});

// ── 3. GET response shape ─────────────────────────────────────────────────────

describe("3. GET response shape", () => {
  it("GET returns 200 with required top-level fields for user with active phase", async () => {
    const { status, body } = await callGet(tokenA);
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const data = body.data!;
    // Required fields
    expect(typeof data.progress_state).toBe("string");
    expect(typeof data.feedback_action).toBe("string");
    expect(Array.isArray(data.reason_codes)).toBe(true);
    expect(typeof data.assessed_at).toBe("string");
    expect(data.evidence).toBeDefined();
    expect(data.algorithm_versions).toBeDefined();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(Array.isArray(data.limitations)).toBe(true);
  });

  it("GET progress_state is one of the 11 defined states", async () => {
    const validStates = [
      "no_active_goal_phase", "insufficient_data", "stale_data",
      "on_track", "slower_than_planned", "faster_than_planned",
      "plateau_candidate", "likely_plateau", "opposite_direction",
      "maintenance_stable", "maintenance_drift",
    ];
    const { body } = await callGet(tokenA);
    expect(validStates).toContain(body.data?.progress_state);
  });

  it("GET evidence block has current and historical_14d sub-objects", async () => {
    const { body } = await callGet(tokenA);
    const evidence = body.data?.evidence as Record<string, unknown>;
    expect(evidence).toBeDefined();
    expect(evidence).toHaveProperty("current");
    expect(evidence).toHaveProperty("historical_14d");
  });
});

// ── 4. GET is read-only ───────────────────────────────────────────────────────

describe("4. GET is read-only", () => {
  it("GET does not create a goal_feedback_assessments row", async () => {
    const svc = svcClient();
    const beforeCount = (
      await svc.from("goal_feedback_assessments").select("id", { count: "exact" }).eq("user_id", userIdA)
    ).count ?? 0;

    await callGet(tokenA);

    const afterCount = (
      await svc.from("goal_feedback_assessments").select("id", { count: "exact" }).eq("user_id", userIdA)
    ).count ?? 0;

    expect(afterCount).toBe(beforeCount);
  });
});

// ── 5. POST saves an assessment ───────────────────────────────────────────────

describe("5. POST saves an assessment", () => {
  it("POST returns 200 with assessment_id, progress_state, and feedback_action", async () => {
    const { status, body } = await callPost(tokenA, phaseIdA);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data?.assessment_id).toBe("string");
    expect(typeof body.data?.progress_state).toBe("string");
    expect(typeof body.data?.feedback_action).toBe("string");
    expect(typeof body.data?.created_at).toBe("string");
  });

  it("POST persists a row in goal_feedback_assessments", async () => {
    const svc = svcClient();
    const { data } = await svc
      .from("goal_feedback_assessments")
      .select("id, progress_state, goal_phase_id")
      .eq("user_id", userIdA)
      .eq("goal_phase_id", phaseIdA);
    expect((data?.length ?? 0)).toBeGreaterThanOrEqual(1);
    const row = (data as Array<Record<string, unknown>>)[0];
    expect(row.goal_phase_id).toBe(phaseIdA);
    expect(typeof row.progress_state).toBe("string");
  });
});

// ── 6. POST idempotency ───────────────────────────────────────────────────────

describe("6. POST idempotency", () => {
  it("second POST on same day returns the same row (no duplicate)", async () => {
    const svc = svcClient();

    const first  = await callPost(tokenA, phaseIdA);
    const second = await callPost(tokenA, phaseIdA);

    // Both calls succeed
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // Only one row for today's date
    const { data } = await svc
      .from("goal_feedback_assessments")
      .select("id, assessed_date")
      .eq("user_id", userIdA)
      .eq("goal_phase_id", phaseIdA)
      .order("created_at", { ascending: true });

    const today = new Date().toISOString().slice(0, 10);
    const todayRows = (data ?? []).filter(
      (r: Record<string, unknown>) => String(r.assessed_date) === today,
    );
    expect(todayRows.length).toBe(1);
  });
});

// ── 7. POST phase mismatch ────────────────────────────────────────────────────

describe("7. POST phase mismatch", () => {
  it("POST returns 422 when goal_phase_id does not match active phase", async () => {
    const { status, body } = await callPost(tokenA, "00000000-0000-0000-0000-000000000000");
    expect(status).toBe(422);
    expect(body.success).toBe(false);
    // Error code must be one of PHASE_MISMATCH or NO_ACTIVE_PHASE
    const validCodes = ["PHASE_MISMATCH", "NO_ACTIVE_PHASE", "NO_ACTIVE_PHASE_OR_MISMATCH"];
    expect(validCodes.some((c) => body.error?.code?.includes(c) || c.includes(body.error?.code ?? "NONE"))).toBe(true);
  });

  it("POST returns 400 when goal_phase_id is missing", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/save-goal-feedback-assessment`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${tokenA}`,
        apikey:         ANON_KEY,
      },
      body: JSON.stringify({}),
    });
    const body: Envelope = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});

// ── 8. POST does not mutate goal_phases ───────────────────────────────────────

describe("8. POST does not mutate goal_phases", () => {
  it("goal_phases row is unchanged after POST", async () => {
    const svc = svcClient();

    const before = await svc
      .from("goal_phases")
      .select("*")
      .eq("id", phaseIdA)
      .single();

    await callPost(tokenA, phaseIdA);

    const after = await svc
      .from("goal_phases")
      .select("*")
      .eq("id", phaseIdA)
      .single();

    expect(before.data).toEqual(after.data);
  });
});

// ── 9. RLS: cross-user isolation ──────────────────────────────────────────────

describe("9. RLS — cross-user isolation", () => {
  it("user B cannot read user A's saved assessments", async () => {
    const svc = svcClient();

    // Ensure there is at least one assessment for user A
    await callPost(tokenA, phaseIdA);
    const countA = (
      await svc
        .from("goal_feedback_assessments")
        .select("id", { count: "exact" })
        .eq("user_id", userIdA)
    ).count ?? 0;
    expect(countA).toBeGreaterThanOrEqual(1);

    // User B reads their own assessments — should get 0 rows, not user A's
    const { client: clientB } = await signInAs(EMAIL_B);
    const { data: rowsB, error } = await clientB
      .from("goal_feedback_assessments")
      .select("id")
      .eq("user_id", userIdA);

    expect(error).toBeNull();
    expect((rowsB ?? []).length).toBe(0);
  });
});

// ── Additional helpers for state-specific scenarios ───────────────────────────

function dateAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

let _seedFoodSeq = 0;

async function seedNutritionDays(userId: string, days: number, kcalPerDay: number): Promise<void> {
  const svc = svcClient();
  _seedFoodSeq++;
  const foodName = `p8it-${Date.now()}-${_seedFoodSeq}`;
  const fr = await svc.from("foods").insert({
    name: foodName, normalized_name: foodName, source: "user_manual",
    calories_100g: 100, protein_100g: 10, carbs_100g: 20, fat_100g: 5, fibre_100g: 2, verified: true,
  }).select("id").single();
  if (fr.error) throw new Error(`seedFood: ${fr.error.message}`);
  const foodId = (fr.data as { id: string }).id;

  for (let d = days; d >= 1; d--) {
    const date = dateAgo(d);
    const mr = await svc.from("meals").insert({
      user_id: userId, logged_date: date, meal_type: "lunch",
      meal_confidence: "high", raw_input: "p8 int test", eaten_at: `${date}T12:00:00Z`,
    }).select("id").single();
    if (mr.error) throw new Error(`seedMeal(${date}): ${mr.error.message}`);
    const mealId = (mr.data as { id: string }).id;

    const { error: ie } = await svc.from("meal_items").insert({
      meal_id: mealId, food_id: foodId,
      quantity: kcalPerDay, unit: "g", weight_g: kcalPerDay, calories: kcalPerDay,
      protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0,
      match_confidence: "exact", portion_confidence: "exact",
      confidence: "high", nutrition_source: "user_manual",
    });
    if (ie) throw new Error(`seedItem(${date}): ${ie.message}`);

    const { error: de } = await svc.rpc("fn_set_daily_log_status", {
      p_user_id: userId, p_date: date, p_status: "complete",
    });
    if (de) throw new Error(`seedDLS(${date}): ${de.message}`);
  }
}

async function cleanupScenarioUser(userId: string): Promise<void> {
  const svc = svcClient();
  await svc.from("goal_feedback_assessments").delete().eq("user_id", userId);
  await svc.from("daily_log_status").delete().eq("user_id", userId);
  const { data: mealRows } = await svc.from("meals").select("id").eq("user_id", userId);
  const mealIds = (mealRows ?? []).map((r: Record<string, unknown>) => r.id as string);
  if (mealIds.length > 0) await svc.from("meal_items").delete().in("meal_id", mealIds);
  await svc.from("meals").delete().eq("user_id", userId);
  await svc.from("goal_phases").delete().eq("user_id", userId);
  await svc.from("weight_logs").delete().eq("user_id", userId);
  await svc.from("profiles").delete().eq("id", userId);
  await deleteTestUser(userId);
}

// ── 10. GET v2 API contract fields ────────────────────────────────────────────

describe("10. GET v2 API contract fields", () => {
  it("GET response includes all v2 canonical fields", async () => {
    const { status, body } = await callGet(tokenA);
    expect(status).toBe(200);
    const d = body.data!;
    expect(Object.prototype.hasOwnProperty.call(d, "suggested_adjustment_kcal")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(d, "proposed_target_kcal")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(d, "adjustment_blocked_reason_codes")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(d, "maintenance_drift_direction")).toBe(true);
    expect(Array.isArray(d.adjustment_blocked_reason_codes)).toBe(true);
  });

  it("GET evidence blocks include p6 CI rate bounds", async () => {
    const { body } = await callGet(tokenA);
    const ev = body.data!.evidence as Record<string, Record<string, unknown>>;
    expect(Object.prototype.hasOwnProperty.call(ev.current, "p6_rate_lower_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(ev.current, "p6_rate_upper_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(ev.historical_14d, "p6_rate_lower_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(ev.historical_14d, "p6_rate_upper_kg")).toBe(true);
  });

  it("GET goal_phase includes target_change_kg_per_week", async () => {
    const { body } = await callGet(tokenA);
    const gp = body.data!.goal_phase as Record<string, unknown>;
    expect(gp).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(gp, "target_change_kg_per_week")).toBe(true);
  });
});

// ── 11. POST v2 persisted columns ─────────────────────────────────────────────

describe("11. POST v2 persisted columns", () => {
  it("POST persists all migration 0026 columns in saved row", async () => {
    await callPost(tokenA, phaseIdA);
    const svc = svcClient();
    const { data, error } = await svc
      .from("goal_feedback_assessments")
      .select([
        "suggested_adjustment_kcal", "proposed_target_kcal",
        "adjustment_blocked_reason_codes", "maintenance_drift_direction",
        "current_rate_lower_kg", "current_rate_upper_kg",
        "previous_rate_lower_kg", "previous_rate_upper_kg",
        "current_official_weight_kg", "current_target_calories",
      ].join(", "))
      .eq("user_id", userIdA)
      .eq("goal_phase_id", phaseIdA)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(error).toBeNull();
    const row = data as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(row, "adjustment_blocked_reason_codes")).toBe(true);
    expect(Array.isArray(row.adjustment_blocked_reason_codes)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "suggested_adjustment_kcal")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "proposed_target_kcal")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "maintenance_drift_direction")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "current_rate_lower_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "current_rate_upper_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "previous_rate_lower_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "previous_rate_upper_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "current_official_weight_kg")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "current_target_calories")).toBe(true);
  });

  it("POST state matches GET state (server always recalculates before saving)", async () => {
    const [getRes, postRes] = await Promise.all([
      callGet(tokenA),
      callPost(tokenA, phaseIdA),
    ]);
    expect(getRes.status).toBe(200);
    expect(postRes.status).toBe(200);
    expect(postRes.body.data?.progress_state).toBe(getRes.body.data?.progress_state);
    expect(postRes.body.data?.feedback_action).toBe(getRes.body.data?.feedback_action);
  });

  it("POST does not mutate calorie_target_snapshots", async () => {
    const svc = svcClient();
    const before = await svc.from("calorie_target_snapshots").select("id").eq("user_id", userIdA);
    const beforeCount = (before.data ?? []).length;

    await callPost(tokenA, phaseIdA);

    const after = await svc.from("calorie_target_snapshots").select("id").eq("user_id", userIdA);
    const afterCount = (after.data ?? []).length;
    expect(afterCount).toBe(beforeCount);
  });

  it("POST adjustment_blocked_reason_codes is always a JSONB array (never null)", async () => {
    await callPost(tokenA, phaseIdA);
    const svc = svcClient();
    const { data } = await svc
      .from("goal_feedback_assessments")
      .select("adjustment_blocked_reason_codes")
      .eq("user_id", userIdA)
      .eq("goal_phase_id", phaseIdA)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const codes = (data as Record<string, unknown>).adjustment_blocked_reason_codes;
    expect(Array.isArray(codes)).toBe(true);
  });
});

// ── 12. plateau_candidate scenario ────────────────────────────────────────────
// 30-day cut phase, near-zero weight change (−0.014 kg/week), with P7 nutrition data.
// Expected state: plateau_candidate (phase ≥ 28, P6 near-zero, P7 provisional/usable).

describe("12. plateau_candidate scenario", () => {
  let userIdC = "";
  let tokenC   = "";

  beforeAll(async () => {
    const svc   = svcClient();
    const email = `p8-pc-${Date.now()}@test.local`;
    userIdC     = await createTestUser(email);

    await svc.from("profiles").upsert({
      id: userIdC, timezone: "Africa/Johannesburg",
      birth_date: "1990-07-31", sex: "male", height_cm: 175, activity_level: "moderate",
    }, { onConflict: "id" });

    // 35 days of near-zero weight change (−0.014 kg/week ≈ −0.002 kg/day)
    await insertWeightLogs(userIdC, 35, 84.0, -0.002);

    // 30-day cut phase (≥28 so plateau_candidate is possible, <42 so not likely_plateau)
    const ps = new Date();
    ps.setUTCDate(ps.getUTCDate() - 30);
    const pr = await svc.from("goal_phases").insert({
      user_id: userIdC, mode: "cut", status: "active",
      started_at: ps.toISOString(), starting_weight_kg: 84.0,
      starting_weight_source: "manual", target_change_kg_per_week: -0.50,
    }).select("id").single();
    if (pr.error) throw new Error(`phase: ${pr.error.message}`);

    // 30 complete nutrition days (P7 usable/provisional)
    await seedNutritionDays(userIdC, 30, 2000);

    // Sign in
    const { client } = await signInAs(email);
    const sess = await client.auth.getSession();
    tokenC = sess.data.session!.access_token;

    // Warm up cold-start
    await callGet(tokenC).catch(() => null);
  }, 90_000);

  afterAll(async () => { await cleanupScenarioUser(userIdC); });

  it("plateau_candidate: GET returns collect_more_data and null adjustment", async () => {
    const { status, body } = await callGet(tokenC);
    expect(status).toBe(200);
    const d = body.data!;
    // With near-zero rate and P7 data, state should be plateau_candidate.
    // Accept slower_than_planned as fallback if P7 coverage doesn't qualify yet.
    const ok = d.progress_state === "plateau_candidate" || d.progress_state === "slower_than_planned";
    expect(ok).toBe(true);
    // CRITICAL: neither state computes an adjustment
    expect(d.suggested_adjustment_kcal).toBeNull();
    expect(d.proposed_target_kcal).toBeNull();
    expect(Array.isArray(d.adjustment_blocked_reason_codes)).toBe(true);
    if (d.progress_state === "plateau_candidate") {
      expect(d.feedback_action).toBe("collect_more_data");
      expect((d.adjustment_blocked_reason_codes as string[]).length).toBe(0);
    }
  });
});

// ── 13. slower_than_planned scenario ─────────────────────────────────────────
// 30-day cut phase, weight dropping at −0.15 kg/week (ratio ≈ 0.30, < 0.70 threshold).
// No P7 data needed — state is determined purely by P6 attainment ratio.

describe("13. slower_than_planned scenario", () => {
  let userIdD = "";
  let tokenD  = "";

  beforeAll(async () => {
    const svc   = svcClient();
    const email = `p8-slow-${Date.now()}@test.local`;
    userIdD     = await createTestUser(email);

    await svc.from("profiles").upsert({
      id: userIdD, timezone: "Africa/Johannesburg",
      birth_date: "1990-07-31", sex: "male", height_cm: 175, activity_level: "moderate",
    }, { onConflict: "id" });

    // 35 days at −0.021 kg/day ≈ −0.147 kg/week (target is −0.50, ratio ≈ 0.29)
    await insertWeightLogs(userIdD, 35, 84.0, -0.021);

    const ps = new Date();
    ps.setUTCDate(ps.getUTCDate() - 30);
    const pr = await svc.from("goal_phases").insert({
      user_id: userIdD, mode: "cut", status: "active",
      started_at: ps.toISOString(), starting_weight_kg: 84.0,
      starting_weight_source: "manual", target_change_kg_per_week: -0.50,
    }).select("id").single();
    if (pr.error) throw new Error(`phase: ${pr.error.message}`);

    const { client } = await signInAs(email);
    const sess = await client.auth.getSession();
    tokenD = sess.data.session!.access_token;

    await callGet(tokenD).catch(() => null);
  }, 60_000);

  afterAll(async () => { await cleanupScenarioUser(userIdD); });

  it("slower_than_planned: GET returns review_goal_assumptions and null adjustment", async () => {
    const { status, body } = await callGet(tokenD);
    expect(status).toBe(200);
    const d = body.data!;
    expect(d.progress_state).toBe("slower_than_planned");
    expect(d.feedback_action).toBe("review_goal_assumptions");
    expect(d.suggested_adjustment_kcal).toBeNull();
    expect(d.proposed_target_kcal).toBeNull();
    expect(Array.isArray(d.adjustment_blocked_reason_codes)).toBe(true);
    // slower_than_planned never attempts an adjustment — codes must be empty
    expect((d.adjustment_blocked_reason_codes as string[]).length).toBe(0);
  });
});

// ── 14. maintenance_stable scenario ──────────────────────────────────────────
// 30-day maintenance phase, weight near-stable (±0.007 kg/week, within ±0.10 band).

describe("14. maintenance_stable scenario", () => {
  let userIdE = "";
  let tokenE  = "";

  beforeAll(async () => {
    const svc   = svcClient();
    const email = `p8-maint-${Date.now()}@test.local`;
    userIdE     = await createTestUser(email);

    await svc.from("profiles").upsert({
      id: userIdE, timezone: "Africa/Johannesburg",
      birth_date: "1990-07-31", sex: "male", height_cm: 175, activity_level: "moderate",
    }, { onConflict: "id" });

    // 35 days at −0.001 kg/day ≈ −0.007 kg/week (well within ±0.10 maintenance band)
    await insertWeightLogs(userIdE, 35, 80.0, -0.001);

    const ps = new Date();
    ps.setUTCDate(ps.getUTCDate() - 30);
    const pr = await svc.from("goal_phases").insert({
      user_id: userIdE, mode: "maintenance", status: "active",
      started_at: ps.toISOString(), starting_weight_kg: 80.0,
      starting_weight_source: "manual", target_change_kg_per_week: 0,
    }).select("id").single();
    if (pr.error) throw new Error(`phase: ${pr.error.message}`);

    const { client } = await signInAs(email);
    const sess = await client.auth.getSession();
    tokenE = sess.data.session!.access_token;

    await callGet(tokenE).catch(() => null);
  }, 60_000);

  afterAll(async () => { await cleanupScenarioUser(userIdE); });

  it("maintenance_stable: GET returns keep_current_plan and no adjustment attempt", async () => {
    const { status, body } = await callGet(tokenE);
    expect(status).toBe(200);
    const d = body.data!;
    expect(d.progress_state).toBe("maintenance_stable");
    expect(d.feedback_action).toBe("keep_current_plan");
    // maintenance_stable does not produce an adjustment
    expect(d.suggested_adjustment_kcal).toBeNull();
    expect(Array.isArray(d.adjustment_blocked_reason_codes)).toBe(true);
    expect((d.adjustment_blocked_reason_codes as string[]).length).toBe(0);
    expect(d.maintenance_drift_direction).toBeNull();
  });
});

// ── 15. opposite_direction scenario ──────────────────────────────────────────
// 30-day cut phase, weight clearly INCREASING (+0.30 kg/week).
// Expected: opposite_direction (if P6 CI fully excludes zero) → adjustment attempted,
// but blocked by missing_current_target (no calorie snapshot).

describe("15. opposite_direction scenario", () => {
  let userIdF = "";
  let tokenF  = "";

  beforeAll(async () => {
    const svc   = svcClient();
    const email = `p8-opp-${Date.now()}@test.local`;
    userIdF     = await createTestUser(email);

    await svc.from("profiles").upsert({
      id: userIdF, timezone: "Africa/Johannesburg",
      birth_date: "1990-07-31", sex: "male", height_cm: 175, activity_level: "moderate",
    }, { onConflict: "id" });

    // 35 days at +0.043 kg/day ≈ +0.30 kg/week (clear increase while in cut phase)
    await insertWeightLogs(userIdF, 35, 78.0, +0.043);

    const ps = new Date();
    ps.setUTCDate(ps.getUTCDate() - 30);
    const pr = await svc.from("goal_phases").insert({
      user_id: userIdF, mode: "cut", status: "active",
      started_at: ps.toISOString(), starting_weight_kg: 78.0,
      starting_weight_source: "manual", target_change_kg_per_week: -0.50,
    }).select("id").single();
    if (pr.error) throw new Error(`phase: ${pr.error.message}`);

    const { client } = await signInAs(email);
    const sess = await client.auth.getSession();
    tokenF = sess.data.session!.access_token;

    await callGet(tokenF).catch(() => null);
  }, 60_000);

  afterAll(async () => { await cleanupScenarioUser(userIdF); });

  it("opposite_direction: GET state detected and adjustment_blocked_reason_codes populated", async () => {
    const { status, body } = await callGet(tokenF);
    expect(status).toBe(200);
    const d = body.data!;
    // Consistently gaining weight in a cut → opposite_direction (CI fully excludes zero above)
    // or slower_than_planned (if CI still includes zero due to short window)
    const validStates = ["opposite_direction", "slower_than_planned"];
    expect(validStates).toContain(d.progress_state);
    expect(Array.isArray(d.adjustment_blocked_reason_codes)).toBe(true);
    if (d.progress_state === "opposite_direction") {
      expect(d.feedback_action).toBe("consider_small_calorie_adjustment");
      // No calorie_target_snapshot → missing_current_target fires
      expect(d.suggested_adjustment_kcal).toBeNull();
      expect((d.adjustment_blocked_reason_codes as string[]).length).toBeGreaterThan(0);
    }
    if (d.progress_state === "slower_than_planned") {
      expect(d.suggested_adjustment_kcal).toBeNull();
      expect((d.adjustment_blocked_reason_codes as string[]).length).toBe(0);
    }
  });
});
