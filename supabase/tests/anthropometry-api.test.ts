// Phase 10, Gate 3 — real Supabase integration tests.
// Requires: supabase start + supabase functions serve
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  ANON_KEY,
  SUPABASE_URL,
  createTestUser,
  deleteTestUser,
  signInAs,
  svcClient,
  testEmail,
} from "./helpers.js";

type Envelope<T = Record<string, unknown>> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
};

type SaveBody = {
  session_id?: string;
  status: "draft" | "finalized";
  measured_at?: string;
  notes?: string;
  measurement_context?: Record<string, unknown>;
  protocol_version: "anthropometry_protocol_v1";
  idempotency_key?: string;
  high_variability_acknowledgements?: Array<{ site_code: string; acknowledged: true }>;
  sites: Array<{ site_code: string; readings_cm: number[] }>;
  representatives?: unknown;
};

const EMAIL_A = testEmail("anthropometry-api-a");
const EMAIL_B = testEmail("anthropometry-api-b");
const EMAIL_PAGING = testEmail("anthropometry-api-paging");
let userIdA = "";
let userIdB = "";
let userIdPaging = "";
let tokenA = "";
let tokenB = "";
let tokenPaging = "";
let clientA: Awaited<ReturnType<typeof signInAs>>["client"];
let clientB: Awaited<ReturnType<typeof signInAs>>["client"];
let clientPaging: Awaited<ReturnType<typeof signInAs>>["client"];
const DB_URL = process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54422/postgres";

async function tokenFor(client: typeof clientA): Promise<string> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error("Test user has no session");
  return data.session.access_token;
}

async function callFunction<T>(
  name: string,
  token: string | null,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
  query = "",
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}${query}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Envelope<T> };
}

function finalBody(
  key: string,
  measuredAt: string,
  sites: SaveBody["sites"] = [{ site_code: "waist", readings_cm: [90, 90.8] }],
): SaveBody {
  return {
    status: "finalized",
    measured_at: measuredAt,
    protocol_version: "anthropometry_protocol_v1",
    idempotency_key: key,
    sites,
  };
}

async function save(token: string, body: SaveBody) {
  return callFunction<{
    session: Record<string, unknown> & { id: string };
    sites: Array<Record<string, unknown> & { readings_cm: number[] }>;
    replayed: boolean;
  }>("save-anthropometric-session", token, "POST", body);
}

async function finalize(token: string, body: Omit<SaveBody, "status">) {
  return callFunction<{
    session: Record<string, unknown> & { id: string };
    sites: Array<Record<string, unknown> & { readings_cm: number[] }>;
    replayed: boolean;
  }>("finalize-anthropometric-session", token, "POST", body);
}

beforeAll(async () => {
  userIdA = await createTestUser(EMAIL_A);
  userIdB = await createTestUser(EMAIL_B);
  userIdPaging = await createTestUser(EMAIL_PAGING);
  ({ client: clientA } = await signInAs(EMAIL_A));
  ({ client: clientB } = await signInAs(EMAIL_B));
  ({ client: clientPaging } = await signInAs(EMAIL_PAGING));
  tokenA = await tokenFor(clientA);
  tokenB = await tokenFor(clientB);
  tokenPaging = await tokenFor(clientPaging);
});

afterAll(async () => {
  const service = svcClient();
  await service.from("anthropometric_sessions").delete().in("user_id", [userIdA, userIdB]);
  await deleteTestUser(userIdA);
  await deleteTestUser(userIdB);
  await deleteTestUser(userIdPaging);
});

describe("anthropometry endpoint authentication", () => {
  it.each([
    ["save-anthropometric-session", "POST"],
    ["finalize-anthropometric-session", "POST"],
    ["get-anthropometric-sessions", "GET"],
    ["get-anthropometric-progress", "GET"],
    ["delete-anthropometric-session", "DELETE"],
  ] as const)("rejects an unauthenticated %s request", async (name, method) => {
    const result = await callFunction(name, null, method);
    expect(result.status).toBe(401);
  });
});

