// Phase 6 — API integration tests for get-weight-trend.
//
// Tests the real edge function against a real local Supabase instance.
// Covers: response contract, EWMA + regression, confidence tiers, outlier
// flagging, RLS isolation, and the minimum-data guard.
//
// Requires: supabase start + supabase functions serve

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  SUPABASE_URL,
  ANON_KEY,
} from "./helpers.js";

const EMAIL = `weight-trend-${Date.now()}@test.local`;
let userId = "";
let accessToken = "";

// A second user to test RLS isolation.
const EMAIL_B = `weight-trend-b-${Date.now()}@test.local`;
let userBId = "";
let accessTokenB = "";

beforeAll(async () => {
  userId  = await createTestUser(EMAIL);
  userBId = await createTestUser(EMAIL_B);

  const [{ client: clientA }, { client: clientB }] = await Promise.all([
    signInAs(EMAIL),
    signInAs(EMAIL_B),
  ]);
  const [sessA, sessB] = await Promise.all([
    clientA.auth.getSession(),
    clientB.auth.getSession(),
  ]);
  accessToken  = sessA.data.session!.access_token;
  accessTokenB = sessB.data.session!.access_token;
});

afterAll(async () => {
  const svc = svcClient();
  await Promise.all([
    svc.from("weight_logs").delete().eq("user_id", userId),
    svc.from("weight_logs").delete().eq("user_id", userBId),
  ]);
  await Promise.all([deleteTestUser(userId), deleteTestUser(userBId)]);
});

async function callTrend(
  token: string,
  params: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/functions/v1/get-weight-trend${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
  });
  return { status: res.status, json: await res.json() };
}

