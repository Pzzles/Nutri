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

// ── 7. Snapshot provenance ────────────────────────────────────────────────────
describe("start-goal-phase — snapshot provenance", () => {
  it("snapshot.weight_measured_at matches the official weight log's measured_at", async () => {
    const svc = svcClient();
    const { data: wl } = await svc
      .from("weight_logs")
      .select("measured_at")
      .eq("user_id", userId)
      .eq("is_official", true)
      .order("measured_at", { ascending: false })
      .limit(1)
      .single();

    const { json } = await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
    });

    const { snapshot } = json.data;
    expect(snapshot.weight_measured_at).toBe(wl!.measured_at);
  });

  it("snapshot.weight_log_source matches the weight log source field", async () => {
    const { json } = await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
    });
    expect(json.data.snapshot.weight_log_source).toBe("manual");
  });

  it("snapshot.input_provenance records weight as measured and bmr as calculated", async () => {
    const { json } = await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
    });
    const prov = json.data.snapshot.input_provenance;
    expect(prov.weight.source_type).toBe("measured");
    expect(prov.bmr.source_type).toBe("calculated");
    expect(prov.activity_level.source_type).toBe("user_selected");
  });
});

// ── 8. Activity-level changes do not rewrite prior snapshots ──────────────────
describe("snapshot immutability — profile changes do not alter prior snapshots", () => {
  it("changing profile activity_level does not alter existing snapshot", async () => {
    const svc = svcClient();

    const { json } = await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
      activity_level: "moderate",
    });
    const snapId      = json.data.snapshot.id;
    const origActivity = json.data.snapshot.activity_level;
    expect(origActivity).toBe("moderate");

    // Change profile activity level.
    await svc.from("profiles").update({ activity_level: "very_active" }).eq("id", userId);

    const { data: frozen } = await svc
      .from("calorie_target_snapshots")
      .select("activity_level")
      .eq("id", snapId)
      .single();

    // Restore profile.
    await svc.from("profiles").update({ activity_level: "moderate" }).eq("id", userId);

    expect(frozen!.activity_level).toBe("moderate");
  });

  it("starting a new phase with a different manual_maintenance does not alter the prior snapshot", async () => {
    const svc = svcClient();

    const { json: first } = await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
      manual_maintenance_kcal: 2800,
    });
    const firstSnapId    = first.data.snapshot.id;
    const firstMaint     = first.data.snapshot.manual_maintenance_kcal;

    // Supersede with a phase that uses no manual override.
    await callEdge("start-goal-phase", {
      mode: "maintenance",
      starting_weight_source: "latest_weight_log",
      transition: "supersede",
    });

    const { data: frozen } = await svc
      .from("calorie_target_snapshots")
      .select("manual_maintenance_kcal")
      .eq("id", firstSnapId)
      .single();

    expect(frozen!.manual_maintenance_kcal).toBe(firstMaint);
  });
});

// ── 9. Daily-log completeness ─────────────────────────────────────────────────
describe("daily_log_status — complete vs incomplete days are distinguishable", () => {
  it("status=complete and status=partial are stored as distinct values", async () => {
    const svc = svcClient();
    const today     = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().split("T")[0];

    await svc.from("daily_log_status").upsert([
      { user_id: userId, logged_date: today,     status: "complete" },
      { user_id: userId, logged_date: yesterday, status: "partial" },
    ], { onConflict: "user_id,logged_date" });

    const { data } = await svc
      .from("daily_log_status")
      .select("logged_date, status")
      .eq("user_id", userId)
      .in("logged_date", [today, yesterday]);

    const statusMap: Record<string, string> = {};
    for (const row of data ?? []) statusMap[row.logged_date] = row.status;

    expect(statusMap[today]).toBe("complete");
    expect(statusMap[yesterday]).toBe("partial");

    // A completed low-calorie day and an incomplete same-calorie day
    // are distinguishable by status alone — no ambiguity.
    expect(statusMap[today]).not.toBe(statusMap[yesterday]);

    // Cleanup.
    await svc.from("daily_log_status").delete().eq("user_id", userId).in("logged_date", [today, yesterday]);
  });
});