describe("longitudinal progress and Phase 6 comparison", () => {
  beforeAll(async () => {
    await save(tokenA, finalBody(
      `progress-start-${Date.now()}`,
      "2026-06-01T06:00:00Z",
      [{ site_code: "waist", readings_cm: [91.8, 92.2] }],
    ));
    await save(tokenA, finalBody(
      `progress-end-${Date.now()}`,
      "2026-08-01T06:00:00Z",
      [{ site_code: "waist", readings_cm: [88.4, 88.8] }],
    ));

    const service = svcClient();
    const dates = [
      "2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22",
      "2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20",
      "2026-07-24", "2026-07-27", "2026-07-30", "2026-08-01",
    ];
    for (const [index, date] of dates.entries()) {
      const { error } = await service.rpc("fn_log_weight", {
        p_user_id: userIdA,
        p_weight_kg: 80 + (index % 2) * 0.1,
        p_measured_at: `${date}T06:00:00Z`,
        p_logged_date: date,
        p_notes: "phase-10-gate-5",
      });
      if (error) throw error;
    }
  });

  it("returns chronological real points with previous and first-baseline changes", async () => {
    type ProgressResponse = {
      series: Array<{
        site_code: string;
        points: Array<{ measured_at: string; representative_cm: number }>;
        change_summary: {
          previous: { change_cm: number; elapsed_days: number } | null;
          baseline: { change_cm: number; elapsed_days: number } | null;
        } | null;
      }>;
      weight_comparison: {
        eligible: boolean;
        description: string | null;
      } | null;
      algorithm_versions: Record<string, string>;
    };
    const result = await callFunction<ProgressResponse>(
      "get-anthropometric-progress",
      tokenA,
      "GET",
      undefined,
      "?from=2026-06-01T00%3A00%3A00Z&to=2026-08-02T00%3A00%3A00Z",
    );
    expect(result.status).toBe(200);
    const waist = result.body.data!.series.find((series) => series.site_code === "waist")!;
    expect(waist.points.length).toBeGreaterThanOrEqual(2);
    expect(waist.points.map((point) => point.measured_at))
      .toEqual([...waist.points].map((point) => point.measured_at).sort());
    expect(waist.change_summary?.baseline).toMatchObject({ change_cm: -3.4, elapsed_days: 61 });
    expect(result.body.data!.algorithm_versions).toMatchObject({
      change_summary: "anthropometry_change_summary_v2",
      context_comparison: "anthropometry_context_comparison_v1",
      protocol_compatibility: "anthropometry_protocol_compatibility_v1",
      weight_comparison: "anthropometry_weight_comparison_v2",
    });
  });

  it("generates only the versioned descriptive weight comparison", async () => {
    const result = await callFunction<{
      weight_comparison: { eligible: boolean; site_code: string; message_code: string | null; description: string | null };
    }>(
      "get-anthropometric-progress",
      tokenA,
      "GET",
      undefined,
      "?from=2026-06-01T00%3A00%3A00Z&to=2026-08-02T00%3A00%3A00Z",
    );
    expect(result.body.data!.weight_comparison).toMatchObject({
      eligible: true,
      site_code: "waist",
      message_code: expect.stringMatching(/^waist_decreasing_weight_/),
      description: expect.stringMatching(/weight trend .* while waist circumference decreased/i),
    });
    expect(result.body.data!.weight_comparison.description).not.toMatch(/fat|muscle|recomposition/i);
  });

  it("does not expose another user's progress", async () => {
    const result = await callFunction<{ series: unknown[] }>(
      "get-anthropometric-progress",
      tokenB,
      "GET",
    );
    expect(result.status).toBe(200);
    expect(result.body.data!.series).toEqual([]);
  });

  it("validates range/site filters and can disable the weight comparison", async () => {
    const unknownSite = await callFunction(
      "get-anthropometric-progress",
      tokenA,
      "GET",
      undefined,
      "?site_code=abdomen",
    );
    expect(unknownSite.status).toBe(422);
    expect(unknownSite.body.error?.code).toBe("UNKNOWN_SITE");

    const reversedRange = await callFunction(
      "get-anthropometric-progress",
      tokenA,
      "GET",
      undefined,
      "?from=2026-08-02T00%3A00%3A00Z&to=2026-06-01T00%3A00%3A00Z",
    );
    expect(reversedRange.status).toBe(422);
    expect(reversedRange.body.error?.code).toBe("VALIDATION_ERROR");

    const filtered = await callFunction<{
      series: Array<{ site_code: string }>;
      weight_comparison: unknown;
    }>(
      "get-anthropometric-progress",
      tokenA,
      "GET",
      undefined,
      "?site_code=hips&include_weight_comparison=false",
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.data!.series.every((series) => series.site_code === "hips")).toBe(true);
    expect(filtered.body.data!.weight_comparison).toBeNull();
  });

  it("does not mutate calorie targets, goal phases, or plateau assessments", async () => {
    const service = svcClient();
    async function snapshot() {
      const [phases, targets, feedback] = await Promise.all([
        service.from("goal_phases").select("*").eq("user_id", userIdA).order("id"),
        service.from("calorie_target_snapshots").select("*").eq("user_id", userIdA).order("id"),
        service.from("goal_feedback_assessments").select("*").eq("user_id", userIdA).order("id"),
      ]);
      return {
        phases: phases.data,
        targets: targets.data,
        feedback: feedback.data,
      };
    }
    const before = await snapshot();
    const result = await callFunction(
      "get-anthropometric-progress",
      tokenA,
      "GET",
    );
    expect(result.status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});

describe("draft and server-authoritative finalization", () => {
  let sessionId = "";
  const idempotencyKey = `final-${Date.now()}`;

  it("atomically creates a partial draft without representatives", async () => {
    const result = await save(tokenA, {
      status: "draft",
      measured_at: "2026-07-01T07:00:00Z",
      notes: "  morning draft  ",
      measurement_context: {
        meal_timing: "before_food", after_bathroom: true,
        exercise_within_previous_12_hours: false,
        measurement_assistance: "self", clothing_level: "minimal",
      },
      protocol_version: "anthropometry_protocol_v1",
      sites: [{ site_code: "waist", readings_cm: [90.1] }],
    });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    sessionId = result.body.data!.session.id;
    expect(result.body.data!.session.status).toBe("draft");
    expect(result.body.data!.session.notes).toBe("morning draft");
    expect(result.body.data!.session.measurement_context).toMatchObject({
      version: "anthropometry_measurement_context_v1",
      local_time: "07:00:00",
      meal_timing: "before_food",
      after_bathroom: true,
    });
    expect(result.body.data!.sites).toEqual([expect.objectContaining({
      site_code: "waist",
      readings_cm: [90.1],
      raw_readings: [expect.objectContaining({ reading_index: 1, value_cm: 90.1 })],
    })]);
  });

  it("replaces draft readings rather than merging stale values", async () => {
    const result = await save(tokenA, {
      session_id: sessionId,
      status: "draft",
      measured_at: "2026-07-01T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      sites: [{ site_code: "waist", readings_cm: [90, 90.8] }],
    });
    expect(result.status).toBe(200);
    expect(result.body.data!.sites[0].readings_cm).toEqual([90, 90.8]);
  });

  it("calculates and stores server-authoritative representatives", async () => {
    const body: Omit<SaveBody, "status"> = {
      session_id: sessionId,
      measured_at: "2026-07-01T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: idempotencyKey,
      measurement_context: {
        meal_timing: "before_food", after_bathroom: true,
        exercise_within_previous_12_hours: false,
        measurement_assistance: "self", clothing_level: "minimal",
      },
      sites: [
        { site_code: "waist", readings_cm: [90, 90.8] },
        { site_code: "abdomen_navel", readings_cm: [95, 97, 96] },
      ],
    };
    const result = await finalize(tokenA, body);
    expect(result.status).toBe(201);
    expect(result.body.data!.replayed).toBe(false);
    const sites = result.body.data!.sites;
    expect(sites).toHaveLength(2);
    expect(sites.find((row) => row.site_code === "waist")).toMatchObject({
      representative_cm: 90.4,
      method: "mean_of_two",
      quality: "pair_agree",
      selected_reading_indices: [1, 2],
      eligible_for_interpretation: true,
      algorithm_version: "anthropometry_representative_v3",
    });
    expect(sites.find((row) => row.site_code === "abdomen_navel")).toMatchObject({
      representative_cm: 95.5,
      method: "mean_of_closest_pair",
      quality: "pair_agree",
      selected_reading_indices: [1, 3],
    });
    expect(result.body.data!.session).toMatchObject({
      local_time: "07:00:00",
      measurement_context_version: "anthropometry_measurement_context_v1",
      measurement_context: {
        meal_timing: "before_food", after_bathroom: true,
        exercise_within_previous_12_hours: false,
        measurement_assistance: "self", clothing_level: "minimal",
      },
    });
  });

  it("rejects malformed context and client-supplied canonical local time", async () => {
    const wrongType = await save(tokenA, {
      status: "draft", protocol_version: "anthropometry_protocol_v1", sites: [],
      measurement_context: { after_bathroom: "yes" },
    });
    expect(wrongType.status).toBe(422);
    expect(wrongType.body.error?.code).toBe("VALIDATION_ERROR");
    const unknownEnum = await save(tokenA, {
      status: "draft", protocol_version: "anthropometry_protocol_v1", sites: [],
      measurement_context: { meal_timing: "fasted" },
    });
    expect(unknownEnum.status).toBe(422);
    const forged = await callFunction(
      "save-anthropometric-session", tokenA, "POST", {
        status: "draft", protocol_version: "anthropometry_protocol_v1", sites: [],
        measurement_context: { local_time: "06:00:00" },
      },
    );
    expect(forged.status).toBe(422);
    expect(forged.body.error?.code).toBe("FORBIDDEN_FIELD");
  });

  it("rejects client-supplied representative fields", async () => {
    const result = await save(tokenA, {
      status: "finalized",
      measured_at: "2026-07-02T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `forged-${Date.now()}`,
      sites: [{
        site_code: "waist",
        readings_cm: [90, 90.8],
        representative_cm: 1,
        quality: "high_variability",
      } as unknown as { site_code: string; readings_cm: number[] }],
    });
    expect(result.status).toBe(422);
    expect(result.body.error?.code).toBe("FORBIDDEN_FIELD");
  });

  it("rejects future timestamps using the versioned five-minute tolerance", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const result = await finalize(tokenA, {
      measured_at: future,
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `future-${Date.now()}`,
      sites: [{ site_code: "waist", readings_cm: [90, 90.8] }],
    });
    expect(result.status).toBe(422);
    expect(result.body.error?.code).toBe("FUTURE_MEASUREMENT");
  });

  it("leaves an existing draft untouched when final validation fails", async () => {
    const draft = await save(tokenA, {
      status: "draft",
      protocol_version: "anthropometry_protocol_v1",
      sites: [{ site_code: "chest", readings_cm: [99.1] }],
    });
    const draftId = draft.body.data!.session.id;
    const failed = await finalize(tokenA, {
      session_id: draftId,
      measured_at: "2026-07-03T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `rollback-${Date.now()}`,
      sites: [{ site_code: "chest", readings_cm: [99, 101] }],
    });
    expect(failed.status).toBe(422);
    expect(failed.body.error?.code).toBe("THIRD_READING_REQUIRED");
    const { data: session } = await svcClient().from("anthropometric_sessions")
      .select("status").eq("id", draftId).single();
    const { data: readings } = await svcClient().from("anthropometric_readings")
      .select("value_cm").eq("session_id", draftId);
    expect(session?.status).toBe("draft");
    expect(readings?.map((row) => Number(row.value_cm))).toEqual([99.1]);
  });

  it("requires acknowledgement, then saves high variability as interpretation-ineligible", async () => {
    const draft = await save(tokenA, {
      status: "draft",
      protocol_version: "anthropometry_protocol_v1",
      sites: [{ site_code: "waist", readings_cm: [80, 82, 84.5] }],
    });
    const draftId = draft.body.data!.session.id;

    const failed = await finalize(tokenA, {
      session_id: draftId,
      measured_at: "2026-07-03T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `low-confidence-${Date.now()}`,
      sites: [{ site_code: "waist", readings_cm: [80, 82, 84.5] }],
    });

    expect(failed.status).toBe(422);
    expect(failed.body.error?.code).toBe("HIGH_VARIABILITY_CONFIRMATION_REQUIRED");
    expect(failed.body.data).toMatchObject({
      sites: [{
        representative_cm: 81,
        selected_reading_indices: [1, 2],
        selected_pair_spread_cm: 2,
        quality: "high_variability",
        eligible_for_interpretation: false,
        warning_codes: ["no_pair_within_repeatability_threshold"],
      }],
    });
    const { data: session } = await svcClient().from("anthropometric_sessions")
      .select("status").eq("id", draftId).single();
    const { data: readings } = await svcClient().from("anthropometric_readings")
      .select("value_cm").eq("session_id", draftId).order("reading_number");
    const { count: representativeCount } = await svcClient()
      .from("anthropometric_representatives")
      .select("site_code", { count: "exact", head: true })
      .eq("session_id", draftId);
    expect(session?.status).toBe("draft");
    expect(readings?.map((row) => Number(row.value_cm))).toEqual([80, 82, 84.5]);
    expect(representativeCount).toBe(0);

    const saved = await finalize(tokenA, {
      session_id: draftId,
      measured_at: "2026-07-03T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `low-confidence-save-${Date.now()}`,
      sites: [{ site_code: "waist", readings_cm: [80, 82, 84.5] }],
      high_variability_acknowledgements: [{ site_code: "waist", acknowledged: true }],
    });
    expect(saved.status).toBe(201);
    expect(saved.body.data!.sites[0]).toMatchObject({
      representative_cm: 81,
      selected_reading_indices: [1, 2],
      quality: "high_variability",
      eligible_for_interpretation: false,
      quality_acknowledgement_version: "anthropometry_high_variability_ack_v1",
    });
    expect(saved.body.data!.sites[0].quality_acknowledged_at).toEqual(expect.any(String));
  });

  it("returns the stable second-reading error for a one-reading finalization", async () => {
    const failed = await finalize(tokenA, {
      measured_at: "2026-07-03T07:30:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `second-required-${Date.now()}`,
      sites: [{ site_code: "waist", readings_cm: [80] }],
    });
    expect(failed.status).toBe(422);
    expect(failed.body.error?.code).toBe("SECOND_READING_REQUIRED");
  });

  it("preserves an isolated reading and persists the exact selected source IDs", async () => {
    const result = await save(tokenA, finalBody(
      `isolated-${Date.now()}`,
      "2026-07-03T08:00:00Z",
      [{ site_code: "waist", readings_cm: [80, 80.2, 50] }],
    ));
    expect(result.status).toBe(201);
    const site = result.body.data!.sites[0];
    expect(site).toMatchObject({
      readings_cm: [80, 80.2, 50],
      representative_cm: 80.1,
      selected_reading_indices: [1, 2],
      quality: "pair_agree_with_isolated_reading",
      warning_codes: ["isolated_reading_excluded"],
      eligible_for_interpretation: true,
    });
    const raw = site.raw_readings as Array<{ id: string; reading_index: number }>;
    expect(site.source_reading_ids).toEqual([raw[0].id, raw[1].id]);
    expect(site.unselected_reading_id).toBe(raw[2].id);
  });

  it("persists the frozen closest-pair tie as readings 1 and 2", async () => {
    const result = await save(tokenA, finalBody(
      `tie-${Date.now()}`,
      "2026-07-03T09:00:00Z",
      [{ site_code: "hips", readings_cm: [80, 81, 82] }],
    ));
    expect(result.status).toBe(201);
    expect(result.body.data!.sites[0]).toMatchObject({
      representative_cm: 80.5,
      selected_reading_indices: [1, 2],
      quality: "pair_agree",
    });
  });

  it("rejects acknowledgements that do not match a server-calculated high-variability site", async () => {
    const result = await finalize(tokenA, {
      measured_at: "2026-07-03T10:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `invalid-ack-${Date.now()}`,
      sites: [{ site_code: "waist", readings_cm: [80, 80.2] }],
      high_variability_acknowledgements: [{ site_code: "waist", acknowledged: true }],
    });
    expect(result.status).toBe(422);
    expect(result.body.error?.code).toBe("INVALID_HIGH_VARIABILITY_ACKNOWLEDGEMENT");
  });

  it("replays the same idempotent finalization without another row", async () => {
    const result = await finalize(tokenA, {
      session_id: sessionId,
      measured_at: "2026-07-01T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: idempotencyKey,
      measurement_context: {
        meal_timing: "before_food", after_bathroom: true,
        exercise_within_previous_12_hours: false,
        measurement_assistance: "self", clothing_level: "minimal",
      },
      sites: [
        { site_code: "waist", readings_cm: [90, 90.8] },
        { site_code: "abdomen_navel", readings_cm: [95, 97, 96] },
      ],
    });
    expect(result.status).toBe(200);
    expect(result.body.data!.replayed).toBe(true);
    expect(result.body.data!.session.id).toBe(sessionId);
    const { count } = await svcClient().from("anthropometric_sessions")
      .select("id", { count: "exact", head: true }).eq("user_id", userIdA)
      .eq("idempotency_key", idempotencyKey);
    expect(count).toBe(1);
  });

  it("rejects reuse of an idempotency key for a different payload", async () => {
    const result = await save(tokenA, {
      status: "finalized",
      measured_at: "2026-07-01T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: idempotencyKey,
      sites: [{ site_code: "waist", readings_cm: [91, 91.8] }],
    });
    expect(result.status).toBe(409);
    expect(result.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("serializes concurrent retries to one finalized session", async () => {
    const request = {
      measured_at: "2026-07-04T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1" as const,
      idempotency_key: `concurrent-${Date.now()}`,
      sites: [{ site_code: "neck", readings_cm: [38, 38.4] }],
    };
    const [left, right] = await Promise.all([
      finalize(tokenA, request),
      finalize(tokenA, request),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(left.body.data!.session.id).toBe(right.body.data!.session.id);
    expect([left.body.data!.replayed, right.body.data!.replayed].sort())
      .toEqual([false, true]);
  });

  it("blocks API and direct-table mutation after finalization", async () => {
    const apiResult = await save(tokenA, {
      session_id: sessionId,
      status: "draft",
      protocol_version: "anthropometry_protocol_v1",
      sites: [{ site_code: "waist", readings_cm: [91] }],
    });
    expect(apiResult.status).toBe(409);
    expect(apiResult.body.error?.code).toBe("SESSION_IMMUTABLE");

    const { data: rlsUpdateRows, error: rlsUpdateError } = await clientA
      .from("anthropometric_sessions")
      .update({ notes: "changed" }).eq("id", sessionId).select("id");
    expect(rlsUpdateError).toBeTruthy();
    expect(rlsUpdateRows).toBeNull();
    const { error: privilegedUpdateError } = await svcClient()
      .from("anthropometric_sessions").update({ notes: "changed" }).eq("id", sessionId);
    expect(privilegedUpdateError).toBeTruthy();
    const { error: readingError } = await clientA.from("anthropometric_readings").insert({
      session_id: sessionId,
      site_code: "chest",
      reading_number: 1,
      value_cm: 100,
    });
    expect(readingError).toBeTruthy();
  });

  it("does not expose the privileged persistence RPC to authenticated users", async () => {
    const { error } = await clientA.rpc("fn_save_anthropometric_session", {
      p_user_id: userIdA,
      p_session_id: null,
      p_status: "draft",
      p_measured_at: null,
      p_notes: null,
      p_readings: [],
      p_representatives: null,
      p_logged_date: null,
      p_timezone: null,
      p_idempotency_key: null,
      p_payload_hash: null,
      p_data_contract_version: "anthropometry_data_contract_v3",
      p_protocol_version: "anthropometry_protocol_v1",
      p_representative_algorithm_version: null,
      p_thresholds_version: null,
    });
    expect(error).toBeTruthy();
  });

  it("keeps historical v2 values/version intact with explicitly unavailable v3 provenance", async () => {
    const sessionId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        `INSERT INTO public.anthropometric_sessions
          (id, user_id, status, measured_at, data_contract_version, protocol_version)
         VALUES ($1, $2, 'draft', '2026-05-01T06:00:00Z',
           'anthropometry_data_contract_v2', 'anthropometry_protocol_v1')`,
        [sessionId, userIdA],
      );
      await db.query(
        `INSERT INTO public.anthropometric_readings
          (id, session_id, user_id, site_code, reading_number, value_cm)
         VALUES ($1, $3, $4, 'neck', 1, 40), ($2, $3, $4, 'neck', 2, 40.4)`,
        [firstId, secondId, sessionId, userIdA],
      );
      await db.query(
        `UPDATE public.anthropometric_sessions SET status = 'finalized',
           logged_date = '2026-05-01', timezone = 'Africa/Johannesburg',
           representative_algorithm_version = 'anthropometry_representative_v2',
           thresholds_version = 'anthropometry_repeatability_thresholds_v2',
           idempotency_key = $2, payload_hash = 'legacy-v2-fixture', finalized_at = now()
         WHERE id = $1 AND user_id = $3`,
        [sessionId, `legacy-v2-${Date.now()}`, userIdA],
      );
      await db.query("SELECT set_config('app.anthropometry_finalizing_session', $1, true)", [sessionId]);
      await db.query(
        `INSERT INTO public.anthropometric_representatives
          (session_id, user_id, site_code, representative_cm, method, reading_count,
           initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags,
           algorithm_version)
         VALUES ($1, $2, 'neck', 40.2, 'mean_of_two', 2, 0.4, 0.4,
           'within_repeatability_threshold', '[]'::jsonb, 'anthropometry_representative_v2')`,
        [sessionId, userIdA],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      await db.end();
    }

    const service = svcClient();
    const { data, error } = await service.from("anthropometric_representatives")
      .select("representative_cm, quality, algorithm_version, source_reading_ids, selected_reading_indices, eligible_for_interpretation")
      .eq("session_id", sessionId).single();
    if (error) throw error;
    expect(data).toMatchObject({
      quality: "within_repeatability_threshold",
      algorithm_version: "anthropometry_representative_v2",
      source_reading_ids: null,
      selected_reading_indices: null,
      eligible_for_interpretation: null,
    });
    expect(Number(data.representative_cm)).toBe(40.2);
    const history = await callFunction<{
      sessions: Array<{ id: string; measurement_context: Record<string, unknown> }>;
    }>("get-anthropometric-sessions", tokenA, "GET", undefined, "?site_code=neck&limit=100");
    const legacy = history.body.data!.sessions.find((row) => row.id === sessionId)!;
    expect(legacy.measurement_context).toEqual({
      version: null, local_time: null, meal_timing: "not_recorded",
      after_bathroom: null, exercise_within_previous_12_hours: null,
      measurement_assistance: "not_recorded", clothing_level: "not_recorded",
    });
  });

  it("keeps an unknown-protocol fixture visible without comparing it to protocol v1", async () => {
    const legacyId = crypto.randomUUID();
    const db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        `INSERT INTO public.anthropometric_sessions
          (id, user_id, status, measured_at, data_contract_version, protocol_version)
         VALUES ($1, $2, 'draft', '2026-04-01T06:00:00Z',
           'anthropometry_data_contract_v2', 'anthropometry_protocol_future_v2')`,
        [legacyId, userIdA],
      );
      await db.query(
        `INSERT INTO public.anthropometric_readings
          (id, session_id, user_id, site_code, reading_number, value_cm)
         VALUES (gen_random_uuid(), $1, $2, 'chest', 1, 100),
                (gen_random_uuid(), $1, $2, 'chest', 2, 100.4)`,
        [legacyId, userIdA],
      );
      await db.query(
        `UPDATE public.anthropometric_sessions SET status = 'finalized', logged_date = '2026-04-01',
           timezone = 'Africa/Johannesburg', representative_algorithm_version = 'anthropometry_representative_v2',
           thresholds_version = 'anthropometry_repeatability_thresholds_v2',
           idempotency_key = $2, payload_hash = 'unknown-protocol-fixture', finalized_at = now()
         WHERE id = $1`,
        [legacyId, `unknown-protocol-${Date.now()}`],
      );
      await db.query("SELECT set_config('app.anthropometry_finalizing_session', $1, true)", [legacyId]);
      await db.query(
        `INSERT INTO public.anthropometric_representatives
          (session_id, user_id, site_code, representative_cm, method, reading_count,
           initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags, algorithm_version)
         VALUES ($1, $2, 'chest', 100.2, 'mean_of_two', 2, 0.4, 0.4,
           'within_repeatability_threshold', '[]'::jsonb, 'anthropometry_representative_v2')`,
        [legacyId, userIdA],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      await db.end();
    }
    await save(tokenA, finalBody(`current-protocol-${Date.now()}`, "2026-08-01T06:00:00Z", [
      { site_code: "chest", readings_cm: [98, 98.4] },
    ]));
    const progress = await callFunction<{
      series: Array<{ points: unknown[]; change_summary: { baseline: unknown } | null; warning_codes: string[] }>;
    }>("get-anthropometric-progress", tokenA, "GET", undefined,
      "?site_code=chest&include_weight_comparison=false");
    expect(progress.body.data!.series[0].points).toHaveLength(2);
    expect(progress.body.data!.series[0].change_summary?.baseline).toBeNull();
    expect(progress.body.data!.series[0].warning_codes).toContain("protocol_versions_not_comparable");
  });
});

describe("cross-user isolation", () => {
  let privateSessionId = "";

  beforeAll(async () => {
    const result = await save(tokenA, finalBody(
      `private-${Date.now()}`,
      "2026-07-05T07:00:00Z",
      [{ site_code: "hips", readings_cm: [101, 101.5] }],
    ));
    privateSessionId = result.body.data!.session.id;
  });

  it("RLS hides another user's sessions, raw readings and representatives", async () => {
    const [sessions, readings, representatives] = await Promise.all([
      clientB.from("anthropometric_sessions").select("id").eq("id", privateSessionId),
      clientB.from("anthropometric_readings").select("id").eq("session_id", privateSessionId),
      clientB.from("anthropometric_representatives").select("site_code")
        .eq("session_id", privateSessionId),
    ]);
    expect(sessions.data).toHaveLength(0);
    expect(readings.data).toHaveLength(0);
    expect(representatives.data).toHaveLength(0);
  });

  it("history never returns another user's session", async () => {
    const result = await callFunction<{ sessions: Array<{ id: string }> }>(
      "get-anthropometric-sessions", tokenB, "GET",
    );
    expect(result.status).toBe(200);
    expect(result.body.data!.sessions.some((row) => row.id === privateSessionId)).toBe(false);
  });

  it("supports an exact site filter without leaking other sites", async () => {
    const result = await callFunction<{
      sessions: Array<{
        id: string;
        readings: Array<{ site_code: string }>;
        representatives: Array<{ site_code: string }>;
      }>;
    }>("get-anthropometric-sessions", tokenA, "GET", undefined, "?site_code=hips");
    expect(result.status).toBe(200);
    expect(result.body.data!.sessions.some((row) => row.id === privateSessionId)).toBe(true);
    expect(result.body.data!.sessions.flatMap((row) => row.readings)
      .every((row) => row.site_code === "hips")).toBe(true);
    expect(result.body.data!.sessions.flatMap((row) => row.representatives)
      .every((row) => row.site_code === "hips")).toBe(true);
  });

  it("cannot overwrite or delete another user's session through the API", async () => {
    const overwrite = await save(tokenB, {
      session_id: privateSessionId,
      status: "draft",
      protocol_version: "anthropometry_protocol_v1",
      sites: [],
    });
    expect(overwrite.status).toBe(404);

    const deletion = await callFunction(
      "delete-anthropometric-session", tokenB, "DELETE", { session_id: privateSessionId },
    );
    expect(deletion.status).toBe(404);
    expect(deletion.body.error?.code).toBe("SESSION_NOT_FOUND");
    const { data } = await svcClient().from("anthropometric_sessions")
      .select("id").eq("id", privateSessionId).single();
    expect(data?.id).toBe(privateSessionId);
  });
});

describe("history pagination and explicit deletion", () => {
  const createdIds: string[] = [];

  beforeAll(async () => {
    for (const [index, measuredAt] of [
      "2026-07-10T07:00:00Z",
      "2026-07-20T07:00:00Z",
      "2026-07-30T07:00:00Z",
    ].entries()) {
      const result = await save(
        tokenA,
        finalBody(`page-${Date.now()}-${index}`, measuredAt),
      );
      createdIds.push(result.body.data!.session.id);
    }
  });

  it("uses a stable cursor with no duplicate or skipped sessions", async () => {
    type HistoryPage = {
      sessions: Array<{ id: string; measured_at: string }>;
      next_cursor: string | null;
    };
    const paged: HistoryPage["sessions"] = [];
    let cursor: string | null = null;
    do {
      const query = `?limit=2${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`;
      const page = await callFunction<HistoryPage>(
        "get-anthropometric-sessions", tokenA, "GET", undefined, query,
      );
      expect(page.status).toBe(200);
      expect(page.body.data!.sessions.length).toBeLessThanOrEqual(2);
      paged.push(...page.body.data!.sessions);
      cursor = page.body.data!.next_cursor;
    } while (cursor);

    const { data: expectedRows, error } = await svcClient()
      .from("anthropometric_sessions").select("id, measured_at")
      .eq("user_id", userIdA).eq("status", "finalized")
      .order("measured_at", { ascending: false }).order("id", { ascending: false });
    expect(error).toBeNull();
    expect(paged.map((row) => row.id)).toEqual(expectedRows!.map((row) => row.id));
    expect(new Set(paged.map((row) => row.id)).size).toBe(paged.length);
  });

  it("deletes a whole finalized session and its children", async () => {
    const target = createdIds[0];
    const result = await callFunction<{ deleted_session_id: string }>(
      "delete-anthropometric-session", tokenA, "DELETE", { session_id: target },
    );
    expect(result.status).toBe(200);
    expect(result.body.data?.deleted_session_id).toBe(target);
    const service = svcClient();
    const [sessions, readings, representatives] = await Promise.all([
      service.from("anthropometric_sessions").select("id").eq("id", target),
      service.from("anthropometric_readings").select("id").eq("session_id", target),
      service.from("anthropometric_representatives").select("site_code").eq("session_id", target),
    ]);
    expect(sessions.data).toHaveLength(0);
    expect(readings.data).toHaveLength(0);
    expect(representatives.data).toHaveLength(0);
  });

  it("includes context and provenance in the complete anthropometry graph export v3", async () => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/export-my-data`, {
      headers: { Authorization: `Bearer ${tokenA}`, apikey: ANON_KEY },
    });
    expect(response.status).toBe(200);
    const exported = await response.json() as {
      export_version: string;
      data: Record<string, Array<Record<string, unknown>>>;
    };
    expect(exported.export_version).toBe("nutri_data_export_v3");
    expect(exported.data.anthropometric_sessions.length).toBeGreaterThan(0);
    expect(exported.data.anthropometric_readings.length).toBeGreaterThan(0);
    expect(exported.data.anthropometric_representatives.length).toBeGreaterThan(0);
    expect(exported.data.anthropometric_representatives.some((row) =>
      row.algorithm_version === "anthropometry_representative_v3" &&
      Array.isArray(row.source_reading_ids) &&
      Array.isArray(row.selected_reading_indices) &&
      Object.prototype.hasOwnProperty.call(row, "eligible_for_interpretation")
    )).toBe(true);
    expect(exported.data.anthropometric_sessions.every((row) => row.user_id === userIdA)).toBe(true);
    expect(exported.data.anthropometric_sessions.every((row) =>
      typeof row.measurement_context === "object"
    )).toBe(true);
  });
});

describe("history pagination above one thousand finalized sessions", () => {
  const fixtureCount = 1005;

  beforeAll(async () => {
    const db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      await db.query(`CREATE TEMP TABLE paging_sessions(id UUID PRIMARY KEY, sequence_number INTEGER NOT NULL) ON COMMIT DROP`);
      await db.query(`INSERT INTO paging_sessions
        SELECT gen_random_uuid(), value FROM generate_series(1, $1::integer) AS value`, [fixtureCount]);
      await db.query(
        `INSERT INTO public.anthropometric_sessions
          (id, user_id, status, measured_at, data_contract_version, protocol_version)
         SELECT id, $1, 'draft', '2020-01-01T06:00:00Z'::timestamptz + sequence_number * interval '1 day',
           'anthropometry_data_contract_v2', 'anthropometry_protocol_v1'
           FROM paging_sessions`,
        [userIdPaging],
      );
      await db.query(
        `INSERT INTO public.anthropometric_readings
          (id, session_id, user_id, site_code, reading_number, value_cm)
         SELECT gen_random_uuid(), id, $1, 'waist', reading_number,
           CASE reading_number WHEN 1 THEN 70.0 ELSE 70.4 END
         FROM paging_sessions CROSS JOIN generate_series(1, 2) AS reading_number`,
        [userIdPaging],
      );
      await db.query(
        `UPDATE public.anthropometric_sessions session SET status = 'finalized',
           logged_date = (session.measured_at AT TIME ZONE 'Africa/Johannesburg')::date,
           timezone = 'Africa/Johannesburg', representative_algorithm_version = 'anthropometry_representative_v1',
           thresholds_version = 'anthropometry_repeatability_thresholds_v1',
           idempotency_key = 'paging-' || fixture.sequence_number,
           payload_hash = 'paging-hash-' || fixture.sequence_number, finalized_at = now()
         FROM paging_sessions fixture WHERE session.id = fixture.id`,
      );
      await db.query("SELECT set_config('app.paging_user_id', $1, true)", [userIdPaging]);
      await db.query(
        `DO $block$ DECLARE fixture RECORD; BEGIN
           FOR fixture IN SELECT * FROM paging_sessions LOOP
             PERFORM set_config('app.anthropometry_finalizing_session', fixture.id::text, true);
             INSERT INTO public.anthropometric_representatives
               (session_id, user_id, site_code, representative_cm, method, reading_count,
                initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags, algorithm_version)
             VALUES (fixture.id, current_setting('app.paging_user_id')::uuid, 'waist', 70.2, 'mean_of_two', 2, 0.4, 0.4,
               'within_repeatability_threshold', '[]'::jsonb, 'anthropometry_representative_v1');
           END LOOP;
         END $block$`,
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      await db.end();
    }
  }, 60_000);

  it("returns every session once, in stable order, with bounded pages and correct children", async () => {
    type Page = {
      sessions: Array<{
        id: string;
        measured_at: string;
        readings: Array<{ session_id: string }>;
        representatives: Array<{ session_id: string }>;
      }>;
      next_cursor: string | null;
    };
    const sessions: Page["sessions"] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    do {
      const page = await callFunction<Page>(
        "get-anthropometric-sessions", tokenPaging, "GET", undefined,
        `?limit=100${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(page.status).toBe(200);
      expect(page.body.data!.sessions.length).toBeLessThanOrEqual(100);
      expect(page.body.data!.sessions.every((session) =>
        session.readings.length === 2 && session.readings.every((reading) => reading.session_id === session.id) &&
        session.representatives.length === 1 && session.representatives[0].session_id === session.id
      )).toBe(true);
      sessions.push(...page.body.data!.sessions);
      cursor = page.body.data!.next_cursor;
      pageCount += 1;
      expect(pageCount).toBeLessThanOrEqual(11);
    } while (cursor);
    expect(sessions).toHaveLength(fixtureCount);
    expect(new Set(sessions.map((session) => session.id)).size).toBe(fixtureCount);
    expect(sessions.map((session) => session.measured_at)).toEqual(
      [...sessions].map((session) => session.measured_at).sort().reverse(),
    );
    expect(pageCount).toBe(11);
  }, 60_000);
});
