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

const DB_URL = process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const EMAIL = testEmail("anthropometry-concurrency");
const { Client } = pg;

type Envelope<T> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
};

let userId = "";
let token = "";

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  const { client } = await signInAs(EMAIL);
  const { data } = await client.auth.getSession();
  token = data.session!.access_token;
});

afterAll(async () => {
  await deleteTestUser(userId);
});

async function edge<T>(name: string, body: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Envelope<T> };
}

async function waitForDatabaseLock(monitor: pg.Client, applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await monitor.query(
      `SELECT wait_event_type
         FROM pg_stat_activity
        WHERE application_name = $1 AND state = 'active'`,
      [applicationName],
    );
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Connection ${applicationName} never reached the database lock barrier`);
}

async function createDraft(db: pg.Client): Promise<{
  sessionId: string;
  firstId: string;
  secondId: string;
}> {
  const sessionId = crypto.randomUUID();
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.anthropometric_sessions
      (id, user_id, status, measured_at, data_contract_version, protocol_version)
     VALUES ($1, $2, 'draft', '2026-08-01T06:00:00Z',
       'anthropometry_data_contract_v3', 'anthropometry_protocol_v1')`,
    [sessionId, userId],
  );
  await db.query(
    `INSERT INTO public.anthropometric_readings
      (id, session_id, user_id, site_code, reading_number, value_cm)
     VALUES ($1, $3, $4, 'waist', 1, 80.0),
            ($2, $3, $4, 'waist', 2, 80.4)`,
    [firstId, secondId, sessionId, userId],
  );
  return { sessionId, firstId, secondId };
}

