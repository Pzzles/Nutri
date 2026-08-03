import { callFunction, deleteFunction, getFunction } from "./supabase";

export const ANTHROPOMETRY_PROTOCOL_VERSION = "anthropometry_protocol_v1" as const;
export const ANTHROPOMETRY_REPEATABILITY_THRESHOLD_CM = 1.0 as const;

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
export type MeasurementUnit = "cm" | "in";

export interface AnthropometrySiteDefinition {
  code: AnthropometrySiteCode;
  label: string;
  shortCue: string;
  landmark: string;
  breathing: string;
  optional: boolean;
}

export const ANTHROPOMETRY_SITES: readonly AnthropometrySiteDefinition[] = [
  {
    code: "chest",
    label: "Chest",
    shortCue: "Mid-sternal level",
    landmark: "Place the tape horizontally around your chest at the mid-sternal level: halfway between the suprasternal notch and the lower end of the sternum. Keep your arms relaxed at your sides. Let the tape follow your body without compressing tissue.",
    breathing: "Read at the end of a normal, unforced breath out.",
    optional: false,
  },
  {
    code: "waist",
    label: "Waist (WHO midpoint)",
    shortCue: "Midpoint between last rib and iliac crest",
    landmark: "In the mid-axillary line on each side, find the midpoint between the lower edge of your last palpable rib and the top of your iliac crest. Keep the tape horizontal, feet close together, weight even and arms relaxed.",
    breathing: "Read at the end of a normal, unforced breath out.",
    optional: false,
  },
  {
    code: "abdomen_navel",
    label: "Abdomen at navel",
    shortCue: "Through the middle of the navel",
    landmark: "Centre the tape through the middle of your navel and keep it horizontal around your torso. Stand normally and let your abdomen relax.",
    breathing: "Read at the end of a normal, unforced breath out. This personal-progress site is not the WHO waist measurement.",
    optional: false,
  },
  {
    code: "hips",
    label: "Hips",
    shortCue: "Widest point over the buttocks",
    landmark: "Measure the maximum circumference over your buttocks. Check from the side that the tape is horizontal. Keep feet close together, weight even and arms clear of the tape without compressing tissue.",
    breathing: "Stay relaxed and breathe normally.",
    optional: false,
  },
  {
    code: "left_upper_arm_relaxed",
    label: "Left relaxed upper arm",
    shortCue: "Midpoint from shoulder tip to elbow tip",
    landmark: "Use the midpoint between the lateral tip of your shoulder (acromion) and the tip of your elbow (olecranon). Let your left arm hang loose with your palm facing your thigh. Keep the tape perpendicular to the arm.",
    breathing: "Keep the arm relaxed and breathe normally.",
    optional: false,
  },
  {
    code: "right_upper_arm_relaxed",
    label: "Right relaxed upper arm",
    shortCue: "Midpoint from shoulder tip to elbow tip",
    landmark: "Use the midpoint between the lateral tip of your shoulder (acromion) and the tip of your elbow (olecranon). Let your right arm hang loose with your palm facing your thigh. Keep the tape perpendicular to the arm.",
    breathing: "Keep the arm relaxed and breathe normally.",
    optional: false,
  },
  {
    code: "left_mid_thigh",
    label: "Left mid-thigh",
    shortCue: "Midpoint from groin crease to kneecap",
    landmark: "Use the front midpoint between your inguinal crease and the top edge of your kneecap. Stand upright with weight evenly distributed and thigh muscles relaxed. Keep the tape horizontal and perpendicular to the thigh.",
    breathing: "Keep the thigh relaxed and breathe normally.",
    optional: false,
  },
  {
    code: "right_mid_thigh",
    label: "Right mid-thigh",
    shortCue: "Midpoint from groin crease to kneecap",
    landmark: "Use the front midpoint between your inguinal crease and the top edge of your kneecap. Stand upright with weight evenly distributed and thigh muscles relaxed. Keep the tape horizontal and perpendicular to the thigh.",
    breathing: "Keep the thigh relaxed and breathe normally.",
    optional: false,
  },
  {
    code: "neck",
    label: "Neck",
    shortCue: "Just below the laryngeal prominence",
    landmark: "Place the tape immediately below the laryngeal prominence and perpendicular to your neck. Keep your head neutral, eyes forward and shoulders relaxed. The tape should be snug without compression.",
    breathing: "Stay relaxed and breathe normally.",
    optional: true,
  },
] as const;