async function insertWeights(
  uid: string,
  entries: Array<{ weight_kg: number; measured_at: string; is_official?: boolean }>,
): Promise<void> {
  const svc = svcClient();
  await svc.from("weight_logs").insert(
    entries.map((e) => ({
      user_id:     uid,
      weight_kg:   e.weight_kg,
      measured_at: e.measured_at,
      logged_date: e.measured_at.split("T")[0],
      is_official: e.is_official ?? true,
      source:      "manual",
    })),
  );
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

// ── 1. Response contract ──────────────────────────────────────────────────────

describe("get-weight-trend — response contract", () => {
  beforeAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", userId);
    await insertWeights(userId, [
      { weight_kg: 80,   measured_at: daysAgo(20) },
      { weight_kg: 79.5, measured_at: daysAgo(16) },
      { weight_kg: 79.2, measured_at: daysAgo(12) },
      { weight_kg: 79.0, measured_at: daysAgo(8)  },
      { weight_kg: 78.8, measured_at: daysAgo(4)  },
      { weight_kg: 78.5, measured_at: daysAgo(1)  },
    ]);
  });

  it("returns 200 with success=true", async () => {
    const { status, json } = await callTrend(accessToken);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("response includes all required fields", async () => {
    const { json } = await callTrend(accessToken);
    const d = json.data as Record<string, unknown>;
    expect(d.algorithm_version).toBe("weight_trend_v1");
    expect(d.ewma_version).toBe("weight_ewma_v1");
    expect(typeof d.measurement_count).toBe("number");
    expect(typeof d.coverage_days).toBe("number");
    expect(d.latest_raw_weight_kg).not.toBeNull();
    expect(d.latest_trend_weight_kg).not.toBeNull();
    expect(typeof d.weekly_rate_kg).toBe("number");
    expect(["low", "medium", "high"]).toContain(d.confidence);
    expect(Array.isArray(d.warnings)).toBe(true);
    expect(Array.isArray(d.trend_points)).toBe(true);
    expect(Array.isArray(d.outlier_ids)).toBe(true);
  });

  it("trend_points contain raw and smoothed weight", async () => {
    const { json } = await callTrend(accessToken);
    const points = (json.data as Record<string, unknown>).trend_points as unknown[];
    expect(points.length).toBeGreaterThan(0);
    const first = points[0] as Record<string, unknown>;
    expect(typeof first.raw_weight_kg).toBe("number");
    expect(typeof first.trend_weight_kg).toBe("number");
    expect(typeof first.measured_at).toBe("string");
    expect(typeof first.is_outlier).toBe("boolean");
  });

  it("requires authentication", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-weight-trend`, {
      headers: { apikey: ANON_KEY },
    });
    expect(res.status).toBe(401);
  });
});

// ── 2. No weight logs → graceful empty response ───────────────────────────────

describe("get-weight-trend — no weight logs", () => {
  let emptyUserId = "";
  let emptyToken  = "";
  const emptyEmail = `trend-empty-${Date.now()}@test.local`;

  beforeAll(async () => {
    emptyUserId = await createTestUser(emptyEmail);
    const { client } = await signInAs(emptyEmail);
    const { data: { session } } = await client.auth.getSession();
    emptyToken = session!.access_token;
  });

  afterAll(async () => {
    await deleteTestUser(emptyUserId);
  });

  it("returns 200 with null trend fields", async () => {
    const { status, json } = await callTrend(emptyToken);
    expect(status).toBe(200);
    const d = json.data as Record<string, unknown>;
    expect(d.latest_raw_weight_kg).toBeNull();
    expect(d.weekly_rate_kg).toBeNull();
    expect(d.measurement_count).toBe(0);
    expect((d.warnings as string[])).toContain("insufficient_measurements");
  });
});

// ── 3. Minimum-data guard ─────────────────────────────────────────────────────

describe("get-weight-trend — two measurements (below threshold)", () => {
  let uid2 = "";
  let tok2 = "";
  const email2 = `trend-two-${Date.now()}@test.local`;

  beforeAll(async () => {
    uid2 = await createTestUser(email2);
    const { client } = await signInAs(email2);
    const { data: { session } } = await client.auth.getSession();
    tok2 = session!.access_token;
    await insertWeights(uid2, [
      { weight_kg: 80,   measured_at: daysAgo(5) },
      { weight_kg: 79.5, measured_at: daysAgo(1) },
    ]);
  });

  afterAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", uid2);
    await deleteTestUser(uid2);
  });

  it("weekly_rate_kg is null", async () => {
    const { json } = await callTrend(tok2);
    expect((json.data as Record<string, unknown>).weekly_rate_kg).toBeNull();
  });

  it("warns insufficient_measurements", async () => {
    const { json } = await callTrend(tok2);
    const warnings = (json.data as Record<string, unknown>).warnings as string[];
    expect(warnings).toContain("insufficient_measurements");
  });
});

// ── 4. Steady decline → negative rate ────────────────────────────────────────

describe("get-weight-trend — steady decline", () => {
  let uid = "";
  let tok = "";
  const email = `trend-decline-${Date.now()}@test.local`;

  beforeAll(async () => {
    uid = await createTestUser(email);
    const { client } = await signInAs(email);
    const { data: { session } } = await client.auth.getSession();
    tok = session!.access_token;
    // 8 measurements, evenly declining ~0.5 kg/week over 28 days
    const entries = Array.from({ length: 8 }, (_, i) => ({
      weight_kg:   85 - i * 0.5,
      measured_at: daysAgo(27 - i * 4),
    }));
    await insertWeights(uid, entries);
  });

  afterAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", uid);
    await deleteTestUser(uid);
  });

  it("weekly_rate_kg is negative", async () => {
    const { json } = await callTrend(tok);
    const rate = (json.data as Record<string, unknown>).weekly_rate_kg as number;
    expect(rate).toBeLessThan(0);
  });
});

// ── 5. Outlier flagging ───────────────────────────────────────────────────────

describe("get-weight-trend — extreme outlier is flagged", () => {
  let uid = "";
  let tok = "";
  let outlierLogId = "";
  const email = `trend-outlier-${Date.now()}@test.local`;

  beforeAll(async () => {
    uid = await createTestUser(email);
    const { client } = await signInAs(email);
    const { data: { session } } = await client.auth.getSession();
    tok = session!.access_token;

    const svc = svcClient();
    // Insert normal stable measurements
    await insertWeights(uid, [
      { weight_kg: 80,   measured_at: daysAgo(8)  },
      { weight_kg: 80.1, measured_at: daysAgo(7)  },
      { weight_kg: 80,   measured_at: daysAgo(6)  },
      { weight_kg: 80.2, measured_at: daysAgo(5)  },
      { weight_kg: 80,   measured_at: daysAgo(4)  },
      { weight_kg: 80.1, measured_at: daysAgo(3)  },
      { weight_kg: 80,   measured_at: daysAgo(2)  },
    ]);
    // Insert the extreme outlier (13 kg instead of 103 kg)
    const { data } = await svc
      .from("weight_logs")
      .insert({
        user_id:     uid,
        weight_kg:   13,
        measured_at: daysAgo(1),
        logged_date: new Date(Date.now() - 86_400_000).toISOString().split("T")[0],
        is_official: true,
        source:      "manual",
      })
      .select("id")
      .single();
    outlierLogId = data!.id;
  });

  afterAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", uid);
    await deleteTestUser(uid);
  });

  it("outlier id appears in outlier_ids", async () => {
    const { json } = await callTrend(tok);
    const d = json.data as Record<string, unknown>;
    expect((d.outlier_ids as string[])).toContain(outlierLogId);
  });

  it("outlier appears in trend_points (not silently deleted)", async () => {
    const { json } = await callTrend(tok);
    const d = json.data as Record<string, unknown>;
    const outlierPoint = (d.trend_points as Array<Record<string, unknown>>)
      .find((p) => p.id === outlierLogId);
    expect(outlierPoint).toBeDefined();
    expect(outlierPoint!.raw_weight_kg).toBe(13);
  });

  it("trend weight is not pulled drastically toward 13 kg", async () => {
    const { json } = await callTrend(tok);
    const d = json.data as Record<string, unknown>;
    expect(d.latest_trend_weight_kg as number).toBeGreaterThan(60);
  });
});

// ── 6. RLS — user B cannot see user A's trend ─────────────────────────────────

describe("get-weight-trend — RLS isolation", () => {
  beforeAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", userBId);
    // User B has no weights; user A has weights from earlier suite
    await insertWeights(userId, [
      { weight_kg: 80,   measured_at: daysAgo(20) },
      { weight_kg: 79.5, measured_at: daysAgo(16) },
      { weight_kg: 79.2, measured_at: daysAgo(12) },
      { weight_kg: 79.0, measured_at: daysAgo(8)  },
      { weight_kg: 78.8, measured_at: daysAgo(4)  },
      { weight_kg: 78.5, measured_at: daysAgo(1)  },
    ]);
  });

  it("user B sees their own empty trend, not user A's data", async () => {
    const { json: jsonA } = await callTrend(accessToken);
    const { json: jsonB } = await callTrend(accessTokenB);
    const dA = jsonA.data as Record<string, unknown>;
    const dB = jsonB.data as Record<string, unknown>;
    expect(dA.measurement_count as number).toBeGreaterThan(0);
    expect(dB.measurement_count as number).toBe(0);
  });
});

// ── 7. Non-official entries are excluded ─────────────────────────────────────

describe("get-weight-trend — non-official entries excluded from trend", () => {
  let uid = "";
  let tok = "";
  const email = `trend-nonoff-${Date.now()}@test.local`;

  beforeAll(async () => {
    uid = await createTestUser(email);
    const { client } = await signInAs(email);
    const { data: { session } } = await client.auth.getSession();
    tok = session!.access_token;
    await insertWeights(uid, [
      { weight_kg: 80,   measured_at: daysAgo(10), is_official: true  },
      { weight_kg: 999,  measured_at: daysAgo(8),  is_official: false },
      { weight_kg: 79.5, measured_at: daysAgo(6),  is_official: true  },
      { weight_kg: 79.2, measured_at: daysAgo(4),  is_official: true  },
      { weight_kg: 79.0, measured_at: daysAgo(2),  is_official: true  },
    ]);
  });

  afterAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", uid);
    await deleteTestUser(uid);
  });

  it("measurement_count excludes non-official entries", async () => {
    const { json } = await callTrend(tok);
    expect((json.data as Record<string, unknown>).measurement_count).toBe(4);
  });

  it("trend weight is not influenced by the 999 kg non-official entry", async () => {
    const { json } = await callTrend(tok);
    expect((json.data as Record<string, unknown>).latest_trend_weight_kg as number).toBeLessThan(90);
  });
});
