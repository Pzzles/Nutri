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
export type AnthropometryRepresentativeMethod = "mean_of_two" | "median_of_three";
export type AnthropometryQuality =
  | "within_repeatability_threshold"
  | "repeatability_warning";
export type AnthropometryQualityFlag =
  "initial_pair_exceeds_repeatability_threshold";

export type AnthropometryValidationCode =
  | "VALIDATION_ERROR"
  | "UNKNOWN_SITE"
  | "DUPLICATE_SITE"
  | "READING_OUT_OF_RANGE"
  | "INVALID_READING_PRECISION"
  | "THIRD_READING_REQUIRED"
  | "UNEXPECTED_THIRD_READING"
  | "INVALID_READING_COUNT";

export interface AnthropometrySiteInput {
  site_code: string;
  readings_cm: readonly number[];
}

export interface AnthropometryRepresentative {
  site_code: AnthropometrySiteCode;
  readings_cm: number[];
  representative_cm: number;
  method: AnthropometryRepresentativeMethod;
  reading_count: 2 | 3;
  initial_pair_difference_cm: number;
  all_readings_range_cm: number;
  quality: AnthropometryQuality;
  quality_flags: AnthropometryQualityFlag[];
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

  if (!Array.isArray(input.readings_cm)) {
    throw new AnthropometryValidationError(
      "VALIDATION_ERROR",
      "readings_cm must be an array",
      siteCode,
    );
  }

  if (input.readings_cm.length < 2 || input.readings_cm.length > 3) {
    throw new AnthropometryValidationError(
      "INVALID_READING_COUNT",
      "Each site must contain exactly two or three readings",
      siteCode,
    );
  }

  const tenths = input.readings_cm.map((reading) => toTenths(reading, siteCode));
  const initialPairDifferenceTenths = Math.abs(tenths[1] - tenths[0]);
  const firstPairPasses =
    initialPairDifferenceTenths <= ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS;

  if (!firstPairPasses && tenths.length === 2) {
    throw new AnthropometryValidationError(
      "THIRD_READING_REQUIRED",
      "A third reading is required when the first two differ by more than 1.0 cm",
      siteCode,
    );
  }

  if (firstPairPasses && tenths.length === 3) {
    throw new AnthropometryValidationError(
      "UNEXPECTED_THIRD_READING",
      "A third reading is not accepted when the first two are within 1.0 cm",
      siteCode,
    );
  }

  const minTenths = Math.min(...tenths);
  const maxTenths = Math.max(...tenths);

  if (firstPairPasses) {
    return {
      site_code: siteCode,
      readings_cm: tenths.map(fromTenths),
      representative_cm: (tenths[0] + tenths[1]) / 20,
      method: "mean_of_two",
      reading_count: 2,
      initial_pair_difference_cm: fromTenths(initialPairDifferenceTenths),
      all_readings_range_cm: fromTenths(maxTenths - minTenths),
      quality: "within_repeatability_threshold",
      quality_flags: [],
      algorithm_version: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
    };
  }

  const orderedTenths = [...tenths].sort((left, right) => left - right);
  return {
    site_code: siteCode,
    readings_cm: tenths.map(fromTenths),
    representative_cm: fromTenths(orderedTenths[1]),
    method: "median_of_three",
    reading_count: 3,
    initial_pair_difference_cm: fromTenths(initialPairDifferenceTenths),
    all_readings_range_cm: fromTenths(maxTenths - minTenths),
    quality: "repeatability_warning",
    quality_flags: ["initial_pair_exceeds_repeatability_threshold"],
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
