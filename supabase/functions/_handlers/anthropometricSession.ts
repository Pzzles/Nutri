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
  calculateAnthropometryRepresentative,
  calculateAnthropometryRepresentatives,
  type AnthropometryRepresentative,
  type AnthropometrySiteInput,
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
  "source_reading_ids",
  "selected_reading_indices",
  "unselected_reading_id",
  "selected_pair_spread_cm",
  "pairwise_differences",
  "warning_codes",
  "eligible_for_interpretation",
  "quality_acknowledged_at",
  "quality_acknowledgement_version",
  "change_cm",
  "weight_data",
  "weight_kg",
  "payload_hash",
  "logged_date",
  "timezone",
  "finalized_at",
  "user_id",
]);
type ReadingRow = { id: string; site_code: string; reading_number: number; value_cm: number | string };
type RepresentativeRow = {
  site_code: string;
  representative_cm: number | string;
  method: string;
  reading_count: number;
  initial_pair_difference_cm: number | string;
  all_readings_range_cm: number | string;
  quality: string;
  quality_flags: string[];
  source_reading_ids: string[] | null;
  selected_reading_indices: number[] | null;
  unselected_reading_id: string | null;
  selected_pair_spread_cm: number | string | null;
  pairwise_differences: Record<string, number | null> | null;
  warning_codes: string[] | null;
  eligible_for_interpretation: boolean | null;
  quality_acknowledged_at: string | null;
  quality_acknowledgement_version: string | null;
};

const ACKNOWLEDGEMENT_VERSION = "anthropometry_high_variability_ack_v1";

function normalizeAcknowledgements(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "high_variability_acknowledgements must be an array",
    );
  }
  const result = value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new AnthropometryValidationError("VALIDATION_ERROR", "Invalid quality acknowledgement");
    }
    const item = entry as Record<string, unknown>;
    if (typeof item.site_code !== "string" || item.acknowledged !== true ||
      Object.keys(item).some((key) => key !== "site_code" && key !== "acknowledged")) {
      throw new AnthropometryValidationError("VALIDATION_ERROR", "Invalid quality acknowledgement");
    }
    return item.site_code;
  });
  if (new Set(result).size !== result.length) {
    throw new AnthropometryValidationError("VALIDATION_ERROR", "Duplicate quality acknowledgement");
  }
  return result;
}

function calculationSites(
  sites: ReturnType<typeof normalizeSites>,
  rows: ReturnType<typeof flattenReadings>,
): AnthropometrySiteInput[] {
  return sites.map((site) => ({
    site_code: site.site_code,
    readings: rows.filter((row) => row.site_code === site.site_code).map((row) => ({
      id: row.id,
      reading_index: row.reading_number as 1 | 2 | 3,
      value_cm: row.value_cm,
    })),
  }));
}

function publicPreview(representative: AnthropometryRepresentative) {
  const { source_reading_ids: _sourceIds, unselected_reading_id: _unselectedId, ...preview } = representative;
  return preview;
}

function containsForbiddenClientField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenClientField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) =>
    FORBIDDEN_CLIENT_FIELDS.has(key) || containsForbiddenClientField(nested)
  );
}

