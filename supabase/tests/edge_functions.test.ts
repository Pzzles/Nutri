// Integration tests for HTTP edge functions.
// Requires: supabase start + supabase functions serve
// All calls use real JWTs — zero mocking.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, signInAs, deleteTestUser, svcClient, testEmail } from "./helpers.js";

const FUNCTIONS_URL = process.env.FUNCTIONS_URL ?? "http://127.0.0.1:54421/functions/v1";
const EMAIL = testEmail("edge-fn");

let userId = "";
let jwt = "";

async function callFn(name: string, body: unknown, token = jwt) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getFn(name: string, params: Record<string, string> = {}, token = jwt) {
  const qs = new URLSearchParams(params).toString();
  const url = `${FUNCTIONS_URL}/${name}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

async function cleanupUser(uid: string) {
  await svcClient().from("weight_logs").delete().eq("user_id", uid);
  await svcClient().from("goal_phases").delete().eq("user_id", uid);
  await svcClient().from("daily_log_status").delete().eq("user_id", uid);
  await svcClient().from("meals").delete().eq("user_id", uid);
}

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  const { client } = await signInAs(EMAIL);
  const { data } = await client.auth.getSession();
  jwt = data.session!.access_token;
  await cleanupUser(userId);
});

afterAll(async () => {
  await cleanupUser(userId);
  await deleteTestUser(userId);
});

// ── log-weight ─────────────────────────────────────────────────────────────────

describe("log-weight", () => {
  it("logs a weight entry and returns the full row", async () => {
    const resp = await callFn("log-weight", {
      weight_kg: 85.5,
      measured_at: "2026-07-20T07:00:00.000Z",
    });
    expect(resp.success).toBe(true);
    expect(resp.data.weight_kg).toBe(85.5);
    expect(resp.data.is_official).toBe(true);
    expect(resp.data.user_id).toBe(userId);
    expect(resp.data.logged_date).toBe("2026-07-20");
  });

  it("rejects weight_kg below 20", async () => {
    const resp = await callFn("log-weight", { weight_kg: 15 });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects weight_kg above 300", async () => {
    const resp = await callFn("log-weight", { weight_kg: 310 });
    expect(resp.success).toBe(false);
    expect(resp.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing Authorization header", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/log-weight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weight_kg: 85 }),
    });
    const resp = await res.json();
    expect(resp.success).toBe(false);
  });

  it("same-day second entry demotes the first to is_official=false", async () => {
    await callFn("log-weight", {
      weight_kg: 84.0,
      measured_at: "2026-07-21T06:00:00.000Z",
    });
    const second = await callFn("log-weight", {
      weight_kg: 83.8,
      measured_at: "2026-07-21T18:00:00.000Z",
    });
    expect(second.data.is_official).toBe(true);
    expect(second.data.weight_kg).toBe(83.8);

    // Verify first entry was demoted via DB
    const { data: logs } = await svcClient()
      .from("weight_logs")
      .select("weight_kg, is_official")
      .eq("user_id", userId)
      .eq("logged_date", "2026-07-21")
      .order("weight_kg", { ascending: false });

    expect(logs).toHaveLength(2);
    const first = logs!.find((l: any) => Number(l.weight_kg) === 84.0);
    const sec = logs!.find((l: any) => Number(l.weight_kg) === 83.8);
    expect(first!.is_official).toBe(false);
    expect(sec!.is_official).toBe(true);
  });
});

// ── get-weight-logs ────────────────────────────────────────────────────────────

describe("get-weight-logs", () => {
  it("returns logs array and latest_official", async () => {
    const resp = await getFn("get-weight-logs");
    expect(resp.success).toBe(true);
    expect(Array.isArray(resp.data.logs)).toBe(true);
    expect(resp.data.logs.length).toBeGreaterThan(0);
    expect(resp.data.latest_official).not.toBeNull();
    expect(resp.data.latest_official.is_official).toBe(true);
  });

  it("official_only=true filters to only official entries", async () => {
    const resp = await getFn("get-weight-logs", { official_only: "true" });
    expect(resp.success).toBe(true);
    const nonOfficial = resp.data.logs.filter((l: any) => !l.is_official);
    expect(nonOfficial).toHaveLength(0);
  });

  it("limit param caps the result set", async () => {
    const resp = await getFn("get-weight-logs", { limit: "1" });
    expect(resp.success).toBe(true);
    expect(resp.data.logs.length).toBeLessThanOrEqual(1);
  });

  it("rejects unauthenticated request", async () => {
    const res = await fetch(`${FUNCTIONS_URL}/get-weight-logs`, { method: "GET" });
    const resp = await res.json();
    expect(resp.success).toBe(false);
  });
});

// ── dashboard-summary ──────────────────────────────────────────────────────────

describe("dashboard-summary", () => {
  it("returns today's summary including latest_weight", async () => {
    const resp = await callFn("dashboard-summary", { date: "2026-07-26" });
    expect(resp.success).toBe(true);
    expect(resp.data).toHaveProperty("date");
    expect(resp.data).toHaveProperty("totals");
    expect(resp.data).toHaveProperty("latest_weight");
  });

  it("latest_weight reflects the most recent official entry", async () => {
    const resp = await callFn("dashboard-summary", { date: "2026-07-26" });
    expect(resp.success).toBe(true);
    // We logged weight on 2026-07-20 and 2026-07-21 in prior tests
    expect(resp.data.latest_weight).not.toBeNull();
    expect(resp.data.latest_weight.weight_kg).toBeDefined();
  });
});

// ── start-goal-phase ───────────────────────────────────────────────────────────

describe("start-goal-phase", () => {
  let phaseId = "";

  it("creates a cut phase and returns the full phase row", async () => {
    const resp = await callFn("start-goal-phase", {
      mode: "cut",
      started_at: "2026-07-20T00:00:00.000Z",
      starting_weight_kg: 85.5,
      starting_weight_source: "manual",
      target_change_kg_per_week: -0.5,
    });
    expect(resp.success).toBe(true);
    expect(typeof resp.data).toBe("object");
    expect(resp.data.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(resp.data.mode).toBe("cut");
    expect(resp.data.status).toBe("active");
    phaseId = resp.data.id;
  });

  it("rejects starting a second phase without a transition", async () => {
    const resp = await callFn("start-goal-phase", {
      mode: "maintenance",
      started_at: "2026-07-21T00:00:00.000Z",
      starting_weight_kg: 85.0,
      starting_weight_source: "manual",
      target_change_kg_per_week: 0,
    });
    expect(resp.success).toBe(false);
  });

  it("supersedes existing phase with transition=supersede", async () => {
    const resp = await callFn("start-goal-phase", {
      mode: "maintenance",
      started_at: "2026-07-22T00:00:00.000Z",
      starting_weight_kg: 85.0,
      starting_weight_source: "manual",
      target_change_kg_per_week: 0,
      transition: "supersede",
    });
    expect(resp.success).toBe(true);

    // Old phase should now be superseded
    const { data: old } = await svcClient()
      .from("goal_phases")
      .select("status, superseded_by")
      .eq("id", phaseId)
      .single();
    expect(old!.status).toBe("superseded");
    expect(old!.superseded_by).toBe(resp.data.id);
  });
});

// ── set-daily-log-status ───────────────────────────────────────────────────────

describe("set-daily-log-status + get-daily-log-status", () => {
  const DATE = "2026-07-25";

  it("marks a day as complete", async () => {
    const resp = await callFn("set-daily-log-status", {
      date: DATE,
      status: "complete",
    });
    expect(resp.success).toBe(true);
    expect(resp.data.status).toBe("complete");
    expect(resp.data.marked_complete_at).not.toBeNull();
  });

  it("get-daily-log-status returns complete for that day", async () => {
    const resp = await getFn("get-daily-log-status", { date: DATE });
    expect(resp.success).toBe(true);
    expect(resp.data.status).toBe("complete");
  });

  it("re-opening preserves marked_complete_at", async () => {
    const firstResp = await callFn("set-daily-log-status", {
      date: DATE,
      status: "complete",
    });
    const markedAt = firstResp.data.marked_complete_at;

    const reopenResp = await callFn("set-daily-log-status", {
      date: DATE,
      status: "partial",
    });
    expect(reopenResp.data.status).toBe("partial");
    expect(reopenResp.data.marked_complete_at).toBe(markedAt);
    expect(reopenResp.data.reopened_at).not.toBeNull();
  });
});
