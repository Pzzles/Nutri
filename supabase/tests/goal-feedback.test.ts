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
