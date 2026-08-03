/** Returns finalized anthropometric sessions newest-first with cursor pagination. */
import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getServiceClient, getUserClient } from "../_shared/supabaseClient.ts";
import {
  ANTHROPOMETRY_DATA_CONTRACT_VERSION,
  ANTHROPOMETRY_PROTOCOL_VERSION,
  ANTHROPOMETRY_REPRESENTATIVE_VERSION,
  ANTHROPOMETRY_SITE_CODES,
  ANTHROPOMETRY_THRESHOLDS_VERSION,
} from "../_shared/anthropometry.ts";

type Cursor = { measured_at: string; id: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_ORDER = new Map<string, number>(
  ANTHROPOMETRY_SITE_CODES.map((siteCode, index) => [siteCode, index]),
);

function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const padded = raw.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((raw.length + 3) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Cursor;
    if (
      !value || typeof value.id !== "string" || typeof value.measured_at !== "string" ||
      !UUID_PATTERN.test(value.id) || Number.isNaN(new Date(value.measured_at).getTime())
    ) return null;
    return value;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return fail("METHOD_NOT_ALLOWED", "Use GET", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);
    const userClient = getUserClient(authHeader);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return fail("UNAUTHENTICATED", "Invalid session", 401);

    const url = new URL(req.url);
    const rawLimit = url.searchParams.get("limit") ?? "20";
    if (!/^\d+$/.test(rawLimit)) return fail("VALIDATION_ERROR", "limit must be an integer");
    const limit = Number(rawLimit);
    if (limit < 1 || limit > 100) {
      return fail("VALIDATION_ERROR", "limit must be between 1 and 100");
    }
    const siteCode = url.searchParams.get("site_code");
    if (siteCode && !ANTHROPOMETRY_SITE_CODES.includes(
      siteCode as typeof ANTHROPOMETRY_SITE_CODES[number],
    )) {
      return fail("UNKNOWN_SITE", `Unknown anthropometric site: ${siteCode}`);
    }
    const rawCursor = url.searchParams.get("before");
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) return fail("INVALID_CURSOR", "cursor is invalid");

    const service = getServiceClient();
    const sessionColumns =
      "id, status, measured_at, logged_date, timezone, notes, data_contract_version, protocol_version, representative_algorithm_version, thresholds_version, finalized_at, created_at, updated_at";
    let query = service.from("anthropometric_sessions").select(
      siteCode
        ? `${sessionColumns}, anthropometric_representatives!inner(site_code)`
        : sessionColumns,
    )
      .eq("user_id", userData.user.id).eq("status", "finalized")
      .order("measured_at", { ascending: false }).order("id", { ascending: false })
      .limit(limit + 1);
    if (cursor) {
      query = query.or(
        `measured_at.lt.${cursor.measured_at},and(measured_at.eq.${cursor.measured_at},id.lt.${cursor.id})`,
      );
    }
    if (siteCode) {
      query = query
        .eq("anthropometric_representatives.user_id", userData.user.id)
        .eq("anthropometric_representatives.site_code", siteCode);
    }

    const { data: rows, error: sessionsError } = await query;
    if (sessionsError) throw sessionsError;
    const hasMore = (rows?.length ?? 0) > limit;
    const sessions = (rows ?? []).slice(0, limit);
    const ids = sessions.map((session) => session.id as string);

    let readings: Record<string, unknown>[] = [];
    let representatives: Record<string, unknown>[] = [];
    if (ids.length > 0) {
      const [readingsResult, representativesResult] = await Promise.all([
        service.from("anthropometric_readings")
          .select("id, session_id, site_code, reading_number, value_cm")
          .eq("user_id", userData.user.id).in("session_id", ids)
          .order("site_code").order("reading_number"),
        service.from("anthropometric_representatives").select(
          "session_id, site_code, representative_cm, method, reading_count, initial_pair_difference_cm, all_readings_range_cm, quality, quality_flags, algorithm_version, source_reading_ids, selected_reading_indices, unselected_reading_id, selected_pair_spread_cm, pairwise_differences, warning_codes, eligible_for_interpretation, quality_acknowledged_at, quality_acknowledgement_version, created_at",
        ).eq("user_id", userData.user.id).in("session_id", ids)
          .order("site_code"),
      ]);
      if (readingsResult.error) throw readingsResult.error;
      if (representativesResult.error) throw representativesResult.error;
      readings = readingsResult.data ?? [];
      representatives = representativesResult.data ?? [];
    }

    const hydrated = sessions.map((rawSession) => {
      const { anthropometric_representatives: _filterMatch, ...session } = rawSession;
      const sessionReadings = readings
        .filter((reading) =>
          reading.session_id === session.id && (!siteCode || reading.site_code === siteCode)
        )
        .sort((left, right) =>
          (SITE_ORDER.get(left.site_code as string)! - SITE_ORDER.get(right.site_code as string)!) ||
          Number(left.reading_number) - Number(right.reading_number)
        )
        .map((reading) => ({ ...reading, value_cm: Number(reading.value_cm) }));
      const sessionRepresentatives = representatives
        .filter((representative) =>
          representative.session_id === session.id &&
          (!siteCode || representative.site_code === siteCode)
        )
        .sort((left, right) =>
          SITE_ORDER.get(left.site_code as string)! - SITE_ORDER.get(right.site_code as string)!
        )
        .map((representative) => ({
          ...representative,
          representative_cm: Number(representative.representative_cm),
          initial_pair_difference_cm: Number(representative.initial_pair_difference_cm),
          all_readings_range_cm: Number(representative.all_readings_range_cm),
          selected_pair_spread_cm: representative.selected_pair_spread_cm == null
            ? null
            : Number(representative.selected_pair_spread_cm),
        }));
      return { ...session, readings: sessionReadings, representatives: sessionRepresentatives };
    });
    const last = hydrated.at(-1);
    const nextCursor = hasMore && last
      ? encodeCursor({ measured_at: last.measured_at as string, id: last.id as string })
      : null;

    return ok({
      sessions: hydrated,
      next_cursor: nextCursor,
      algorithm_versions: {
        data_contract: ANTHROPOMETRY_DATA_CONTRACT_VERSION,
        protocol: ANTHROPOMETRY_PROTOCOL_VERSION,
        representative: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
        repeatability_thresholds: ANTHROPOMETRY_THRESHOLDS_VERSION,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "anthropometric_history_failed",
      error_code: "UNEXPECTED_ERROR",
    }));
    return fail("INTERNAL_ERROR", "Unexpected error fetching anthropometric history", 500);
  }
});
