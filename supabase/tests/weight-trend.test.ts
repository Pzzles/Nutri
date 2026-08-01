// Phase 6 Prompt 3 — API integration tests for get-weight-trend (v3).
//
// Tests the REAL edge function against a real local Supabase instance.
// Requires: supabase start + supabase functions serve
//
// Comparison strategy:
//   • Time-invariant oracle fields (raw_count, daily_reps.length, latest_raw,
//     latest_trend, algorithm_versions): compared directly against frozen oracle JSON.
//   • Time-dependent fields (status, window, weekly_rate, trend_points):
//     compared against a fresh calculate() call using the same DB rows and
//     today's clock — proves the full integration path DB→API→engine.
//   • Fixture G (SAST boundary): DB UTC normalisation changes the timestamp
//     string representation of g04, altering lexicographic sort order for the
//     "latest official" selection. Only structural oracle counts are compared;
//     numeric values compare against fresh calculate().

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync }          from "node:fs";
import { resolve, dirname }      from "node:path";
import { fileURLToPath }         from "node:url";
import {
  createTestUser,
  signInAs,
  deleteTestUser,
  svcClient,
  SUPABASE_URL,
  ANON_KEY,
} from "./helpers.js";
import {
  calculate as tsCalculate,
  type RawEntry   as TsRawEntry,
  type TrendOutput,
} from "../functions/_shared/weightTrend.ts";

// ── Oracle fixture types ──────────────────────────────────────────────────────

interface OracleMeasurements {
  raw_count: number;
  valid_count: number;
  distinct_modelling_days: number;
  excluded_count: number;
  largest_gap_days: number | null;
  latest_measured_at: string | null;
  selected_rate_window_days: number | null;
}

interface OracleDailyRep {
  local_date: string;
  measured_at: string;
  weight_kg: number;
  source: string;
  warnings: string[];
  source_measurement_ids: string[];
}

interface OracleExpected {
  status: string;
  confidence: string;
  measurements: OracleMeasurements;
  latest_raw_weight_kg: number | null;
  latest_trend_weight_kg: number | null;
  weekly_rate: { estimate_kg: number; lower_kg: number | null; upper_kg: number | null } | null;
  warnings: string[];
  flagged_measurements: string[];
  daily_representatives: OracleDailyRep[];
  trend_points: Array<{ local_date: string; trend_weight_kg: number; alpha: number | null; huber_capped: boolean }>;
  ols_diagnostic: { slope_per_day: number; weekly_rate_kg: number; r_squared: number } | null;
  window: { start: string | null; end: string | null; elapsed_days: number; inclusive_calendar_days: number };
}

