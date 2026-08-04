/**
 * Phase 10 anthropometric representative engine.
 *
 * Pure, deterministic, and side-effect free. Raw readings are validated and
 * converted to integer tenths of a centimetre before any comparison or
 * arithmetic. Database and API layers must treat this module as authoritative.
 */

import {
  ANTHROPOMETRY_DATA_CONTRACT_VERSION,
  ANTHROPOMETRY_FUTURE_TOLERANCE_MS,
  ANTHROPOMETRY_MAX_READING_TENTHS,
  ANTHROPOMETRY_MIN_READING_TENTHS,
  ANTHROPOMETRY_PROTOCOL_VERSION,
  ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS,
  ANTHROPOMETRY_REPRESENTATIVE_VERSION,
  ANTHROPOMETRY_THRESHOLDS_VERSION,
} from "./scienceConfig.ts";

export {
  ANTHROPOMETRY_DATA_CONTRACT_VERSION,
  ANTHROPOMETRY_FUTURE_TOLERANCE_MS,
  ANTHROPOMETRY_MAX_READING_TENTHS,
  ANTHROPOMETRY_MIN_READING_TENTHS,
  ANTHROPOMETRY_PROTOCOL_VERSION,
  ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS,
  ANTHROPOMETRY_REPRESENTATIVE_VERSION,
  ANTHROPOMETRY_THRESHOLDS_VERSION,
};

export const ANTHROPOMETRY_SITE_CODES = [
  "chest",
  "waist",
  "abdomen_navel",
  "hips",
  "left_upper_arm_relaxed",
  "right_upper_arm_relaxed",
  "left_mid_thigh",
  "right_mid_thigh",
  "neck",
] as const;

export type AnthropometrySiteCode = typeof ANTHROPOMETRY_SITE_CODES[number];
export type AnthropometryRepresentativeMethod = "mean_of_two" | "mean_of_closest_pair";
export type AnthropometryQuality =
  | "pair_agree"
  | "pair_agree_with_isolated_reading"
  | "high_variability"
  | "within_repeatability_threshold"
  | "repeatability_warning";
export type AnthropometryWarningCode =
  | "isolated_reading_excluded"
  | "no_pair_within_repeatability_threshold";

export type AnthropometryValidationCode =
  | "VALIDATION_ERROR"
  | "UNKNOWN_SITE"
  | "DUPLICATE_SITE"
  | "READING_OUT_OF_RANGE"
  | "INVALID_READING_PRECISION"
  | "SECOND_READING_REQUIRED"
  | "THIRD_READING_REQUIRED"
  | "INVALID_READING_COUNT";

export interface AnthropometryReadingInput {
  id: string;
  reading_index: 1 | 2 | 3;
  value_cm: number;
}

export interface AnthropometrySiteInput {
  site_code: string;
  readings: readonly AnthropometryReadingInput[];
}

export interface AnthropometryRepresentative {
  site_code: AnthropometrySiteCode;
  representative_cm: number;
  method: AnthropometryRepresentativeMethod;
  reading_count: 2 | 3;
  source_reading_ids: [string, string];
  selected_reading_indices: [number, number];
  unselected_reading_id: string | null;
  selected_pair_spread_cm: number;
  pairwise_differences: { d12: number; d13: number | null; d23: number | null };
  warning_codes: AnthropometryWarningCode[];
  eligible_for_interpretation: boolean;
  initial_pair_difference_cm: number;
  all_readings_range_cm: number;
  quality: AnthropometryQuality;
  quality_flags: AnthropometryWarningCode[];
  algorithm_version: typeof ANTHROPOMETRY_REPRESENTATIVE_VERSION;
}

export interface AnthropometryRepresentativeSet {
  representatives: AnthropometryRepresentative[];
  algorithm_versions: {
    data_contract: typeof ANTHROPOMETRY_DATA_CONTRACT_VERSION;
    protocol: typeof ANTHROPOMETRY_PROTOCOL_VERSION;
    representative: typeof ANTHROPOMETRY_REPRESENTATIVE_VERSION;
    repeatability_thresholds: typeof ANTHROPOMETRY_THRESHOLDS_VERSION;
  };
}

