/** Returns chronological anthropometry series and an optional Phase 6 comparison. */
import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getServiceClient, getUserClient } from "../_shared/supabaseClient.ts";
import {
  ANTHROPOMETRY_SITE_CODES,
  type AnthropometryQuality,
  type AnthropometrySiteCode,
} from "../_shared/anthropometry.ts";
import {
  buildAnthropometryProgress,
  type AnthropometryProgressInputPoint,
} from "../_shared/anthropometryProgress.ts";
import { contextFromRow } from "../_shared/anthropometryContext.ts";
import { calculate, type RawEntry, type TrendOutput } from "../_shared/weightTrend.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const PAGE_SIZE = 500;
const DAY_MS = 86_400_000;

interface SessionRow {
  id: string;
  measured_at: string;
  logged_date: string;
  protocol_version: string;
  local_time: string | null;
  measurement_context_version: string | null;
  meal_timing: string | null;
  after_bathroom: boolean | null;
  exercise_within_previous_12_hours: boolean | null;
  measurement_assistance: string | null;
  clothing_level: string | null;
  anthropometric_representatives: Array<{
    site_code: AnthropometrySiteCode;
    representative_cm: number | string;
    quality: AnthropometryQuality;
    selected_reading_indices: number[] | null;
    selected_pair_spread_cm: number | string | null;
    warning_codes: string[] | null;
    eligible_for_interpretation: boolean | null;
    algorithm_version: string;
  }>;
  anthropometric_readings: Array<{
    id: string;
    site_code: AnthropometrySiteCode;
    reading_number: number;
    value_cm: number | string;
  }>;
}

function parseTimestamp(value: string | null, field: string): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  return parsed;
}

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

