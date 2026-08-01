// get-weight-trend
// Returns the full v3 weight-trend calculation for the authenticated user.
//
// GET /functions/v1/get-weight-trend
//
// Optional query parameters:
//   display_window_days  — days of EWMA points to return (allowed: 7,14,28,56,84; default 28)
//
// Authentication:
//   Authorization: Bearer <jwt>  — required.
//   User ID is derived from the verified JWT; never accepted from query params or body.
//
// This endpoint is read-only. No rows are mutated.

import { ok, fail, preflight }           from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { calculate, type RawEntry, type TrendOutput } from "../_shared/weightTrend.ts";
import type { SupabaseClient }             from "npm:@supabase/supabase-js@2";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fall-back when profiles.timezone is absent or null. */
const DEFAULT_TIMEZONE = "Africa/Johannesburg";

/** Rows fetched per PostgREST page (must stay ≤ [api].max_rows in config.toml). */
const PAGE_SIZE = 500;

/** Allowlist for the display_window_days presentation parameter. */
const DISPLAY_WINDOW_DAYS_ALLOWED = new Set([7, 14, 28, 56, 84]);

// ── Dependency types ──────────────────────────────────────────────────────────

export interface ProfileRow {
  timezone: string | null;
}

export interface LoadWeightLogsResult {
  rows:      RawEntry[];
  pageCount: number;
}

/** Injected dependencies — real impls at runtime, fakes in tests. */
export interface WeightTrendDeps {
  /** Server-side clock. Tests inject a fixed date. */
  now:            () => Date;
  /** Fetch profile.timezone for userId; returns null when no profile row exists. */
  loadProfile:    (userId: string) => Promise<ProfileRow | null>;
  /** Fetch ALL weight logs for userId (handles pagination internally). */
  loadWeightLogs: (userId: string) => Promise<LoadWeightLogsResult>;
}

// ── Database helpers ──────────────────────────────────────────────────────────

async function dbLoadProfile(
  userId: string,
  svc: SupabaseClient,
): Promise<ProfileRow | null> {
  const { data, error } = await svc
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(`profiles query failed: ${error.message}`);
  return data as ProfileRow | null;
}

/**
 * Retrieve ALL weight_logs rows for a user via deterministic offset pagination.
 *
 * Correctness proof: the query uses a fixed ORDER BY (measured_at ASC, id ASC)
 * and the caller never writes during the read, so each offset returns a
 * stable slice of the full result set.
 */
async function dbLoadWeightLogs(
  userId: string,
  svc: SupabaseClient,
): Promise<LoadWeightLogsResult> {
  const rows: RawEntry[] = [];
  let pageCount = 0;
  let offset    = 0;

  while (true) {
    const { data, error } = await svc
      .from("weight_logs")
      .select("id, weight_kg, measured_at, is_official")
      .eq("user_id", userId)
      .order("measured_at", { ascending: true })
      .order("id",          { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`weight_logs query failed: ${error.message}`);

    pageCount++;
    if (!data || data.length === 0) break;

    for (const r of data) {
      rows.push({
        id:          r.id          as string,
        measured_at: r.measured_at as string,
        weight_kg:   Number(r.weight_kg),
        is_official: r.is_official as boolean,
      });
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { rows, pageCount };
}

// ── Timezone validation ───────────────────────────────────────────────────────

function isValidIANATimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ── Core handler (injected deps → fully testable) ─────────────────────────────

/**
 * Handle a GET /get-weight-trend request.
 *
 * Calling sequence:
 *   authenticate → load profile timezone → load all weight logs →
 *   call canonical calculate() → return envelope
 */
export async function handleGetWeightTrend(
  req:  Request,
  deps: WeightTrendDeps,
): Promise<Response> {

  // ── 1. Authenticate ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return fail("UNAUTHENTICATED", "Missing Authorization header", 401);
  }

  const userClient = getUserClient(authHeader);
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return fail("UNAUTHENTICATED", "Invalid or expired session", 401);
  }

  const userId    = userData.user.id;
  const requestId = crypto.randomUUID();

  // ── 2. Parse presentation-only parameters ────────────────────────────────────
  const url       = new URL(req.url);
  const dwParam   = url.searchParams.get("display_window_days");
  let displayWindowDays = 28;

  if (dwParam !== null) {
    const parsed = parseInt(dwParam, 10);
    if (!DISPLAY_WINDOW_DAYS_ALLOWED.has(parsed)) {
      const allowed = [...DISPLAY_WINDOW_DAYS_ALLOWED].sort((a, b) => a - b).join(", ");
      return fail("INVALID_PARAM", `display_window_days must be one of: ${allowed}`, 400);
    }
    displayWindowDays = parsed;
  }

  const t0 = Date.now();

  // ── 3. Load profile timezone ─────────────────────────────────────────────────
  let profile: ProfileRow | null;
  try {
    profile = await deps.loadProfile(userId);
  } catch (err) {
    console.error(JSON.stringify({
      request_id: requestId,
      event:      "profile_load_failed",
      error:      String(err),
    }));
    return fail("DB_ERROR", "Failed to load user profile", 500);
  }

  const storedTimezone = profile?.timezone ?? null;
  const effectiveTimezone =
    storedTimezone === null || storedTimezone === undefined || storedTimezone === ""
      ? DEFAULT_TIMEZONE
      : storedTimezone;

  if (!isValidIANATimezone(effectiveTimezone)) {
    return fail(
      "INVALID_PROFILE_TIMEZONE",
      `Profile timezone '${effectiveTimezone}' is not a recognised IANA timezone`,
      422,
    );
  }

  // ── 4. Load all weight logs (paginated) ──────────────────────────────────────
  let rows:      RawEntry[];
  let pageCount: number;
  try {
    ({ rows, pageCount } = await deps.loadWeightLogs(userId));
  } catch (err) {
    console.error(JSON.stringify({
      request_id: requestId,
      event:      "weight_logs_load_failed",
      error:      String(err),
    }));
    return fail("DB_ERROR", "Failed to load weight logs", 500);
  }

  const t1 = Date.now();

  // ── 5. Canonical calculation (server-side clock only) ────────────────────────
  const nowIso          = deps.now().toISOString();
  const result: TrendOutput = calculate(rows, nowIso, effectiveTimezone, displayWindowDays);

  const t2 = Date.now();

  // ── 6. Structured log (no JWTs, no emails, no row content) ──────────────────
  console.log(JSON.stringify({
    request_id:                requestId,
    user_id_prefix:            userId.slice(0, 8),
    raw_row_count:             rows.length,
    page_count:                pageCount,
    effective_timezone:        effectiveTimezone,
    selected_rate_window_days: result.measurements.selected_rate_window_days,
    status:                    result.status,
    db_ms:                     t1 - t0,
    calc_ms:                   t2 - t1,
    total_ms:                  t2 - t0,
  }));

  return ok(result);
}

// ── Deno entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const svc  = getServiceClient();
    const deps: WeightTrendDeps = {
      now:            () => new Date(),
      loadProfile:    (uid) => dbLoadProfile(uid, svc),
      loadWeightLogs: (uid) => dbLoadWeightLogs(uid, svc),
    };
    return handleGetWeightTrend(req, deps);
  } catch (err) {
    console.error(JSON.stringify({ event: "top_level_error", error: String(err) }));
    return fail("INTERNAL_ERROR", "Unexpected error", 500);
  }
});
