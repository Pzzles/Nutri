// Integration tests for fn_start_goal_phase and goal_phases table.
// Requires: supabase start (migration 0009 applied)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, signInAs, deleteTestUser, svcClient, testEmail } from "./helpers.js";

const EMAIL_A = testEmail("goal-phases-a");
const EMAIL_B = testEmail("goal-phases-b");
let userA = "";
let userB = "";
let authedA: Awaited<ReturnType<typeof signInAs>>["client"];

const WEIGHT = 80;
const WEIGHT_SOURCE = "manual";

async function startPhase(userId: string, overrides: Record<string, unknown> = {}) {
  return svcClient().rpc("fn_start_goal_phase", {
    p_user_id: userId,
    p_mode: "cut",
    p_started_at: new Date().toISOString(),
    p_starting_weight_kg: WEIGHT,
    p_starting_weight_source: WEIGHT_SOURCE,
    p_target_weight_kg: null,
    p_target_change_kg_per_week: -0.5,
    p_target_calories: 2000,
    p_target_protein_g: 150,
    p_target_carbs_g: 200,
    p_target_fat_g: 70,
    p_transition: null,
    ...overrides,
  });
}

async function cleanupPhases(userId: string) {
  await svcClient().from("goal_phases").delete().eq("user_id", userId);
}

beforeAll(async () => {
  userA = await createTestUser(EMAIL_A);
  userB = await createTestUser(EMAIL_B);
  ({ client: authedA } = await signInAs(EMAIL_A));
  await cleanupPhases(userA);
  await cleanupPhases(userB);
});

afterAll(async () => {
  await cleanupPhases(userA);
  await cleanupPhases(userB);
  await deleteTestUser(userA);
  await deleteTestUser(userB);
});

// ── Basic creation ─────────────────────────────────────────────────────────────

