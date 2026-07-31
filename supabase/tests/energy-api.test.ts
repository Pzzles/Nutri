// Phase 5 — API integration tests for start-goal-phase (Phase 5 path) and
// calorie_target_snapshots immutability.
//
// These tests exercise the real edge functions and real database:
//   1. preview-energy-calc does not mutate goal_phases
//   2. start-goal-phase (Phase 5 path) creates phase + snapshot atomically
//   3. Snapshot is immutable (no UPDATE/DELETE via RLS)
//   4. Aggressive rate is blocked without acknowledgement
//   5. Floor enforcement in start-goal-phase
//   6. Snapshot fields match the calculation inputs
//
// Requires: supabase start + supabase functions serve
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  SUPABASE_URL,
  ANON_KEY,
} from "./helpers.js";

const EMAIL = `energy-api-${Date.now()}@test.local`;
let userId = "";
let accessToken = "";

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  const svc = svcClient();

  await svc.from("profiles").upsert(
    {
      id: userId,
      timezone: "Africa/Johannesburg",
      birth_date: "1990-07-31",
      sex: "male",
      height_cm: 175,
      activity_level: "moderate",
    },
    { onConflict: "id" },
  );

  await svc.from("weight_logs").insert({
    user_id: userId,
    weight_kg: 80,
    measured_at: new Date().toISOString(),
    is_official: true,
    source: "manual",
  });

  const { client } = await signInAs(EMAIL);
  const { data: { session } } = await client.auth.getSession();
  accessToken = session!.access_token;
});

afterAll(async () => {
  const svc = svcClient();
  await svc.from("goal_phases").delete().eq("user_id", userId);
  await svc.from("calorie_target_snapshots").delete().eq("user_id", userId);
  await svc.from("weight_logs").delete().eq("user_id", userId);
  await svc.from("profiles").delete().eq("id", userId);
  await deleteTestUser(userId);
});

// Clean up phases between tests so they don't conflict.
beforeEach(async () => {
  const svc = svcClient();
  await svc.from("goal_phases").delete().eq("user_id", userId);
  await svc.from("calorie_target_snapshots").delete().eq("user_id", userId);
});

async function callEdge(name: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// ── 1. Preview does not mutate goal_phases ────────────────────────────────────
describe("preview-energy-calc — no mutation", () => {
  it("calling preview does not create a goal phase", async () => {
    await callEdge("preview-energy-calc", {
      goal_mode: "cut",
      target_change_kg_per_week: -0.5,
    });

    const svc = svcClient();
    const { data } = await svc.from("goal_phases").select("id").eq("user_id", userId);
    expect(data?.length ?? 0).toBe(0);
  });
});

// ── 2. start-goal-phase creates phase + snapshot atomically ───────────────────
describe("start-goal-phase (Phase 5) — creates phase + snapshot", () => {
  it("returns a phase and a snapshot in the response body", async () => {
    const { status, json } = await callEdge("start-goal-phase", {
      mode: "cut",
      starting_weight_source: "latest_weight_log",
      target_change_kg_per_week: -0.5,
    });

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const { phase, snapshot } = json.data;

    expect(phase.id).toBeTruthy();
    expect(phase.mode).toBe("cut");
    expect(phase.status).toBe("active");
    expect(phase.target_calories).toBeGreaterThan(0);

    expect(snapshot).not.toBeNull();
    expect(snapshot.user_id).toBe(userId);
    expect(snapshot.goal_phase_id).toBe(phase.id);
    expect(snapshot.algorithm_version).toBe("mifflin_st_jeor_v1");
    expect(snapshot.equation_sex).toBe("male");
    expect(snapshot.official_weight_kg).toBe(80);
    expect(snapshot.calculated_bmr_kcal).toBeGreaterThan(0);
    expect(snapshot.calculated_tdee_kcal).toBeGreaterThan(snapshot.calculated_bmr_kcal);
    expect(snapshot.final_target_kcal).toBeGreaterThanOrEqual(1000);
  });

  it("phase.target_calories matches snapshot.final_target_kcal", async () => {
    const { json } = await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
    });
    const { phase, snapshot } = json.data;
    expect(Math.round(phase.target_calories)).toBe(Math.round(snapshot.final_target_kcal));
  });

  it("snapshot.goal_phase_id points to the newly created phase", async () => {
    const { json } = await callEdge("start-goal-phase", {
      mode: "bulk",
      starting_weight_source: "latest_weight_log",
      target_change_kg_per_week: 0.3,
    });
    const { phase, snapshot } = json.data;
    expect(snapshot.goal_phase_id).toBe(phase.id);
    expect(phase.snapshot_id).toBe(snapshot.id);
  });
});