interface OracleFixture {
  input:    { raw_entries: TsRawEntry[]; now_iso: string; timezone: string };
  expected: OracleExpected;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const __dir      = dirname(fileURLToPath(import.meta.url));
const ORACLE_DIR = resolve(__dir, "../../tools/weight-trend-oracle/expected");

function loadOracle(key: string): OracleFixture {
  const path = resolve(ORACLE_DIR, `fixture_${key}.json`);
  return JSON.parse(readFileSync(path, "utf-8")) as OracleFixture;
}

async function callTrend(
  token:  string,
  params: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const qs  = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/functions/v1/get-weight-trend${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function insertWeights(
  uid:     string,
  entries: Array<{ weight_kg: number; measured_at: string; is_official?: boolean }>,
): Promise<void> {
  const svc = svcClient();
  for (let i = 0; i < entries.length; i += 500) {
    const batch = entries.slice(i, i + 500);
    const { error } = await svc.from("weight_logs").insert(
      batch.map((e) => ({
        user_id:     uid,
        weight_kg:   e.weight_kg,
        measured_at: e.measured_at,
        logged_date: new Date(e.measured_at).toISOString().split("T")[0],
        is_official: e.is_official ?? true,
      })),
    );
    if (error) throw new Error(`insertWeights failed: ${error.message}`);
  }
}

async function readWeightLogs(uid: string): Promise<TsRawEntry[]> {
  const svc   = svcClient();
  const rows: TsRawEntry[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await svc
      .from("weight_logs")
      .select("id, weight_kg, measured_at, is_official")
      .eq("user_id", uid)
      .order("measured_at", { ascending: true })
      .order("id",          { ascending: true })
      .range(offset, offset + 499);
    if (error) throw new Error(`readWeightLogs failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data.map((r) => ({
      id:          r.id          as string,
      measured_at: r.measured_at as string,
      weight_kg:   Number(r.weight_kg),
      is_official: r.is_official as boolean,
    })));
    if (data.length < 500) break;
    offset += 500;
  }
  return rows;
}

function approxEq(
  a: number | null | undefined,
  b: number | null | undefined,
  tol = 1e-6,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol;
}

// ── Shared test-user setup ────────────────────────────────────────────────────

const EMAIL_A = `wt3-a-${Date.now()}@test.local`;
const EMAIL_B = `wt3-b-${Date.now()}@test.local`;
let userId  = "";
let userBId = "";
let tokenA  = "";
let tokenB  = "";

beforeAll(async () => {
  userId  = await createTestUser(EMAIL_A);
  userBId = await createTestUser(EMAIL_B);
  const [{ client: cA }, { client: cB }] = await Promise.all([
    signInAs(EMAIL_A),
    signInAs(EMAIL_B),
  ]);
  const [sA, sB] = await Promise.all([
    cA.auth.getSession(),
    cB.auth.getSession(),
  ]);
  tokenA = sA.data.session!.access_token;
  tokenB = sB.data.session!.access_token;
}, 30_000);

afterAll(async () => {
  const svc = svcClient();
  await Promise.all([
    svc.from("weight_logs").delete().eq("user_id", userId),
    svc.from("weight_logs").delete().eq("user_id", userBId),
  ]);
  await Promise.all([deleteTestUser(userId), deleteTestUser(userBId)]);
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Authentication
// ═══════════════════════════════════════════════════════════════════════════════

describe("Authentication", () => {
  it("no Authorization header → 401", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-weight-trend`, {
      headers: { apikey: ANON_KEY },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect((body.error as Record<string, unknown>).code).toBe("UNAUTHENTICATED");
  });

  it("malformed token → 401", async () => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/get-weight-trend`, {
      headers: { Authorization: "Bearer not.a.real.jwt", apikey: ANON_KEY },
    });
    expect(res.status).toBe(401);
  });

  it("valid token, no data → 200", async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", userId);
    const { status } = await callTrend(tokenA);
    expect(status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Response contract — v3 shape
// ═══════════════════════════════════════════════════════════════════════════════

describe("Response contract — v3 shape", () => {
  beforeAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", userId);
    await insertWeights(userId, [
      { weight_kg: 80,   measured_at: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      { weight_kg: 79.5, measured_at: new Date(Date.now() - 14 * 86_400_000).toISOString() },
      { weight_kg: 79.2, measured_at: new Date(Date.now() -  7 * 86_400_000).toISOString() },
      { weight_kg: 79.0, measured_at: new Date(Date.now() -  2 * 86_400_000).toISOString() },
      { weight_kg: 78.8, measured_at: new Date(Date.now() -  1 * 86_400_000).toISOString() },
    ]);
  });

  it("returns 200 with success=true and error=null", async () => {
    const { status, json } = await callTrend(tokenA);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.error).toBeNull();
  });

  it("data.status is a recognised TrendStatus string", async () => {
    const { json } = await callTrend(tokenA);
    expect(["insufficient_measurements","insufficient_coverage","provisional","usable","stale"])
      .toContain((json.data as TrendOutput).status);
  });

  it("data.algorithm_versions.smoothing = weight_time_ewma_v3", async () => {
    const { json } = await callTrend(tokenA);
    expect((json.data as TrendOutput).algorithm_versions.smoothing).toBe("weight_time_ewma_v3");
  });

  it("data.algorithm_versions.interval = weight_rate_interval_sen_v1", async () => {
    const { json } = await callTrend(tokenA);
    expect((json.data as TrendOutput).algorithm_versions.interval).toBe("weight_rate_interval_sen_v1");
  });

  it("data.measurements block has required numeric fields", async () => {
    const { json } = await callTrend(tokenA);
    const m = (json.data as TrendOutput).measurements;
    expect(typeof m.raw_count).toBe("number");
    expect(typeof m.valid_count).toBe("number");
    expect(typeof m.distinct_modelling_days).toBe("number");
    expect(typeof m.excluded_count).toBe("number");
    expect(typeof m.largest_gap_days).toBe("number");
  });

  it("data.trend_points is an array", async () => {
    const { json } = await callTrend(tokenA);
    expect(Array.isArray((json.data as TrendOutput).trend_points)).toBe(true);
  });

  it("data.daily_representatives is an array", async () => {
    const { json } = await callTrend(tokenA);
    expect(Array.isArray((json.data as TrendOutput).daily_representatives)).toBe(true);
  });

  it("data.timezone is a non-empty string", async () => {
    const { json } = await callTrend(tokenA);
    expect(typeof (json.data as TrendOutput).timezone).toBe("string");
    expect((json.data as TrendOutput).timezone).not.toBe("");
  });

  it("data.weekly_rate is null or has estimate_kg", async () => {
    const { json } = await callTrend(tokenA);
    const wr = (json.data as TrendOutput).weekly_rate;
    if (wr !== null) {
      expect(typeof wr.estimate_kg).toBe("number");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Empty history → insufficient_measurements
// ═══════════════════════════════════════════════════════════════════════════════

describe("Empty history", () => {
  let emptyUid   = "";
  let emptyToken = "";
  const emptyEmail = `wt3-empty-${Date.now()}@test.local`;

  beforeAll(async () => {
    emptyUid = await createTestUser(emptyEmail);
    const { client } = await signInAs(emptyEmail);
    const { data: { session } } = await client.auth.getSession();
    emptyToken = session!.access_token;
  }, 20_000);

  afterAll(async () => { await deleteTestUser(emptyUid); });

  it("returns 200 with status = insufficient_measurements", async () => {
    const { status, json } = await callTrend(emptyToken);
    expect(status).toBe(200);
    expect((json.data as TrendOutput).status).toBe("insufficient_measurements");
  });

  it("warnings contains insufficient_measurements", async () => {
    const { json } = await callTrend(emptyToken);
    expect((json.data as TrendOutput).warnings).toContain("insufficient_measurements");
  });

  it("latest_raw_weight_kg = null", async () => {
    const { json } = await callTrend(emptyToken);
    expect((json.data as TrendOutput).latest_raw_weight_kg).toBeNull();
  });

  it("weekly_rate = null", async () => {
    const { json } = await callTrend(emptyToken);
    expect((json.data as TrendOutput).weekly_rate).toBeNull();
  });

  it("measurements.raw_count = 0", async () => {
    const { json } = await callTrend(emptyToken);
    expect((json.data as TrendOutput).measurements.raw_count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. display_window_days parameter
// ═══════════════════════════════════════════════════════════════════════════════

describe("display_window_days parameter", () => {
  beforeAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", userId);
    const entries = Array.from({ length: 60 }, (_, i) => ({
      weight_kg:   80 - i * 0.05,
      measured_at: new Date(Date.now() - (60 - i) * 86_400_000).toISOString(),
    }));
    await insertWeights(userId, entries);
  });

  it("default (28) returns trend_points", async () => {
    const { json } = await callTrend(tokenA);
    expect((json.data as TrendOutput).trend_points.length).toBeGreaterThan(0);
  });

  it("display_window_days=56 returns more trend_points than 28", async () => {
    const [r28, r56] = await Promise.all([
      callTrend(tokenA, { display_window_days: "28" }),
      callTrend(tokenA, { display_window_days: "56" }),
    ]);
    const n28 = (r28.json.data as TrendOutput).trend_points.length;
    const n56 = (r56.json.data as TrendOutput).trend_points.length;
    expect(n56).toBeGreaterThan(n28);
  });

  it("invalid display_window_days → 400 INVALID_PARAM", async () => {
    const { status, json } = await callTrend(tokenA, { display_window_days: "30" });
    expect(status).toBe(400);
    expect((json.error as Record<string, unknown>).code).toBe("INVALID_PARAM");
  });

  it("all allowed values return 200", async () => {
    const results = await Promise.all(
      ["7", "14", "28", "56", "84"].map((v) => callTrend(tokenA, { display_window_days: v })),
    );
    for (const r of results) expect(r.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Profile timezone
// ═══════════════════════════════════════════════════════════════════════════════

describe("Profile timezone — default UTC", () => {
  it("timezone field = UTC when profiles.timezone = 'UTC'", async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", userId);
    await svc.from("profiles").update({ timezone: "UTC" }).eq("id", userId);
    await insertWeights(userId, [
      { weight_kg: 80, measured_at: new Date(Date.now() - 5 * 86_400_000).toISOString() },
    ]);
    const { json } = await callTrend(tokenA);
    expect((json.data as TrendOutput).timezone).toBe("UTC");
  });
});

describe("Profile timezone — SAST explicit", () => {
  it("timezone field = Africa/Johannesburg when set in profile", async () => {
    const svc = svcClient();
    await svc.from("profiles").update({ timezone: "Africa/Johannesburg" }).eq("id", userId);
    const { json } = await callTrend(tokenA);
    expect((json.data as TrendOutput).timezone).toBe("Africa/Johannesburg");
    await svc.from("profiles").update({ timezone: "UTC" }).eq("id", userId);
  });
});

describe("Profile timezone — invalid stored value → 422", () => {
  let tzUid   = "";
  let tzToken = "";
  const tzEmail = `wt3-tz-${Date.now()}@test.local`;

  beforeAll(async () => {
    tzUid = await createTestUser(tzEmail);
    const { client } = await signInAs(tzEmail);
    const { data: { session } } = await client.auth.getSession();
    tzToken = session!.access_token;
    await svcClient().from("profiles").update({ timezone: "Not/A_Valid_Zone" }).eq("id", tzUid);
  }, 20_000);

  afterAll(async () => { await deleteTestUser(tzUid); });

  it("returns 422 with INVALID_PROFILE_TIMEZONE", async () => {
    const { status, json } = await callTrend(tzToken);
    expect(status).toBe(422);
    expect((json.error as Record<string, unknown>).code).toBe("INVALID_PROFILE_TIMEZONE");
  });

  it("returns client error (4xx), not server error (5xx)", async () => {
    const { status } = await callTrend(tzToken);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Fixture A — 28-day declining trend, full oracle parity
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixture A — 28-day decline, oracle parity", () => {
  let fxUid   = "";
  let fxToken = "";
  const fxEmail = `wt3-fixa-${Date.now()}@test.local`;
  const oracle  = loadOracle("A");

  beforeAll(async () => {
    fxUid = await createTestUser(fxEmail);
    const { client } = await signInAs(fxEmail);
    const { data: { session } } = await client.auth.getSession();
    fxToken = session!.access_token;
    await insertWeights(fxUid, oracle.input.raw_entries);
  }, 30_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", fxUid);
    await deleteTestUser(fxUid);
  });

  it(`measurements.raw_count = ${oracle.expected.measurements.raw_count} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).measurements.raw_count)
      .toBe(oracle.expected.measurements.raw_count);
  });

  it(`daily_representatives.length = ${oracle.expected.daily_representatives.length} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).daily_representatives.length)
      .toBe(oracle.expected.daily_representatives.length);
  });

  it(`latest_raw_weight_kg = ${oracle.expected.latest_raw_weight_kg} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).latest_raw_weight_kg)
      .toBe(oracle.expected.latest_raw_weight_kg);
  });

  it(`latest_trend_weight_kg ≈ ${oracle.expected.latest_trend_weight_kg} within 1e-6 (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect(approxEq(
      (json.data as TrendOutput).latest_trend_weight_kg,
      oracle.expected.latest_trend_weight_kg,
    )).toBe(true);
  });

  it("algorithm_versions.smoothing = weight_time_ewma_v3", async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).algorithm_versions.smoothing).toBe("weight_time_ewma_v3");
  });

  it("flagged_measurements is empty (oracle)", async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).flagged_measurements).toHaveLength(0);
  });

  it("API result matches fresh calculate() with same DB rows", async () => {
    const [apiRes, dbRows] = await Promise.all([
      callTrend(fxToken),
      readWeightLogs(fxUid),
    ]);
    const apiData  = apiRes.json.data as TrendOutput;
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "UTC");
    expect(approxEq(apiData.latest_trend_weight_kg, tsResult.latest_trend_weight_kg)).toBe(true);
    expect(apiData.measurements.raw_count).toBe(tsResult.measurements.raw_count);
    expect(apiData.daily_representatives.length).toBe(tsResult.daily_representatives.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Fixture C — sporadic cadence / insufficient status
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixture C — sporadic, insufficient status", () => {
  let fxUid   = "";
  let fxToken = "";
  const fxEmail = `wt3-fixc-${Date.now()}@test.local`;
  const oracle  = loadOracle("C");

  beforeAll(async () => {
    fxUid = await createTestUser(fxEmail);
    const { client } = await signInAs(fxEmail);
    const { data: { session } } = await client.auth.getSession();
    fxToken = session!.access_token;
    await insertWeights(fxUid, oracle.input.raw_entries);
  }, 30_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", fxUid);
    await deleteTestUser(fxUid);
  });

  it(`measurements.raw_count = ${oracle.expected.measurements.raw_count} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).measurements.raw_count)
      .toBe(oracle.expected.measurements.raw_count);
  });

  it(`daily_representatives.length = ${oracle.expected.daily_representatives.length} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).daily_representatives.length)
      .toBe(oracle.expected.daily_representatives.length);
  });

  it(`latest_raw_weight_kg = ${oracle.expected.latest_raw_weight_kg} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).latest_raw_weight_kg)
      .toBe(oracle.expected.latest_raw_weight_kg);
  });

  it("API result matches fresh calculate() with same DB rows", async () => {
    const [apiRes, dbRows] = await Promise.all([
      callTrend(fxToken),
      readWeightLogs(fxUid),
    ]);
    const apiData  = apiRes.json.data as TrendOutput;
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "UTC");
    expect(apiData.measurements.raw_count).toBe(tsResult.measurements.raw_count);
    expect(apiData.daily_representatives.length).toBe(tsResult.daily_representatives.length);
    expect(approxEq(apiData.latest_trend_weight_kg, tsResult.latest_trend_weight_kg)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Fixture G — SAST timezone boundary (2 SAST days from 4 entries)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixture G — SAST boundary timezone grouping", () => {
  let fxUid   = "";
  let fxToken = "";
  const fxEmail = `wt3-fixg-${Date.now()}@test.local`;
  const oracle  = loadOracle("G");

  beforeAll(async () => {
    fxUid = await createTestUser(fxEmail);
    await svcClient().from("profiles").update({ timezone: "Africa/Johannesburg" }).eq("id", fxUid);
    const { client } = await signInAs(fxEmail);
    const { data: { session } } = await client.auth.getSession();
    fxToken = session!.access_token;
    await insertWeights(fxUid, oracle.input.raw_entries);
  }, 30_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", fxUid);
    await deleteTestUser(fxUid);
  });

  it("timezone in response is Africa/Johannesburg", async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).timezone).toBe("Africa/Johannesburg");
  });

  it(`measurements.raw_count = ${oracle.expected.measurements.raw_count} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).measurements.raw_count)
      .toBe(oracle.expected.measurements.raw_count);
  });

  it(`daily_representatives.length = ${oracle.expected.daily_representatives.length} (2 SAST days)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).daily_representatives.length)
      .toBe(oracle.expected.daily_representatives.length);
  });

  it("second daily_rep source = latest_official_of_multiple", async () => {
    const { json } = await callTrend(fxToken);
    const dr = (json.data as TrendOutput).daily_representatives;
    expect(dr[1].source).toBe("latest_official_of_multiple");
  });

  it("API result matches fresh calculate(dbRows, now, Africa/Johannesburg)", async () => {
    const [apiRes, dbRows] = await Promise.all([
      callTrend(fxToken),
      readWeightLogs(fxUid),
    ]);
    const apiData  = apiRes.json.data as TrendOutput;
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "Africa/Johannesburg");
    expect(apiData.daily_representatives.length).toBe(tsResult.daily_representatives.length);
    expect(approxEq(apiData.latest_trend_weight_kg, tsResult.latest_trend_weight_kg)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Fixture H — same-day multiple official entries
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixture H — same-day multiple officials", () => {
  let fxUid   = "";
  let fxToken = "";
  const fxEmail = `wt3-fixh-${Date.now()}@test.local`;
  const oracle  = loadOracle("H");

  beforeAll(async () => {
    fxUid = await createTestUser(fxEmail);
    const { client } = await signInAs(fxEmail);
    const { data: { session } } = await client.auth.getSession();
    fxToken = session!.access_token;
    await insertWeights(fxUid, oracle.input.raw_entries);
  }, 30_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", fxUid);
    await deleteTestUser(fxUid);
  });

  it(`measurements.raw_count = ${oracle.expected.measurements.raw_count} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).measurements.raw_count)
      .toBe(oracle.expected.measurements.raw_count);
  });

  it(`daily_representatives.length = ${oracle.expected.daily_representatives.length} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).daily_representatives.length)
      .toBe(oracle.expected.daily_representatives.length);
  });

  it("daily_rep source = latest_official_of_multiple", async () => {
    const { json } = await callTrend(fxToken);
    const dr = (json.data as TrendOutput).daily_representatives;
    expect(dr[0].source).toBe("latest_official_of_multiple");
  });

  it(`latest_raw_weight_kg = ${oracle.expected.latest_raw_weight_kg} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).latest_raw_weight_kg)
      .toBe(oracle.expected.latest_raw_weight_kg);
  });

  it("warnings contains multiple_official_entries", async () => {
    const { json } = await callTrend(fxToken);
    const w = (json.data as TrendOutput).warnings;
    expect(w.some((s) => s.includes("multiple_official_entries"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Fixture I — full history stability (58 entries)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixture I — full history stability, 58 entries", () => {
  let fxUid   = "";
  let fxToken = "";
  const fxEmail = `wt3-fixi-${Date.now()}@test.local`;
  const oracle  = loadOracle("I");

  beforeAll(async () => {
    fxUid = await createTestUser(fxEmail);
    const { client } = await signInAs(fxEmail);
    const { data: { session } } = await client.auth.getSession();
    fxToken = session!.access_token;
    await insertWeights(fxUid, oracle.input.raw_entries);
  }, 30_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", fxUid);
    await deleteTestUser(fxUid);
  });

  it(`measurements.raw_count = ${oracle.expected.measurements.raw_count} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).measurements.raw_count)
      .toBe(oracle.expected.measurements.raw_count);
  });

  it(`daily_representatives.length = ${oracle.expected.daily_representatives.length} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).daily_representatives.length)
      .toBe(oracle.expected.daily_representatives.length);
  });

  it(`latest_raw_weight_kg = ${oracle.expected.latest_raw_weight_kg} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).latest_raw_weight_kg)
      .toBe(oracle.expected.latest_raw_weight_kg);
  });

  it(`latest_trend_weight_kg ≈ ${oracle.expected.latest_trend_weight_kg} within 1e-6 (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect(approxEq(
      (json.data as TrendOutput).latest_trend_weight_kg,
      oracle.expected.latest_trend_weight_kg,
    )).toBe(true);
  });

  it("API result matches fresh calculate() — full-history EWMA deterministic", async () => {
    const [apiRes, dbRows] = await Promise.all([
      callTrend(fxToken),
      readWeightLogs(fxUid),
    ]);
    const apiData  = apiRes.json.data as TrendOutput;
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "UTC");
    expect(approxEq(apiData.latest_trend_weight_kg, tsResult.latest_trend_weight_kg)).toBe(true);
    expect(apiData.measurements.raw_count).toBe(tsResult.measurements.raw_count);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Fixture J — outlier spike after gap (Huber capping)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixture J — outlier spike, Huber capping", () => {
  let fxUid   = "";
  let fxToken = "";
  const fxEmail = `wt3-fixj-${Date.now()}@test.local`;
  const oracle  = loadOracle("J");

  beforeAll(async () => {
    fxUid = await createTestUser(fxEmail);
    const { client } = await signInAs(fxEmail);
    const { data: { session } } = await client.auth.getSession();
    fxToken = session!.access_token;
    await insertWeights(fxUid, oracle.input.raw_entries);
  }, 30_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", fxUid);
    await deleteTestUser(fxUid);
  });

  it(`measurements.raw_count = ${oracle.expected.measurements.raw_count} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).measurements.raw_count)
      .toBe(oracle.expected.measurements.raw_count);
  });

  it(`latest_raw_weight_kg = ${oracle.expected.latest_raw_weight_kg} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).latest_raw_weight_kg)
      .toBe(oracle.expected.latest_raw_weight_kg);
  });

  it(`latest_trend_weight_kg ≈ ${oracle.expected.latest_trend_weight_kg} within 1e-6 (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect(approxEq(
      (json.data as TrendOutput).latest_trend_weight_kg,
      oracle.expected.latest_trend_weight_kg,
    )).toBe(true);
  });

  it("some trend_points have huber_capped=true when spike is in display window", async () => {
    const [apiRes, dbRows] = await Promise.all([
      callTrend(fxToken, { display_window_days: "84" }),
      readWeightLogs(fxUid),
    ]);
    const apiData  = apiRes.json.data as TrendOutput;
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "UTC", 84);
    expect(tsResult.trend_points.some((p) => p.huber_capped)).toBe(true);
    expect(apiData.trend_points.some((p) => p.huber_capped)).toBe(true);
  });

  it("API result matches fresh calculate()", async () => {
    const [apiRes, dbRows] = await Promise.all([
      callTrend(fxToken),
      readWeightLogs(fxUid),
    ]);
    const apiData  = apiRes.json.data as TrendOutput;
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "UTC");
    expect(approxEq(apiData.latest_trend_weight_kg, tsResult.latest_trend_weight_kg)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Fixture L — weekly user, adaptive rate window
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fixture L — weekly user, adaptive rate window", () => {
  let fxUid   = "";
  let fxToken = "";
  const fxEmail = `wt3-fixl-${Date.now()}@test.local`;
  const oracle  = loadOracle("L");

  beforeAll(async () => {
    fxUid = await createTestUser(fxEmail);
    const { client } = await signInAs(fxEmail);
    const { data: { session } } = await client.auth.getSession();
    fxToken = session!.access_token;
    await insertWeights(fxUid, oracle.input.raw_entries);
  }, 30_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", fxUid);
    await deleteTestUser(fxUid);
  });

  it(`measurements.raw_count = ${oracle.expected.measurements.raw_count} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).measurements.raw_count)
      .toBe(oracle.expected.measurements.raw_count);
  });

  it(`latest_raw_weight_kg = ${oracle.expected.latest_raw_weight_kg} (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect((json.data as TrendOutput).latest_raw_weight_kg)
      .toBe(oracle.expected.latest_raw_weight_kg);
  });

  it(`latest_trend_weight_kg ≈ ${oracle.expected.latest_trend_weight_kg} within 1e-6 (oracle)`, async () => {
    const { json } = await callTrend(fxToken);
    expect(approxEq(
      (json.data as TrendOutput).latest_trend_weight_kg,
      oracle.expected.latest_trend_weight_kg,
    )).toBe(true);
  });

  it("API selected_rate_window matches fresh calculate() for today's date", async () => {
    const [apiRes, dbRows] = await Promise.all([
      callTrend(fxToken),
      readWeightLogs(fxUid),
    ]);
    const apiData  = apiRes.json.data as TrendOutput;
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "UTC");
    expect(approxEq(apiData.latest_trend_weight_kg, tsResult.latest_trend_weight_kg)).toBe(true);
    expect(apiData.measurements.selected_rate_window_days)
      .toBe(tsResult.measurements.selected_rate_window_days);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Cross-user isolation (RLS)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cross-user isolation", () => {
  beforeAll(async () => {
    const svc = svcClient();
    await Promise.all([
      svc.from("weight_logs").delete().eq("user_id", userId),
      svc.from("weight_logs").delete().eq("user_id", userBId),
    ]);
    await insertWeights(userId, [
      { weight_kg: 80,   measured_at: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      { weight_kg: 79.5, measured_at: new Date(Date.now() - 14 * 86_400_000).toISOString() },
      { weight_kg: 79.2, measured_at: new Date(Date.now() -  7 * 86_400_000).toISOString() },
      { weight_kg: 79.0, measured_at: new Date(Date.now() -  3 * 86_400_000).toISOString() },
      { weight_kg: 78.8, measured_at: new Date(Date.now() -  1 * 86_400_000).toISOString() },
    ]);
  });

  it("user A sees their own data (raw_count > 0)", async () => {
    const { json } = await callTrend(tokenA);
    expect((json.data as TrendOutput).measurements.raw_count).toBeGreaterThan(0);
  });

  it("user B sees empty trend (raw_count = 0), not user A's data", async () => {
    const { json } = await callTrend(tokenB);
    expect((json.data as TrendOutput).measurements.raw_count).toBe(0);
  });

  it("user_id query param is ignored — user B still sees no data", async () => {
    const { json } = await callTrend(tokenB, { user_id: userId });
    expect((json.data as TrendOutput).measurements.raw_count).toBe(0);
  });

  it("user B latest_raw_weight_kg is null (no cross-user data leak)", async () => {
    const { json } = await callTrend(tokenB);
    expect((json.data as TrendOutput).latest_raw_weight_kg).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. More than 1,000 weight logs — pagination correctness
// ═══════════════════════════════════════════════════════════════════════════════

describe("More than 1,000 weight logs — pagination correctness", () => {
  const ROW_COUNT = 1_100;
  let bigUid      = "";
  let bigToken    = "";
  const bigEmail  = `wt3-big-${Date.now()}@test.local`;

  let apiData:  TrendOutput | null = null;
  let apiBytes  = 0;
  let totalMs   = 0;

  beforeAll(async () => {
    bigUid = await createTestUser(bigEmail);
    const { client } = await signInAs(bigEmail);
    const { data: { session } } = await client.auth.getSession();
    bigToken = session!.access_token;
    const entries = Array.from({ length: ROW_COUNT }, (_, i) => ({
      weight_kg:   100 - (i / ROW_COUNT) * 10,
      measured_at: new Date(Date.now() - (ROW_COUNT - i) * 86_400_000).toISOString(),
    }));
    await insertWeights(bigUid, entries);
  }, 120_000);

  afterAll(async () => {
    await svcClient().from("weight_logs").delete().eq("user_id", bigUid);
    await deleteTestUser(bigUid);
  }, 30_000);

  it(`API call succeeds with ${ROW_COUNT} rows`, async () => {
    const t0  = Date.now();
    const res = await callTrend(bigToken);
    totalMs   = Date.now() - t0;
    expect(res.status).toBe(200);
    apiData  = res.json.data as TrendOutput;
    apiBytes = JSON.stringify(res.json).length;
  }, 60_000);

  it(`measurements.raw_count = ${ROW_COUNT} (not truncated at 1,000)`, () => {
    expect(apiData).not.toBeNull();
    expect(apiData!.measurements.raw_count).toBe(ROW_COUNT);
  });

  it("result matches direct calculate() with all rows (EWMA uses full history)", async () => {
    const dbRows   = await readWeightLogs(bigUid);
    expect(dbRows.length).toBe(ROW_COUNT);
    const tsResult = tsCalculate(dbRows, new Date().toISOString(), "UTC");
    expect(approxEq(apiData!.latest_trend_weight_kg, tsResult.latest_trend_weight_kg, 1e-4)).toBe(true);
  }, 30_000);

  it("first historical entry influences EWMA (trend differs from first raw weight)", () => {
    const firstRaw    = apiData!.daily_representatives[0].weight_kg;
    const latestTrend = apiData!.latest_trend_weight_kg!;
    expect(Math.abs(latestTrend - firstRaw)).toBeGreaterThan(0.1);
  });

  it("performance soft guard: total response time < 30 s", () => {
    console.log("PERF 1100 rows:", { raw_row_count: ROW_COUNT, total_ms: totalMs, response_bytes: apiBytes });
    expect(totalMs).toBeLessThan(30_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Read-only guarantee
// ═══════════════════════════════════════════════════════════════════════════════

describe("Read-only guarantee", () => {
  beforeAll(async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", userId);
    await insertWeights(userId, [
      { weight_kg: 80,   measured_at: new Date(Date.now() - 10 * 86_400_000).toISOString() },
      { weight_kg: 79.5, measured_at: new Date(Date.now() -  5 * 86_400_000).toISOString() },
      { weight_kg: 79.2, measured_at: new Date(Date.now() -  1 * 86_400_000).toISOString() },
    ]);
  });

  it("weight_logs row count unchanged after API call", async () => {
    const svc = svcClient();
    const { count: before } = await svc
      .from("weight_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    await callTrend(tokenA);
    const { count: after } = await svc
      .from("weight_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(after).toBe(before);
  });

  it("profiles updated_at unchanged after API call", async () => {
    const svc = svcClient();
    const { data: before } = await svc.from("profiles").select("updated_at").eq("id", userId).single();
    await callTrend(tokenA);
    const { data: after } = await svc.from("profiles").select("updated_at").eq("id", userId).single();
    expect((after as Record<string, unknown>).updated_at)
      .toBe((before as Record<string, unknown>).updated_at);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. Deterministic calculation — two concurrent calls agree
// ═══════════════════════════════════════════════════════════════════════════════

describe("Deterministic calculation", () => {
  it("two concurrent calls return the same latest_trend_weight_kg", async () => {
    const svc = svcClient();
    await svc.from("weight_logs").delete().eq("user_id", userId);
    await insertWeights(userId, [
      { weight_kg: 80,   measured_at: new Date(Date.now() - 20 * 86_400_000).toISOString() },
      { weight_kg: 79.5, measured_at: new Date(Date.now() - 14 * 86_400_000).toISOString() },
      { weight_kg: 79.0, measured_at: new Date(Date.now() -  7 * 86_400_000).toISOString() },
      { weight_kg: 78.8, measured_at: new Date(Date.now() -  1 * 86_400_000).toISOString() },
    ]);
    const [r1, r2] = await Promise.all([callTrend(tokenA), callTrend(tokenA)]);
    const t1 = (r1.json.data as TrendOutput).latest_trend_weight_kg;
    const t2 = (r2.json.data as TrendOutput).latest_trend_weight_kg;
    expect(approxEq(t1, t2, 1e-4)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. Performance benchmarks (informational — soft guards only)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Performance measurements", () => {
  for (const n of [28, 365]) {
    it(`${n} rows: API responds in < 10 s`, async () => {
      let perfUid   = "";
      let perfToken = "";
      const perfEmail = `wt3-perf${n}-${Date.now()}@test.local`;
      try {
        perfUid = await createTestUser(perfEmail);
        const { client } = await signInAs(perfEmail);
        const { data: { session } } = await client.auth.getSession();
        perfToken = session!.access_token;
        await insertWeights(perfUid, Array.from({ length: n }, (_, i) => ({
          weight_kg:   Math.max(20, 80 - i * 0.01),
          measured_at: new Date(Date.now() - (n - i) * 86_400_000).toISOString(),
        })));
        const t0  = Date.now();
        const res = await callTrend(perfToken);
        const ms  = Date.now() - t0;
        console.log(`PERF ${n} rows:`, { n, total_ms: ms, response_bytes: JSON.stringify(res.json).length });
        expect(res.status).toBe(200);
        expect(ms).toBeLessThan(10_000);
      } finally {
        if (perfUid) {
          await svcClient().from("weight_logs").delete().eq("user_id", perfUid);
          await deleteTestUser(perfUid);
        }
      }
    }, 30_000);
  }
});