describe("fn_start_goal_phase — basic creation", () => {
  it("returns a UUID for a new cut phase with no prior phases", async () => {
    const { data, error } = await startPhase(userA);
    expect(error).toBeNull();
    expect(data).toMatch(/^[0-9a-f-]{36}$/i);

    // Verify the row.
    const { data: row } = await svcClient()
      .from("goal_phases")
      .select("*")
      .eq("id", data)
      .single();

    expect(row.mode).toBe("cut");
    expect(row.status).toBe("active");
    expect(Number(row.starting_weight_kg)).toBe(WEIGHT);
    expect(Number(row.target_change_kg_per_week)).toBe(-0.5);
    expect(row.ended_at).toBeNull();
  });

  it("creates a maintenance phase with zero rate", async () => {
    // userB has no phase yet.
    const { data, error } = await startPhase(userB, {
      p_mode: "maintenance",
      p_target_change_kg_per_week: 0,
      p_target_calories: 2200,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const { data: row } = await svcClient()
      .from("goal_phases")
      .select("mode, status, target_change_kg_per_week")
      .eq("id", data)
      .single();

    expect(row.mode).toBe("maintenance");
    expect(row.status).toBe("active");
    expect(Number(row.target_change_kg_per_week)).toBe(0);
  });
});

// ── One-active-per-user constraint ────────────────────────────────────────────

describe("fn_start_goal_phase — one active phase per user", () => {
  it("raises P0002 when starting without a transition and active phase exists", async () => {
    // userA already has an active phase from the first describe block.
    const { data, error } = await startPhase(userA);
    expect(error).toBeTruthy();
    expect(error?.code).toBe("P0002");
    expect(data).toBeNull();
  });

  it("supersedes the active phase when transition=supersede", async () => {
    const { data: oldPhaseId } = await svcClient()
      .from("goal_phases")
      .select("id")
      .eq("user_id", userA)
      .eq("status", "active")
      .single();

    const { data: newId, error } = await startPhase(userA, {
      p_target_calories: 1800,
      p_transition: "supersede",
    });

    expect(error).toBeNull();
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(oldPhaseId.id);

    const { data: oldRow } = await svcClient()
      .from("goal_phases")
      .select("status, ended_at, superseded_by")
      .eq("id", oldPhaseId.id)
      .single();

    expect(oldRow.status).toBe("superseded");
    expect(oldRow.ended_at).toBeTruthy();
    expect(oldRow.superseded_by).toBe(newId);

    const { data: newRow } = await svcClient()
      .from("goal_phases")
      .select("status")
      .eq("id", newId)
      .single();

    expect(newRow.status).toBe("active");
  });

  it("only one active phase exists for a user after supersede", async () => {
    const { data: rows } = await svcClient()
      .from("goal_phases")
      .select("id")
      .eq("user_id", userA)
      .eq("status", "active");

    expect(rows).toHaveLength(1);
  });

  it("cancels the active phase when transition=cancel", async () => {
    const { data: oldPhaseId } = await svcClient()
      .from("goal_phases")
      .select("id")
      .eq("user_id", userA)
      .eq("status", "active")
      .single();

    const { data: newId, error } = await startPhase(userA, {
      p_target_calories: 1700,
      p_transition: "cancel",
    });

    expect(error).toBeNull();

    const { data: oldRow } = await svcClient()
      .from("goal_phases")
      .select("status, ended_reason")
      .eq("id", oldPhaseId.id)
      .single();

    expect(oldRow.status).toBe("cancelled");
    expect(oldRow.ended_reason).toContain("Cancelled");

    // cleanup: end this new active phase for subsequent tests
    await svcClient()
      .from("goal_phases")
      .update({ status: "completed", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", newId);
  });
});

// ── DB constraint validation ───────────────────────────────────────────────────

describe("fn_start_goal_phase — constraint violations", () => {
  it("rejects starting_weight_kg below range (< 20)", async () => {
    const { error } = await startPhase(userA, {
      p_starting_weight_kg: 10,
      p_transition: null,
    });
    expect(error).toBeTruthy();
  });

  it("rejects target_change_kg_per_week < -2.0", async () => {
    const { error } = await startPhase(userA, {
      p_target_change_kg_per_week: -3,
      p_transition: null,
    });
    expect(error).toBeTruthy();
  });

  it("rejects positive target_change_kg_per_week for a cut phase", async () => {
    const { error } = await startPhase(userA, {
      p_mode: "cut",
      p_target_change_kg_per_week: 0.5,
      p_transition: null,
    });
    expect(error).toBeTruthy();
  });

  it("rejects maintenance phase with non-zero rate", async () => {
    const { error } = await startPhase(userA, {
      p_mode: "maintenance",
      p_target_change_kg_per_week: -0.5,
      p_transition: null,
    });
    expect(error).toBeTruthy();
  });

  it("rejects invalid transition value", async () => {
    const { error } = await startPhase(userA, {
      p_transition: "invalid_value",
    });
    expect(error).toBeTruthy();
  });
});

// ── RLS: users cannot read each other's phases ─────────────────────────────────

describe("goal_phases RLS", () => {
  it("user A cannot see user B's phases", async () => {
    const { data } = await authedA
      .from("goal_phases")
      .select("id")
      .eq("user_id", userB);

    expect(data).toHaveLength(0);
  });

  it("user A can see their own active phase", async () => {
    // Ensure userA has an active phase.
    const { data: existing } = await svcClient()
      .from("goal_phases")
      .select("id")
      .eq("user_id", userA)
      .eq("status", "active")
      .maybeSingle();

    if (!existing) {
      await startPhase(userA);
    }

    const { data } = await authedA
      .from("goal_phases")
      .select("id")
      .eq("status", "active");

    expect(data!.length).toBeGreaterThanOrEqual(1);
  });

  it("user A cannot insert a phase directly for user B via RLS", async () => {
    const { error } = await authedA.from("goal_phases").insert({
      user_id: userB,
      mode: "cut",
      status: "active",
      started_at: new Date().toISOString(),
      starting_weight_kg: 80,
      starting_weight_source: "manual",
    });
    expect(error).toBeTruthy();
  });
});

// ── Phase lifecycle transitions ────────────────────────────────────────────────

describe("goal_phases lifecycle via direct update (service role)", () => {
  it("can mark an active phase completed with ended_at set", async () => {
    const { data: active } = await svcClient()
      .from("goal_phases")
      .select("id")
      .eq("user_id", userA)
      .eq("status", "active")
      .maybeSingle();

    if (!active) return; // no active phase — skip

    const { error } = await svcClient()
      .from("goal_phases")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        ended_reason: "Test completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", active.id);

    expect(error).toBeNull();

    const { data: row } = await svcClient()
      .from("goal_phases")
      .select("status, ended_at")
      .eq("id", active.id)
      .single();

    expect(row.status).toBe("completed");
    expect(row.ended_at).toBeTruthy();
  });

  it("constraint: ended_at must be present for inactive phases", async () => {
    // Try to set status=completed without ended_at — should violate constraint.
    const { data: anyPhase } = await svcClient()
      .from("goal_phases")
      .select("id")
      .eq("user_id", userA)
      .limit(1)
      .maybeSingle();

    if (!anyPhase) return;

    const { error } = await svcClient()
      .from("goal_phases")
      .update({ status: "completed", ended_at: null, updated_at: new Date().toISOString() })
      .eq("id", anyPhase.id);

    expect(error).toBeTruthy();
  });
});