async function beginFinalisation(
  finaliser: pg.Client,
  fixture: { sessionId: string; firstId: string; secondId: string },
): Promise<void> {
  await finaliser.query("BEGIN");
  await finaliser.query(
    `SELECT id FROM public.anthropometric_sessions
      WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [fixture.sessionId, userId],
  );
  await finaliser.query(
    "SELECT set_config('app.anthropometry_finalizing_session', $1, true)",
    [fixture.sessionId],
  );
  await finaliser.query(
    `UPDATE public.anthropometric_sessions SET status = 'finalized',
       logged_date = '2026-08-01', timezone = 'Africa/Johannesburg',
       representative_algorithm_version = 'anthropometry_representative_v3',
       thresholds_version = 'anthropometry_repeatability_thresholds_v2',
       idempotency_key = $2, payload_hash = $3, finalized_at = now()
     WHERE id = $1 AND user_id = $4`,
    [fixture.sessionId, `race-${fixture.sessionId}`, `hash-${fixture.sessionId}`, userId],
  );
  await finaliser.query(
    `INSERT INTO public.anthropometric_representatives
      (session_id, user_id, site_code, representative_cm, method, reading_count,
       initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags,
       algorithm_version, source_reading_ids, selected_reading_indices,
       selected_pair_spread_cm, pairwise_differences, warning_codes,
       eligible_for_interpretation)
     VALUES ($1, $2, 'waist', 80.2, 'mean_of_two', 2, 0.4, 0.4,
       'pair_agree', '[]'::jsonb, 'anthropometry_representative_v3',
       ARRAY[$3, $4]::uuid[], ARRAY[1, 2]::smallint[], 0.4,
       '{"d12":0.4,"d13":null,"d23":null}'::jsonb, '[]'::jsonb, true)`,
    [fixture.sessionId, userId, fixture.firstId, fixture.secondId],
  );
}

async function runChildRace(
  label: string,
  mutationSql: string,
  mutationParams: (fixture: { sessionId: string; firstId: string; secondId: string }) => unknown[],
): Promise<void> {
  const setup = new Client({ connectionString: DB_URL });
  const finaliser = new Client({ connectionString: DB_URL, application_name: `${label}_finaliser` });
  const mutatorName = `${label}_mutator`;
  const mutator = new Client({ connectionString: DB_URL, application_name: mutatorName });
  await Promise.all([setup.connect(), finaliser.connect(), mutator.connect()]);
  let fixture: Awaited<ReturnType<typeof createDraft>> | null = null;
  try {
    fixture = await createDraft(setup);
    await beginFinalisation(finaliser, fixture);

    const mutation = mutator.query(mutationSql, mutationParams(fixture))
      .then(() => ({ completed: true, error: null }))
      .catch((error: { code?: string; message?: string }) => ({ completed: false, error }));
    await waitForDatabaseLock(setup, mutatorName);

    const stillDraftToOthers = await setup.query(
      "SELECT status FROM public.anthropometric_sessions WHERE id = $1",
      [fixture.sessionId],
    );
    expect(stillDraftToOthers.rows[0].status).toBe("draft");

    await finaliser.query("COMMIT");
    const outcome = await mutation;
    expect(outcome.completed).toBe(false);
    expect(outcome.error?.code).toBe("55000");
    expect(outcome.error?.message).toContain("ANTHROPOMETRIC_SESSION_IMMUTABLE");

    const integrity = await setup.query(
      `SELECT s.status,
              count(DISTINCT r.id)::int AS reading_count,
              count(DISTINCT p.site_code)::int AS representative_count,
              min(p.representative_cm)::numeric AS representative_cm
         FROM public.anthropometric_sessions s
         LEFT JOIN public.anthropometric_readings r
           ON r.session_id = s.id AND r.user_id = s.user_id
         LEFT JOIN public.anthropometric_representatives p
           ON p.session_id = s.id AND p.user_id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2
        GROUP BY s.status`,
      [fixture.sessionId, userId],
    );
    expect(integrity.rows[0]).toMatchObject({
      status: "finalized",
      reading_count: 2,
      representative_count: 1,
    });
    expect(Number(integrity.rows[0].representative_cm)).toBe(80.2);
  } finally {
    try { await finaliser.query("ROLLBACK"); } catch { /* already committed */ }
    if (fixture) {
      await setup.query(
        "DELETE FROM public.anthropometric_sessions WHERE id = $1 AND user_id = $2",
        [fixture.sessionId, userId],
      );
    }
    await Promise.all([setup.end(), finaliser.end(), mutator.end()]);
  }
}

describe("parent-lock finalisation barrier", () => {
  it("blocks a reading insert, then rejects it after finalisation commits", async () => {
    await runChildRace(
      "gate2_insert",
      `INSERT INTO public.anthropometric_readings
        (session_id, user_id, site_code, reading_number, value_cm)
       VALUES ($1, $2, 'waist', 3, 80.5)`,
      (fixture) => [fixture.sessionId, userId],
    );
  });

  it("blocks a reading update, then rejects it after finalisation commits", async () => {
    await runChildRace(
      "gate2_update",
      "UPDATE public.anthropometric_readings SET value_cm = 81.0 WHERE id = $1 AND user_id = $2",
      (fixture) => [fixture.firstId, userId],
    );
  });

  it("blocks a reading deletion, then rejects it after finalisation commits", async () => {
    await runChildRace(
      "gate2_delete",
      "DELETE FROM public.anthropometric_readings WHERE id = $1 AND user_id = $2",
      (fixture) => [fixture.firstId, userId],
    );
  });
});

describe("concurrent finalisation idempotency", () => {
  const measuredAt = "2026-08-01T07:00:00.000Z";
  const sites = [{ site_code: "waist", readings_cm: [80, 80.4] }];

  it("returns one authoritative result and one replay for the same key", async () => {
    const request = {
      measured_at: measuredAt,
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: `same-key-${Date.now()}`,
      sites,
    };
    const [left, right] = await Promise.all([
      edge<{ session: { id: string }; replayed: boolean }>("finalize-anthropometric-session", request),
      edge<{ session: { id: string }; replayed: boolean }>("finalize-anthropometric-session", request),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(left.body.data!.session.id).toBe(right.body.data!.session.id);
    expect([left.body.data!.replayed, right.body.data!.replayed].sort()).toEqual([false, true]);
  });

  it("allows one of two different finalisations and rejects the other as immutable", async () => {
    const draft = await edge<{ session: { id: string } }>("save-anthropometric-session", {
      status: "draft",
      measured_at: measuredAt,
      protocol_version: "anthropometry_protocol_v1",
      sites,
    });
    expect(draft.status).toBe(200);
    const base = {
      session_id: draft.body.data!.session.id,
      measured_at: measuredAt,
      protocol_version: "anthropometry_protocol_v1",
      sites,
    };
    const [left, right] = await Promise.all([
      edge("finalize-anthropometric-session", { ...base, idempotency_key: `different-a-${Date.now()}` }),
      edge("finalize-anthropometric-session", { ...base, idempotency_key: `different-b-${Date.now()}` }),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    const rejected = left.status === 409 ? left : right;
    expect(rejected.body.error?.code).toBe("SESSION_IMMUTABLE");
  });

  it("replays safely when the first successful response is lost to a client timeout", async () => {
    const key = `timeout-retry-${Date.now()}`;
    const request = {
      measured_at: measuredAt,
      protocol_version: "anthropometry_protocol_v1",
      idempotency_key: key,
      sites,
    };
    const firstResponse = edge<{ session: { id: string }; replayed: boolean }>(
      "finalize-anthropometric-session",
      request,
    );

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const { count } = await svcClient().from("anthropometric_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("idempotency_key", key).eq("status", "finalized");
      if (count === 1) break;
      if (attempt === 199) throw new Error("First finalisation never reached the commit barrier");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const retry = await edge<{ session: { id: string }; replayed: boolean }>(
      "finalize-anthropometric-session",
      request,
    );
    const first = await firstResponse;
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.data?.replayed).toBe(true);
    expect(retry.body.data?.session.id).toBe(first.body.data?.session.id);

    const service = svcClient();
    const { data: sessions } = await service.from("anthropometric_sessions")
      .select("id").eq("user_id", userId).eq("idempotency_key", key);
    const { data: representatives } = await service.from("anthropometric_representatives")
      .select("site_code").eq("user_id", userId).eq("session_id", first.body.data!.session.id);
    expect(sessions).toHaveLength(1);
    expect(representatives).toHaveLength(1);
  });
});
