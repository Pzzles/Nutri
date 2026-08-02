/**
 * Creates or replaces a draft anthropometric session and optionally finalizes
 * it. Raw readings are client input; representatives and quality fields are
 * always recalculated here and persisted atomically by the database RPC.
 */
import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getServiceClient, getUserClient } from "../_shared/supabaseClient.ts";
import { toLocalDateString } from "../_shared/timezone.ts";
import {
  ANTHROPOMETRY_DATA_CONTRACT_VERSION,
  ANTHROPOMETRY_FUTURE_TOLERANCE_MS,
  ANTHROPOMETRY_PROTOCOL_VERSION,
  ANTHROPOMETRY_REPRESENTATIVE_VERSION,
  ANTHROPOMETRY_SITE_CODES,
  ANTHROPOMETRY_THRESHOLDS_VERSION,
  AnthropometryValidationError,
  calculateAnthropometryRepresentatives,
} from "../_shared/anthropometry.ts";
import {
  flattenReadings,
  normalizeNotes,
  normalizeSites,
  optionalUuid,
  parseMeasuredAt,
  sha256Canonical,
} from "../_shared/anthropometryApi.ts";

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const FORBIDDEN_CLIENT_FIELDS = new Set([
  "representatives",
  "representative_cm",
  "representative_algorithm_version",
  "algorithm_version",
  "algorithm_versions",
  "algorithm_output",
  "thresholds_version",
  "initial_pair_difference_cm",
  "all_readings_range_cm",
  "method",
  "reading_count",
  "quality",
  "quality_flags",
  "change_cm",
  "weight_data",
  "weight_kg",
  "payload_hash",
  "logged_date",
  "timezone",
  "finalized_at",
  "user_id",
]);
type ReadingRow = { site_code: string; reading_number: number; value_cm: number | string };
type RepresentativeRow = {
  site_code: string;
  representative_cm: number | string;
  method: string;
  reading_count: number;
  initial_pair_difference_cm: number | string;
  all_readings_range_cm: number | string;
  quality: string;
  quality_flags: string[];
};

function containsForbiddenClientField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenClientField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) =>
    FORBIDDEN_CLIENT_FIELDS.has(key) || containsForbiddenClientField(nested)
  );
}

async function loadSession(service: ReturnType<typeof getServiceClient>, sessionId: string) {
  const [sessionResult, readingsResult, representativesResult] = await Promise.all([
    service.from("anthropometric_sessions").select(
      "id, status, measured_at, logged_date, timezone, notes, data_contract_version, protocol_version, representative_algorithm_version, thresholds_version, finalized_at, created_at, updated_at",
    ).eq("id", sessionId).single(),
    service.from("anthropometric_readings").select("site_code, reading_number, value_cm")
      .eq("session_id", sessionId).order("site_code").order("reading_number"),
    service.from("anthropometric_representatives").select("*")
      .eq("session_id", sessionId).order("site_code"),
  ]);
  if (sessionResult.error || readingsResult.error || representativesResult.error) {
    throw new Error("Failed to load saved anthropometric session");
  }
  const readings = (readingsResult.data ?? []) as ReadingRow[];
  const representatives = (representativesResult.data ?? []) as RepresentativeRow[];
  const sites = ANTHROPOMETRY_SITE_CODES.flatMap((siteCode) => {
    const siteReadings = readings
      .filter((reading) => reading.site_code === siteCode)
      .sort((left, right) => left.reading_number - right.reading_number)
      .map((reading) => Number(reading.value_cm));
    const representative = representatives.find((row) => row.site_code === siteCode);
    if (siteReadings.length === 0 && !representative) return [];
    return [{
      site_code: siteCode,
      readings_cm: siteReadings,
      ...(representative
        ? {
          representative_cm: Number(representative.representative_cm),
          method: representative.method,
          reading_count: representative.reading_count,
          initial_pair_difference_cm: Number(representative.initial_pair_difference_cm),
          all_readings_range_cm: Number(representative.all_readings_range_cm),
          quality: representative.quality,
          quality_flags: representative.quality_flags,
        }
        : {}),
    }];
  });
  return { session: sessionResult.data, sites };
}