async function loadOwnedSession(
  service: ReturnType<typeof getServiceClient>,
  authenticatedUserId: string,
  sessionId: string,
) {
  const [sessionResult, readingsResult, representativesResult] = await Promise.all([
    service.from("anthropometric_sessions").select(
      "id, status, measured_at, logged_date, timezone, notes, data_contract_version, protocol_version, representative_algorithm_version, thresholds_version, finalized_at, created_at, updated_at",
    ).eq("id", sessionId).eq("user_id", authenticatedUserId).single(),
    service.from("anthropometric_readings").select("id, site_code, reading_number, value_cm")
      .eq("session_id", sessionId).eq("user_id", authenticatedUserId)
      .order("site_code").order("reading_number"),
    service.from("anthropometric_representatives").select("*")
      .eq("session_id", sessionId).eq("user_id", authenticatedUserId).order("site_code"),
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
      .map((reading) => ({
        id: reading.id,
        reading_index: reading.reading_number,
        value_cm: Number(reading.value_cm),
      }));
    const representative = representatives.find((row) => row.site_code === siteCode);
    if (siteReadings.length === 0 && !representative) return [];
    return [{
      site_code: siteCode,
      readings_cm: siteReadings.map((reading) => reading.value_cm),
      raw_readings: siteReadings,
      ...(representative
        ? {
          representative_cm: Number(representative.representative_cm),
          method: representative.method,
          reading_count: representative.reading_count,
          initial_pair_difference_cm: Number(representative.initial_pair_difference_cm),
          all_readings_range_cm: Number(representative.all_readings_range_cm),
          quality: representative.quality,
          quality_flags: representative.quality_flags,
          source_reading_ids: representative.source_reading_ids,
          selected_reading_indices: representative.selected_reading_indices,
          unselected_reading_id: representative.unselected_reading_id,
          selected_pair_spread_cm: representative.selected_pair_spread_cm === null
            ? null
            : Number(representative.selected_pair_spread_cm),
          pairwise_differences: representative.pairwise_differences,
          warning_codes: representative.warning_codes,
          eligible_for_interpretation: representative.eligible_for_interpretation,
          quality_acknowledged_at: representative.quality_acknowledged_at,
          quality_acknowledgement_version: representative.quality_acknowledgement_version,
          algorithm_version: representative.algorithm_version,
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
    const engineSites = calculationSites(sites, readings);
    const acknowledgements = normalizeAcknowledgements(body.high_variability_acknowledgements);

    let representatives: ReturnType<typeof calculateAnthropometryRepresentatives> | null = null;
    let previews: ReturnType<typeof publicPreview>[] = [];
    let timezone: string | null = null;
    let loggedDate: string | null = null;
    let idempotencyKey: string | null = null;
    let payloadHash: string | null = null;

    const service = getServiceClient();
    if (status === "draft") {
      if (acknowledgements.length > 0) {
        return fail(
          "INVALID_HIGH_VARIABILITY_ACKNOWLEDGEMENT",
          "Quality acknowledgement is accepted only during finalization",
          422,
        );
      }
      previews = engineSites.flatMap((site) => {
        if (site.readings.length < 2) return [];
        try {
          return [publicPreview(calculateAnthropometryRepresentative(site))];
        } catch (error) {
          if (error instanceof AnthropometryValidationError && error.code === "THIRD_READING_REQUIRED") {
            return [];
          }
          throw error;
        }
      });
    }
    if (status === "finalized") {
      idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : null;
      if (!idempotencyKey || !IDEMPOTENCY_PATTERN.test(idempotencyKey)) {
        return fail(
          "VALIDATION_ERROR",
          "idempotency_key must be 1-128 letters, numbers, dots, colons, underscores or hyphens",
        );
      }

      representatives = calculateAnthropometryRepresentatives(engineSites);
      const highVariabilitySites = representatives.representatives
        .filter((representative) => representative.quality === "high_variability")
        .map((representative) => representative.site_code);
      const invalidAcknowledgement = acknowledgements.find((siteCode) =>
        !highVariabilitySites.includes(siteCode as typeof highVariabilitySites[number])
      );
      if (invalidAcknowledgement) {
        return fail(
          "INVALID_HIGH_VARIABILITY_ACKNOWLEDGEMENT",
          "Acknowledgement does not match a high-variability site calculated by the server",
          422,
        );
      }
      const unacknowledged = highVariabilitySites.filter((siteCode) =>
        !acknowledgements.includes(siteCode)
      );
      if (unacknowledged.length > 0) {
        return fail(
          "HIGH_VARIABILITY_CONFIRMATION_REQUIRED",
          "Confirm each high-variability site before saving its low-confidence representative",
          422,
          {
            sites: representatives.representatives
              .filter((representative) => unacknowledged.includes(representative.site_code))
              .map(publicPreview),
          },
        );
      }
      const acknowledgedAt = acknowledgements.length > 0 ? new Date().toISOString() : null;
      representatives = {
        ...representatives,
        representatives: representatives.representatives.map((representative) => ({
          ...representative,
          quality_acknowledged_at: acknowledgements.includes(representative.site_code)
            ? acknowledgedAt
            : null,
          quality_acknowledgement_version: acknowledgements.includes(representative.site_code)
            ? ACKNOWLEDGEMENT_VERSION
            : null,
        })),
      };
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
        high_variability_acknowledgements: acknowledgements,
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
      console.error(JSON.stringify({
        event: "anthropometric_session_save_failed",
        user_id_prefix: userId.slice(0, 8),
        error_code: "PERSISTENCE_FAILED",
      }));
      return fail("INTERNAL_ERROR", "Failed to save anthropometric session", 500);
    }

    const result = rpcData as { session_id: string; replayed: boolean };
    const saved = await loadOwnedSession(service, userId, result.session_id);
    return ok(
      {
        ...saved,
        previews,
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
      const status = error.code === "SECOND_READING_REQUIRED" ||
          error.code === "THIRD_READING_REQUIRED"
        ? 422
        : 400;
      return fail(error.code, error.message, status);
    }
    console.error(JSON.stringify({
      event: "anthropometric_session_save_failed",
      error_code: "UNEXPECTED_ERROR",
    }));
    return fail("INTERNAL_ERROR", "Unexpected error saving anthropometric session", 500);
  }
}
