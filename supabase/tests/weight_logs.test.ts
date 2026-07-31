// Integration tests for fn_log_weight and weight_logs table.
// Requires: supabase start
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestUser, signInAs, deleteTestUser, svcClient, testEmail } from "./helpers.js";

const EMAIL = testEmail("weight-logs");
let userId = "";
let authedClient: Awaited<ReturnType<typeof signInAs>>["client"];

async function logWeight(
  uid: string,
  kg: number,
  date: string,
  measuredAt?: string,
) {
  return svcClient().rpc("fn_log_weight", {
    p_user_id: uid,
    p_weight_kg: kg,
    p_measured_at: measuredAt ?? `${date}T07:00:00Z`,
    p_logged_date: date,
    p_notes: null,
  });
}

async function cleanupWeightLogs(uid: string) {
  await svcClient().from("weight_logs").delete().eq("user_id", uid);
}

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  ({ client: authedClient } = await signInAs(EMAIL));
  await cleanupWeightLogs(userId);
});

afterAll(async () => {
  await cleanupWeightLogs(userId);
  await deleteTestUser(userId);
});

// ── Basic insert ───────────────────────────────────────────────────────────────

describe("fn_log_weight — basic insert", () => {
  it("returns a UUID on success", async () => {
    const { data, error } = await logWeight(userId, 85.5, "2026-07-01");
    expect(error).toBeNull();
    expect(data).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("new entry is flagged is_official=true", async () => {
    const { data: id } = await logWeight(userId, 85.2, "2026-07-02");
    const { data: row } = await svcClient()
      .from("weight_logs")
      .select("is_official, weight_kg")
      .eq("id", id)
      .single();
    expect(row.is_official).toBe(true);
    expect(Number(row.weight_kg)).toBe(85.2);
  });
});

// ── Same-day multi-entry: is_official flip ─────────────────────────────────────

describe("fn_log_weight — same-day official flip (FR-042 AC2)", () => {
  const DATE = "2026-07-03";

  it("demotes earlier same-day entry when a new one is logged", async () => {
    const { data: firstId } = await logWeight(userId, 86.0, DATE, `${DATE}T06:00:00Z`);
    const { data: secondId } = await logWeight(userId, 85.8, DATE, `${DATE}T18:00:00Z`);

    const { data: first } = await svcClient()
      .from("weight_logs")
      .select("is_official")
      .eq("id", firstId)
      .single();
    const { data: second } = await svcClient()
      .from("weight_logs")
      .select("is_official")
      .eq("id", secondId)
      .single();

    expect(first.is_official).toBe(false);
    expect(second.is_official).toBe(true);
  });

  it("all three same-day entries retained — only latest is official", async () => {
    const DATE2 = "2026-07-04";
    await logWeight(userId, 87.0, DATE2, `${DATE2}T06:00:00Z`);
    await logWeight(userId, 86.8, DATE2, `${DATE2}T12:00:00Z`);
    const { data: thirdId } = await logWeight(userId, 86.5, DATE2, `${DATE2}T20:00:00Z`);

    const { data: rows } = await svcClient()
      .from("weight_logs")
      .select("id, is_official")
      .eq("user_id", userId)
      .eq("logged_date", DATE2);

    expect(rows).toHaveLength(3);
    const officialRows = rows!.filter((r) => r.is_official);
    expect(officialRows).toHaveLength(1);
    expect(officialRows[0].id).toBe(thirdId);
  });
});

// ── RLS isolation ─────────────────────────────────────────────────────────────

describe("weight_logs RLS", () => {
  const EMAIL_B = testEmail("weight-logs-b");
  let userB = "";

  beforeAll(async () => {
    userB = await createTestUser(EMAIL_B);
    await logWeight(userB, 70.0, "2026-07-05");
  });

  afterAll(async () => {
    await cleanupWeightLogs(userB);
    await deleteTestUser(userB);
  });

  it("user A cannot see user B's weight logs", async () => {
    const { data } = await authedClient
      .from("weight_logs")
      .select("id")
      .eq("user_id", userB);
    expect(data).toHaveLength(0);
  });

  it("user A can see their own weight logs", async () => {
    const { data } = await authedClient
      .from("weight_logs")
      .select("id")
      .eq("user_id", userId);
    expect(data!.length).toBeGreaterThan(0);
  });

  it("user A cannot insert a weight log for user B", async () => {
    const { error } = await authedClient.from("weight_logs").insert({
      user_id: userB,
      weight_kg: 71,
      measured_at: new Date().toISOString(),
      logged_date: "2026-07-06",
      is_official: true,
    });
    expect(error).toBeTruthy();
  });
});

// ── Constraint: weight range ───────────────────────────────────────────────────

describe("weight_logs — constraints", () => {
  it("rejects weight_kg below 1", async () => {
    const { error } = await svcClient().from("weight_logs").insert({
      user_id: userId,
      weight_kg: 0,
      measured_at: new Date().toISOString(),
      logged_date: "2026-07-07",
      is_official: true,
    });
    expect(error).toBeTruthy();
  });

  it("rejects weight_kg above 500", async () => {
    const { error } = await svcClient().from("weight_logs").insert({
      user_id: userId,
      weight_kg: 501,
      measured_at: new Date().toISOString(),
      logged_date: "2026-07-08",
      is_official: true,
    });
    expect(error).toBeTruthy();
  });
});