async function loadAnthropometryPoints(
  service: SupabaseClient,
  userId: string,
  fromIso: string | null,
  toIso: string,
  siteCode: AnthropometrySiteCode | null,
): Promise<AnthropometryProgressInputPoint[]> {
  const sessions: SessionRow[] = [];
  let offset = 0;
  while (true) {
    let query = service.from("anthropometric_sessions").select(
      "id, measured_at, logged_date, protocol_version, local_time, measurement_context_version, meal_timing, after_bathroom, exercise_within_previous_12_hours, measurement_assistance, clothing_level, anthropometric_representatives(site_code, representative_cm, quality, selected_reading_indices, selected_pair_spread_cm, warning_codes, eligible_for_interpretation, algorithm_version), anthropometric_readings(id, site_code, reading_number, value_cm)",
    )
      .eq("user_id", userId)
      .eq("anthropometric_representatives.user_id", userId)
      .eq("anthropometric_readings.user_id", userId)
      .eq("status", "finalized")
      .lte("measured_at", toIso)
      .order("measured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (fromIso) query = query.gte("measured_at", fromIso);
    const { data, error } = await query;
    if (error) throw error;
    const page = (data ?? []) as unknown as SessionRow[];
    sessions.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return sessions.flatMap((session) =>
    (session.anthropometric_representatives ?? [])
      .filter((representative) => !siteCode || representative.site_code === siteCode)
      .map((representative) => ({
        session_id: session.id,
        site_code: representative.site_code,
        measured_at: session.measured_at,
        logged_date: session.logged_date,
        protocol_version: session.protocol_version,
        measurement_context: contextFromRow(session as unknown as Record<string, unknown>),
        representative_cm: Number(representative.representative_cm),
        quality: representative.quality,
        selected_reading_indices: representative.selected_reading_indices,
        selected_pair_spread_cm: representative.selected_pair_spread_cm === null
          ? null
          : Number(representative.selected_pair_spread_cm),
        warning_codes: representative.warning_codes,
        eligible_for_interpretation: representative.eligible_for_interpretation,
        algorithm_version: representative.algorithm_version,
        raw_readings: (session.anthropometric_readings ?? [])
          .filter((reading) => reading.site_code === representative.site_code)
          .sort((left, right) => left.reading_number - right.reading_number)
          .map((reading) => ({
            id: reading.id,
            reading_index: reading.reading_number,
            value_cm: Number(reading.value_cm),
          })),
      }))
  );
}

async function loadWeightLogs(
  service: SupabaseClient,
  userId: string,
  asOf: string,
): Promise<RawEntry[]> {
  const rows: RawEntry[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await service.from("weight_logs")
      .select("id, measured_at, weight_kg, is_official")
      .eq("user_id", userId)
      .lte("measured_at", asOf)
      .order("measured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      rows.push({
        id: row.id as string,
        measured_at: row.measured_at as string,
        weight_kg: Number(row.weight_kg),
        is_official: row.is_official as boolean,
      });
    }
    if ((data?.length ?? 0) < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "Use GET", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);
    const userClient = getUserClient(authHeader);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return fail("UNAUTHENTICATED", "Invalid session", 401);
    }

    const url = new URL(req.url);
    let from: Date | null;
    let to: Date | null;
    try {
      from = parseTimestamp(url.searchParams.get("from"), "from");
      to = parseTimestamp(url.searchParams.get("to"), "to");
    } catch (error) {
      return fail("VALIDATION_ERROR", (error as Error).message, 422);
    }
    const now = new Date();
    const toDate = to ?? now;
    if (from && from.getTime() > toDate.getTime()) {
      return fail("VALIDATION_ERROR", "from must not be after to", 422);
    }

    const rawSiteCode = url.searchParams.get("site_code");
    if (rawSiteCode && !ANTHROPOMETRY_SITE_CODES.includes(
      rawSiteCode as AnthropometrySiteCode,
    )) {
      return fail("UNKNOWN_SITE", `Unknown anthropometric site: ${rawSiteCode}`, 422);
    }
    const siteCode = rawSiteCode as AnthropometrySiteCode | null;

    const rawIncludeWeight = url.searchParams.get("include_weight_comparison") ?? "true";
    if (rawIncludeWeight !== "true" && rawIncludeWeight !== "false") {
      return fail(
        "VALIDATION_ERROR",
        "include_weight_comparison must be true or false",
        422,
      );
    }
    const includeWeight = rawIncludeWeight === "true";
    const service = getServiceClient();
    const points = await loadAnthropometryPoints(
      service,
      userData.user.id,
      from?.toISOString() ?? null,
      toDate.toISOString(),
      siteCode,
    );

    let weightTrend: TrendOutput | null = null;
    const eligiblePoints = points.filter((point) =>
      point.protocol_version === "anthropometry_protocol_v1" &&
      point.eligible_for_interpretation !== false &&
      point.quality !== "high_variability" && point.quality !== "repeatability_warning"
    );
    const weightAsOf = eligiblePoints.reduce<string | null>((latest, point) =>
      !latest || Date.parse(point.measured_at) > Date.parse(latest) ? point.measured_at : latest
    , null);
    if (includeWeight && weightAsOf) {
      const [{ data: profile, error: profileError }, weightLogs] = await Promise.all([
        service.from("profiles").select("timezone").eq("id", userData.user.id).maybeSingle(),
        loadWeightLogs(service, userData.user.id, weightAsOf),
      ]);
      if (profileError) throw profileError;
      const timezone = (profile?.timezone as string | null) || DEFAULT_TIMEZONE;
      if (!isValidTimezone(timezone)) {
        return fail(
          "INVALID_PROFILE_TIMEZONE",
          "Profile timezone is not a recognised IANA timezone",
          422,
        );
      }
      const earliestMs = Math.min(...points.map((point) => Date.parse(point.measured_at)));
      const displayDays = Math.max(
        84,
        Math.ceil((Date.parse(weightAsOf) - earliestMs) / DAY_MS) + 7,
      );
      weightTrend = calculate(weightLogs, weightAsOf, timezone, displayDays);
    }

    const result = buildAnthropometryProgress(points, weightTrend, includeWeight, weightAsOf);
    console.log(JSON.stringify({
      event: "anthropometric_progress_read",
      user_id_prefix: userData.user.id.slice(0, 8),
      series_count: result.series.length,
      point_count: result.series.reduce((count, series) => count + series.points.length, 0),
      weight_comparison_eligible: result.weight_comparison?.eligible ?? false,
    }));
    return ok(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: "anthropometric_progress_failed",
      error_code: "UNEXPECTED_ERROR",
    }));
    return fail("INTERNAL_ERROR", "Unexpected error fetching anthropometric progress", 500);
  }
});