export async function handleAnthropometricSessionSave(
  req: Request,
  forcedStatus: "draft" | "finalized" | null = null,
): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "Use POST", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("VALIDATION_ERROR", "A JSON request body is required");

    if (containsForbiddenClientField(body)) {
      return fail(
        "FORBIDDEN_FIELD",
        "Calculated anthropometry fields and user_id must not be supplied by clients",
        422,
      );
    }
    if (forcedStatus && Object.prototype.hasOwnProperty.call(body, "status")) {
      return fail("VALIDATION_ERROR", "status is not accepted by the finalization endpoint");
    }

    const status = forcedStatus ?? body.status;
    if (status !== "draft" && status !== "finalized") {
      return fail("VALIDATION_ERROR", "status must be draft or finalized");
    }
    if (body.protocol_version !== ANTHROPOMETRY_PROTOCOL_VERSION) {
      return fail(
        "UNSUPPORTED_PROTOCOL_VERSION",
        `protocol_version must be ${ANTHROPOMETRY_PROTOCOL_VERSION}`,
        422,
      );
    }

    const sessionId = optionalUuid(body.session_id, "session_id");
    const notes = normalizeNotes(body.notes);
    const sites = normalizeSites(body.sites);
    const measuredAt = parseMeasuredAt(body.measured_at, status === "finalized");
    if (
      status === "finalized" && measuredAt &&
      measuredAt.getTime() > Date.now() + ANTHROPOMETRY_FUTURE_TOLERANCE_MS
    ) {
      return fail(
        "FUTURE_MEASUREMENT",
        "measured_at cannot be more than five minutes in the future",
        422,
      );
    }
    const readings = flattenReadings(sites);

    let representatives: ReturnType<typeof calculateAnthropometryRepresentatives> | null = null;
    let timezone: string | null = null;
    let loggedDate: string | null = null;
    let idempotencyKey: string | null = null;
    let payloadHash: string | null = null;

    const service = getServiceClient();
    if (status === "finalized") {
      idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
      if (!idempotencyKey || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
        return fail(
          "VALIDATION_ERROR",
          "idempotency_key must be 1-128 letters, numbers, dots, colons, underscores or hyphens",
        );
      }

      representatives = calculateAnthropometryRepresentatives(sites);
      const { data: profile, error: profileError } = await service
        .from("profiles").select("timezone").eq("id", userId).maybeSingle();
      if (profileError) throw profileError;
      const effectiveTimezone = profile?.timezone ?? DEFAULT_TIMEZONE;
      timezone = effectiveTimezone;
      try {
        loggedDate = toLocalDateString(measuredAt!, effectiveTimezone);
      } catch {
        return fail("INVALID_PROFILE_TIMEZONE", "The profile timezone is invalid", 422);
      }

      payloadHash = await sha256Canonical({
        measured_at: measuredAt!.toISOString(),
        notes,
        protocol_version: ANTHROPOMETRY_PROTOCOL_VERSION,
        sites,
      });
    }

    const { data: rpcData, error: rpcError } = await service.rpc(
      "fn_save_anthropometric_session",
      {
        p_user_id: userId,
        p_session_id: sessionId,
        p_status: status,
        p_measured_at: measuredAt?.toISOString() ?? null,
        p_notes: notes,
        p_readings: readings,
        p_representatives: representatives?.representatives ?? null,
        p_logged_date: loggedDate,
        p_timezone: timezone,
        p_idempotency_key: idempotencyKey,
        p_payload_hash: payloadHash,
        p_data_contract_version: ANTHROPOMETRY_DATA_CONTRACT_VERSION,
        p_protocol_version: ANTHROPOMETRY_PROTOCOL_VERSION,
        p_representative_algorithm_version:
          representatives ? ANTHROPOMETRY_REPRESENTATIVE_VERSION : null,
        p_thresholds_version: representatives ? ANTHROPOMETRY_THRESHOLDS_VERSION : null,
      },
    );

    if (rpcError) {
      if (rpcError.message.includes("ANTHROPOMETRIC_SESSION_NOT_FOUND")) {
        return fail("NOT_FOUND", "Anthropometric session not found", 404);
      }
      if (rpcError.message.includes("ANTHROPOMETRIC_IDEMPOTENCY_CONFLICT")) {
        return fail(
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was already used for a different finalization payload",
          409,
        );
      }
      if (rpcError.message.includes("IMMUTABLE") || rpcError.message.includes("immutable")) {
        return fail("SESSION_IMMUTABLE", "Finalized sessions cannot be changed", 409);
      }
      console.error(rpcError);
      return fail("INTERNAL_ERROR", "Failed to save anthropometric session", 500);
    }

    const result = rpcData as { session_id: string; replayed: boolean };
    const saved = await loadSession(service, result.session_id);
    return ok(
      {
        ...saved,
        replayed: result.replayed,
        algorithm_versions: {
          data_contract: ANTHROPOMETRY_DATA_CONTRACT_VERSION,
          protocol: ANTHROPOMETRY_PROTOCOL_VERSION,
          representative: status === "finalized" ? ANTHROPOMETRY_REPRESENTATIVE_VERSION : null,
          repeatability_thresholds: status === "finalized" ? ANTHROPOMETRY_THRESHOLDS_VERSION : null,
        },
      },
      status === "draft" || result.replayed ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof AnthropometryValidationError) {
      const status = error.code === "THIRD_READING_REQUIRED" ||
          error.code === "RETAKE_SITE_REQUIRED"
        ? 422
        : 400;
      return fail(error.code, error.message, status);
    }
    console.error(error);
    return fail("INTERNAL_ERROR", "Unexpected error saving anthropometric session", 500);
  }
}