export class AnthropometryValidationError extends Error {
  readonly code: AnthropometryValidationCode;
  readonly siteCode: string | null;

  constructor(
    code: AnthropometryValidationCode,
    message: string,
    siteCode: string | null = null,
  ) {
    super(message);
    this.name = "AnthropometryValidationError";
    this.code = code;
    this.siteCode = siteCode;
  }
}

const SITE_CODE_SET: ReadonlySet<string> = new Set(ANTHROPOMETRY_SITE_CODES);
const SITE_ORDER = new Map<string, number>(
  ANTHROPOMETRY_SITE_CODES.map((siteCode, index) => [siteCode, index]),
);

function assertSiteCode(siteCode: string): asserts siteCode is AnthropometrySiteCode {
  if (!SITE_CODE_SET.has(siteCode)) {
    throw new AnthropometryValidationError(
      "UNKNOWN_SITE",
      `Unknown anthropometric site: ${siteCode}`,
      siteCode,
    );
  }
}

function toTenths(valueCm: number, siteCode: string): number {
  if (!Number.isFinite(valueCm)) {
    throw new AnthropometryValidationError(
      "READING_OUT_OF_RANGE",
      "Readings must be finite numbers between 5.0 and 300.0 cm",
      siteCode,
    );
  }

  const scaled = valueCm * 10;
  const tenths = Math.round(scaled);

  if (Math.abs(scaled - tenths) > 1e-8) {
    throw new AnthropometryValidationError(
      "INVALID_READING_PRECISION",
      "Readings must be recorded to one decimal place",
      siteCode,
    );
  }

  if (
    tenths < ANTHROPOMETRY_MIN_READING_TENTHS ||
    tenths > ANTHROPOMETRY_MAX_READING_TENTHS
  ) {
    throw new AnthropometryValidationError(
      "READING_OUT_OF_RANGE",
      "Readings must be between 5.0 and 300.0 cm",
      siteCode,
    );
  }

  return tenths;
}

function fromTenths(tenths: number): number {
  return tenths / 10;
}