// ── 3. Snapshot immutability ──────────────────────────────────────────────────
describe("calorie_target_snapshots — immutability via RLS", () => {
  it("user cannot UPDATE their own snapshot", async () => {
    // Create a phase + snapshot.
    const { json } = await callEdge("start-goal-phase", {
      mode: "cut",
      starting_weight_source: "latest_weight_log",
      target_change_kg_per_week: -0.5,
    });
    const snapshotId = json.data.snapshot.id;

    // Try to UPDATE as the authenticated user via the Supabase SDK.
    const { createClient } = await import("@supabase/supabase-js");
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { error } = await userClient
      .from("calorie_target_snapshots")
      .update({ algorithm_name: "tampered" })
      .eq("id", snapshotId);

    // RLS has no UPDATE policy → update should be blocked (0 rows affected or error).
    // Supabase PostgREST returns success with 0 rows when RLS blocks the update.
    // We verify the snapshot is unchanged.
    const svc = svcClient();
    const { data } = await svc
      .from("calorie_target_snapshots")
      .select("algorithm_name")
      .eq("id", snapshotId)
      .single();
    expect(data?.algorithm_name).toBe("mifflin_st_jeor");
  });

  it("user cannot DELETE their own snapshot", async () => {
    const { json } = await callEdge("start-goal-phase", {
      mode: "cut",
      starting_weight_source: "latest_weight_log",
      target_change_kg_per_week: -0.5,
    });
    const snapshotId = json.data.snapshot.id;

    const { createClient } = await import("@supabase/supabase-js");
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    await userClient.from("calorie_target_snapshots").delete().eq("id", snapshotId);

    // Verify it still exists via service role.
    const svc = svcClient();
    const { data } = await svc
      .from("calorie_target_snapshots")
      .select("id")
      .eq("id", snapshotId)
      .maybeSingle();
    expect(data?.id).toBe(snapshotId);
  });
});

// ── 4. Aggressive rate requires acknowledgement ───────────────────────────────
describe("start-goal-phase — aggressive rate guard", () => {
  it("returns AGGRESSIVE_RATE_UNACKNOWLEDGED (422) without acknowledgement", async () => {
    // 0.9 kg/week on 80 kg body = 1.125% > 1%
    const { status, json } = await callEdge("start-goal-phase", {
      mode: "cut",
      starting_weight_source: "latest_weight_log",
      target_change_kg_per_week: -0.9,
    });
    expect(status).toBe(422);
    expect(json.error.code).toBe("AGGRESSIVE_RATE_UNACKNOWLEDGED");
  });

  it("succeeds when aggressive_rate_acknowledged=true", async () => {
    const { status, json } = await callEdge("start-goal-phase", {
      mode: "cut",
      starting_weight_source: "latest_weight_log",
      target_change_kg_per_week: -0.9,
      aggressive_rate_acknowledged: true,
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.snapshot.aggressive_rate_acknowledged).toBe(true);
    expect(json.data.snapshot.warning_codes).toContain("aggressive_rate");
  });
});

// ── 5. Floor enforcement ──────────────────────────────────────────────────────
describe("start-goal-phase — floor enforcement", () => {
  it("returns TARGET_BELOW_FLOOR (422) when calculated target < 1000 kcal", async () => {
    // 80 kg, manual maintenance 1800, cut 1.5 kg/week → 1800 − 1650 = 150 < 1000
    const { status, json } = await callEdge("start-goal-phase", {
      mode: "cut",
      starting_weight_source: "latest_weight_log",
      target_change_kg_per_week: -1.5,
      manual_maintenance_kcal: 1800,
    });
    expect(status).toBe(422);
    expect(json.error.code).toBe("TARGET_BELOW_FLOOR");
  });
});

// ── 6. Forbidden client-supplied target_calories ──────────────────────────────
describe("start-goal-phase — reject frontend calories", () => {
  it("returns FORBIDDEN_FIELD when target_calories is supplied by the client", async () => {
    const { status, json } = await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
      target_calories: 2000,
    });
    expect(status).toBe(422);
    expect(json.error.code).toBe("FORBIDDEN_FIELD");
  });
});