export const ANTHROPOMETRY_PREPARATION = [
  "Use the same stretch-resistant tape when practical, marked in centimetres with at least 1 mm divisions.",
  "Measure directly on skin or over thin, close-fitting clothing. Note any change from your usual conditions.",
  "Prefer a similar time of day and similar pre-measurement conditions across sessions.",
  "Stand naturally. Do not pull in your abdomen, expand your chest, flex, or alter your posture.",
  "Re-identify each landmark. Mark limb midpoints with a skin-safe marker if helpful.",
  "Keep the tape flat, untwisted and snug, without indenting or compressing tissue.",
] as const;

export interface AnthropometrySitePayload {
  site_code: AnthropometrySiteCode;
  readings_cm: number[];
}

export interface AnthropometrySavedSite extends AnthropometrySitePayload {
  raw_readings?: Array<{ id: string; reading_index: number; value_cm: number }>;
  representative_cm?: number;
  method?: "mean_of_two" | "median_of_three" | "mean_of_closest_pair";
  reading_count?: 2 | 3;
  initial_pair_difference_cm?: number;
  all_readings_range_cm?: number;
  quality?: AnthropometryQuality;
  quality_flags?: string[];
  source_reading_ids?: string[] | null;
  selected_reading_indices?: number[] | null;
  unselected_reading_id?: string | null;
  selected_pair_spread_cm?: number | null;
  pairwise_differences?: { d12: number; d13: number | null; d23: number | null } | null;
  warning_codes?: string[] | null;
  eligible_for_interpretation?: boolean | null;
  quality_acknowledged_at?: string | null;
  quality_acknowledgement_version?: string | null;
  algorithm_version?: string;
}

export interface AnthropometryRepresentativePreview extends Omit<AnthropometrySavedSite, "readings_cm"> {
  site_code: AnthropometrySiteCode;
  representative_cm: number;
  selected_reading_indices: number[];
  selected_pair_spread_cm: number;
  warning_codes: string[];
  eligible_for_interpretation: boolean;
  quality: AnthropometryQuality;
}

export interface AnthropometrySaveResponse {
  session: {
    id: string;
    status: "draft" | "finalized";
    measured_at: string | null;
    notes: string | null;
    finalized_at: string | null;
  };
  sites: AnthropometrySavedSite[];
  previews?: AnthropometryRepresentativePreview[];
  replayed: boolean;
  algorithm_versions: {
    data_contract: string;
    protocol: string;
    representative: string | null;
    repeatability_thresholds: string | null;
  };
}

export type AnthropometryQuality =
  | "within_repeatability_threshold"
  | "repeatability_warning"
  | "pair_agree"
  | "pair_agree_with_isolated_reading"
  | "high_variability";

export interface AnthropometryProgressPoint {
  session_id: string;
  site_code: AnthropometrySiteCode;
  measured_at: string;
  logged_date: string;
  representative_cm: number;
  quality: AnthropometryQuality;
  selected_reading_indices?: number[] | null;
  selected_pair_spread_cm?: number | null;
  warning_codes?: string[] | null;
  eligible_for_interpretation?: boolean | null;
  algorithm_version?: string | null;
  raw_readings?: Array<{ id: string; reading_index: number; value_cm: number }>;
}

export interface AnthropometryChange {
  start_session_id: string;
  end_session_id: string;
  change_cm: number;
  elapsed_days: number;
}

export interface AnthropometryProgressSeries {
  site_code: AnthropometrySiteCode;
  points: AnthropometryProgressPoint[];
  previous_change: AnthropometryChange | null;
  since_first_change: AnthropometryChange | null;
}

export type AnthropometrySignalDirection =
  | "decreased"
  | "broadly_stable"
  | "increased";

export type AnthropometryComparisonReasonCode =
  | "insufficient_circumference_points"
  | "circumference_interval_too_short"
  | "circumference_repeatability_warning"
  | "weight_status_not_eligible"
  | "weight_confidence_not_eligible"
  | "insufficient_weight_trend_points"
  | "no_aligned_weight_endpoint"
  | "aligned_weight_points_not_distinct"
  | "no_material_cross_signal_template";

export interface AnthropometryWeightComparison {
  eligible: boolean;
  site_code: "waist" | "abdomen_navel" | null;
  circumference: {
    start_session_id: string;
    end_session_id: string;
    change_cm: number;
    direction: AnthropometrySignalDirection;
  } | null;
  weight_trend: {
    start_point_measured_at: string;
    end_point_measured_at: string;
    start_kg: number;
    end_kg: number;
    change_kg: number;
    stable_band_kg: number;
    direction: AnthropometrySignalDirection;
  } | null;
  description: string | null;
  reason_codes?: AnthropometryComparisonReasonCode[];
}