/** Calculate one site's representative without mutating the input array. */
export function calculateAnthropometryRepresentative(
  input: AnthropometrySiteInput,
): AnthropometryRepresentative {
  assertSiteCode(input.site_code);
  const siteCode = input.site_code;

  if (!Array.isArray(input.readings)) {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "readings must be an array",
      siteCode,
    );
  }

  if (input.readings.length === 1) {
    throw new AnthropometryValidationError(
      "SECOND_READING_REQUIRED",
      "A second reading is required",
      siteCode,
    );
  }
  if (input.readings.length < 1 || input.readings.length > 3) {
    throw new AnthropometryValidationError(
      "INVALID_READING_COUNT",
      "Each finalised site must contain one to three readings",
      siteCode,
    );
  }

  const readings = input.readings.map((reading, offset) => {
    if (!reading || typeof reading.id !== "string" || reading.id.length === 0 ||
      reading.reading_index !== offset + 1) {
      throw new AnthropometryValidationError(
        "VALIDATION_ERROR",
        "Reading identifiers and indices must be present in original order",
        siteCode,
      );
    }
    return { ...reading, tenths: toTenths(reading.value_cm, siteCode) };
  });
  if (new Set(readings.map((reading) => reading.id)).size !== readings.length) {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "Reading identifiers must be unique",
      siteCode,
    );
  }

  const tenths = readings.map((reading) => reading.tenths);
  const initialPairDifferenceTenths = Math.abs(tenths[1] - tenths[0]);
  if (tenths.length === 2 &&
    initialPairDifferenceTenths > ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS) {
    throw new AnthropometryValidationError(
      "THIRD_READING_REQUIRED",
      "A third reading is required when the first two differ by more than 1.0 cm",
      siteCode,
    );
  }

  const minTenths = Math.min(...tenths);
  const maxTenths = Math.max(...tenths);
  const pairwise = {
    d12: Math.abs(tenths[0] - tenths[1]),
    d13: tenths.length === 3 ? Math.abs(tenths[0] - tenths[2]) : null,
    d23: tenths.length === 3 ? Math.abs(tenths[1] - tenths[2]) : null,
  };
  const candidates = tenths.length === 2
    ? [{ indices: [0, 1] as const, spread: pairwise.d12 }]
    : [
      { indices: [0, 1] as const, spread: pairwise.d12 },
      { indices: [0, 2] as const, spread: pairwise.d13! },
      { indices: [1, 2] as const, spread: pairwise.d23! },
    ];
  const selected = candidates.reduce((best, candidate) =>
    candidate.spread < best.spread ? candidate : best
  );
  const [left, right] = selected.indices;
  const unselectedIndex = tenths.length === 3
    ? [0, 1, 2].find((index) => index !== left && index !== right)!
    : null;
  const pairAgrees = selected.spread <= ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS;
  const isolated = pairAgrees && unselectedIndex !== null &&
    Math.abs(tenths[unselectedIndex] - tenths[left]) > ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS &&
    Math.abs(tenths[unselectedIndex] - tenths[right]) > ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS;
  const quality: AnthropometryQuality = !pairAgrees
    ? "high_variability"
    : isolated
    ? "pair_agree_with_isolated_reading"
    : "pair_agree";
  const warningCodes: AnthropometryWarningCode[] = !pairAgrees
    ? ["no_pair_within_repeatability_threshold"]
    : isolated
    ? ["isolated_reading_excluded"]
    : [];
  return {
    site_code: siteCode,
    representative_cm: (tenths[left] + tenths[right]) / 20,
    method: tenths.length === 2 ? "mean_of_two" : "mean_of_closest_pair",
    reading_count: tenths.length as 2 | 3,
    source_reading_ids: [readings[left].id, readings[right].id],
    selected_reading_indices: [left + 1, right + 1],
    unselected_reading_id: unselectedIndex === null ? null : readings[unselectedIndex].id,
    selected_pair_spread_cm: fromTenths(selected.spread),
    pairwise_differences: {
      d12: fromTenths(pairwise.d12),
      d13: pairwise.d13 === null ? null : fromTenths(pairwise.d13),
      d23: pairwise.d23 === null ? null : fromTenths(pairwise.d23),
    },
    warning_codes: warningCodes,
    eligible_for_interpretation: pairAgrees,
    initial_pair_difference_cm: fromTenths(initialPairDifferenceTenths),
    all_readings_range_cm: fromTenths(maxTenths - minTenths),
    quality,
    quality_flags: warningCodes,
    algorithm_version: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
  };
}

/**
 * Calculate all supplied sites and return them in the frozen site order.
 * Missing sites remain absent. Duplicate site rows are rejected rather than
 * resolved by input order, which keeps tie behaviour deterministic.
 */
export function calculateAnthropometryRepresentatives(
  sites: readonly AnthropometrySiteInput[],
): AnthropometryRepresentativeSet {
  if (!Array.isArray(sites) || sites.length === 0) {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "At least one anthropometric site is required",
    );
  }

  const seen = new Set<string>();
  const representatives: AnthropometryRepresentative[] = [];

  for (const site of sites) {
    if (seen.has(site.site_code)) {
      throw new AnthropometryValidationError(
        "DUPLICATE_SITE",
        `Duplicate anthropometric site: ${site.site_code}`,
        site.site_code,
      );
    }
    seen.add(site.site_code);
    representatives.push(calculateAnthropometryRepresentative(site));
  }

  representatives.sort(
    (left, right) => SITE_ORDER.get(left.site_code)! - SITE_ORDER.get(right.site_code)!,
  );

  return {
    representatives,
    algorithm_versions: {
      data_contract: ANTHROPOMETRY_DATA_CONTRACT_VERSION,
      protocol: ANTHROPOMETRY_PROTOCOL_VERSION,
      representative: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
      repeatability_thresholds: ANTHROPOMETRY_THRESHOLDS_VERSION,
    },
  };
}
