// Phase 10, Gate 3 — real Supabase integration tests.
// Requires: supabase start + supabase functions serve
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  protocol_version: "anthropometry_protocol_v1";
  idempotency_key?: string;
  sites: Array<{ site_code: string; readings_cm: number[] }>;
  representatives?: unknown;
};

const EMAIL_A = testEmail("anthropometry-api-a");
const EMAIL_B = testEmail("anthropometry-api-b");
let userIdA = "";
let userIdB = "";
let tokenA = "";
let tokenB = "";
let clientA: Awaited<ReturnType<typeof signInAs>>["client"];
let clientB: Awaited<ReturnType<typeof signInAs>>["client"];

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
  ({ client: clientA } = await signInAs(EMAIL_A));
  ({ client: clientB } = await signInAs(EMAIL_B));
  tokenA = await tokenFor(clientA);
  tokenB = await tokenFor(clientB);
});

afterAll(async () => {
  const service = svcClient();
  await service.from("anthropometric_sessions").delete().in("user_id", [userIdA, userIdB]);
  await deleteTestUser(userIdA);
  await deleteTestUser(userIdB);
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
        previous_change: { change_cm: number; elapsed_days: number } | null;
        since_first_change: { change_cm: number; elapsed_days: number } | null;
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
    expect(waist.since_first_change).toMatchObject({ change_cm: -3.4, elapsed_days: 61 });
    expect(result.body.data!.algorithm_versions).toMatchObject({
      change: "anthropometry_change_v1",
      weight_comparison: "anthropometry_weight_comparison_v1",
    });
  });

  it("generates only the versioned descriptive weight comparison", async () => {
    const result = await callFunction<{
      weight_comparison: { eligible: boolean; site_code: string; description: string | null };
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
      description: "Weight trend was broadly stable while waist circumference decreased.",
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
      protocol_version: "anthropometry_protocol_v1",
      sites: [{ site_code: "waist", readings_cm: [90.1] }],
    });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    sessionId = result.body.data!.session.id;
    expect(result.body.data!.session.status).toBe("draft");
    expect(result.body.data!.session.notes).toBe("morning draft");
    expect(result.body.data!.sites).toEqual([{ site_code: "waist", readings_cm: [90.1] }]);
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
      quality: "within_repeatability_threshold",
    });
    expect(sites.find((row) => row.site_code === "abdomen_navel")).toMatchObject({
      representative_cm: 96,
      method: "median_of_three",
      quality: "repeatability_warning",
      quality_flags: ["initial_pair_exceeds_repeatability_threshold"],
    });
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

  it("blocks finalization and preserves the draft when no pair of three readings agrees", async () => {
    const draft = await save(tokenA, {
      status: "draft",
      protocol_version: "anthropometry_protocol_v1",
      sites: [{ site_code: "waist", readings_cm: [80, 81.2, 50] }],
    });
    const draftId = draft.body.data!.session.id;

    const failed = await finalize(tokenA, {
      session_id: draftId,
      measured_at: "2026-07-03T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `low-confidence-${Date.now()}`,
      sites: [{ site_code: "waist", readings_cm: [80, 81.2, 50] }],
    });

    expect(failed.status).toBe(422);
    expect(failed.body.error?.code).toBe("RETAKE_SITE_REQUIRED");
    const { data: session } = await svcClient().from("anthropometric_sessions")
      .select("status").eq("id", draftId).single();
    const { data: readings } = await svcClient().from("anthropometric_readings")
      .select("value_cm").eq("session_id", draftId).order("reading_number");
    const { count: representativeCount } = await svcClient()
      .from("anthropometric_representatives")
      .select("site_code", { count: "exact", head: true })
      .eq("session_id", draftId);
    expect(session?.status).toBe("draft");
    expect(readings?.map((row) => Number(row.value_cm))).toEqual([80, 81.2, 50]);
    expect(representativeCount).toBe(0);
  });

  it("replays the same idempotent finalization without another row", async () => {
    const result = await finalize(tokenA, {
      session_id: sessionId,
      measured_at: "2026-07-01T07:00:00Z",
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: idempotencyKey,
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
    expect(rlsUpdateError).toBeNull();
    expect(rlsUpdateRows).toHaveLength(0);
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
      p_data_contract_version: "anthropometry_data_contract_v2",
      p_protocol_version: "anthropometry_protocol_v1",
      p_representative_algorithm_version: null,
      p_thresholds_version: null,
    });
    expect(error).toBeTruthy();
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

  it("includes the complete anthropometry graph in data export v2", async () => {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/export-my-data`, {
      headers: { Authorization: `Bearer ${tokenA}`, apikey: ANON_KEY },
    });
    expect(response.status).toBe(200);
    const exported = await response.json() as {
      export_version: string;
      data: Record<string, Array<Record<string, unknown>>>;
    };
    expect(exported.export_version).toBe("nutri_data_export_v2");
    expect(exported.data.anthropometric_sessions.length).toBeGreaterThan(0);
    expect(exported.data.anthropometric_readings.length).toBeGreaterThan(0);
    expect(exported.data.anthropometric_representatives.length).toBeGreaterThan(0);
    expect(exported.data.anthropometric_sessions.every((row) => row.user_id === userIdA)).toBe(true);
  });
});