export interface AnthropometryProgressResponse {
  series: AnthropometryProgressSeries[];
  weight_comparison: AnthropometryWeightComparison | null;
  algorithm_versions: {
    change: string;
    weight_comparison: string;
    weight_trend: string;
  };
  limitations: string[];
}

interface SessionRequestBase {
  session_id?: string;
  measured_at?: string;
  notes?: string;
  sites: AnthropometrySitePayload[];
}

export interface HighVariabilityAcknowledgement {
  site_code: AnthropometrySiteCode;
  acknowledged: true;
}

export function saveAnthropometryDraft(input: SessionRequestBase) {
  return callFunction<AnthropometrySaveResponse>("save-anthropometric-session", {
    ...input,
    status: "draft",
    protocol_version: ANTHROPOMETRY_PROTOCOL_VERSION,
  });
}

export function finalizeAnthropometrySession(
  input: SessionRequestBase & {
    measured_at: string;
    idempotency_key: string;
    high_variability_acknowledgements?: HighVariabilityAcknowledgement[];
  },
) {
  return callFunction<AnthropometrySaveResponse>("finalize-anthropometric-session", {
    ...input,
    protocol_version: ANTHROPOMETRY_PROTOCOL_VERSION,
  });
}

export function deleteAnthropometrySession(sessionId: string) {
  return deleteFunction<{ deleted_session_id: string }>("delete-anthropometric-session", {
    session_id: sessionId,
  });
}

export function getAnthropometricProgress(options: {
  from?: string;
  to?: string;
  siteCode?: AnthropometrySiteCode;
  includeWeightComparison?: boolean;
} = {}) {
  const params: Record<string, string> = {};
  if (options.from) params.from = options.from;
  if (options.to) params.to = options.to;
  if (options.siteCode) params.site_code = options.siteCode;
  if (options.includeWeightComparison !== undefined) {
    params.include_weight_comparison = String(options.includeWeightComparison);
  }
  return getFunction<AnthropometryProgressResponse>(
    "get-anthropometric-progress",
    params,
  );
}

export function needsThirdReading(readingsCm: readonly number[]): boolean {
  if (readingsCm.length < 2) return false;
  const leftTenths = Math.round(readingsCm[0] * 10);
  const rightTenths = Math.round(readingsCm[1] * 10);
  return Math.abs(leftTenths - rightTenths) >
    ANTHROPOMETRY_REPEATABILITY_THRESHOLD_CM * 10;
}

export function inputToCentimetres(
  raw: string,
  unit: MeasurementUnit,
): { valueCm: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { valueCm: null, error: "Enter a measurement." };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { valueCm: null, error: "Enter a valid number." };
  }

  if (unit === "cm") {
    const tenths = Math.round(value * 10);
    if (Math.abs(value * 10 - tenths) > 1e-8) {
      return { valueCm: null, error: "Record centimetres to one decimal place." };
    }
    if (tenths < 50 || tenths > 3000) {
      return { valueCm: null, error: "Enter a measurement between 5.0 and 300.0 cm." };
    }
    return { valueCm: tenths / 10, error: null };
  }

  const centimetreTenths = Math.round(value * 2.54 * 10);
  if (centimetreTenths < 50 || centimetreTenths > 3000) {
    return { valueCm: null, error: "Enter a measurement between 2.0 and 118.1 inches." };
  }
  return { valueCm: centimetreTenths / 10, error: null };
}

export function formatMeasurement(valueCm: number, unit: MeasurementUnit): string {
  const value = unit === "cm" ? valueCm : valueCm / 2.54;
  return `${(Math.round(value * 10) / 10).toFixed(1)} ${unit}`;
}

export function formatMeasurementChange(valueCm: number, unit: MeasurementUnit): string {
  const value = unit === "cm" ? valueCm : valueCm / 2.54;
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)} ${unit}`;
}

export function formatMeasurementInput(valueCm: number, unit: MeasurementUnit): string {
  return unit === "cm" ? valueCm.toFixed(1) : (valueCm / 2.54).toFixed(2);
}

export function siteDefinition(code: AnthropometrySiteCode): AnthropometrySiteDefinition {
  return ANTHROPOMETRY_SITES.find((site) => site.code === code)!;
}
