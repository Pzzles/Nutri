import { callFunction, deleteFunction } from "./supabase";

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
  representative_cm?: number;
  method?: "mean_of_two" | "median_of_three";
  reading_count?: 2 | 3;
  initial_pair_difference_cm?: number;
  all_readings_range_cm?: number;
  quality?: "within_repeatability_threshold" | "repeatability_warning";
  quality_flags?: string[];
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
  replayed: boolean;
  algorithm_versions: {
    data_contract: string;
    protocol: string;
    representative: string | null;
    repeatability_thresholds: string | null;
  };
}

interface SessionRequestBase {
  session_id?: string;
  measured_at?: string;
  notes?: string;
  sites: AnthropometrySitePayload[];
}

export function saveAnthropometryDraft(input: SessionRequestBase) {
  return callFunction<AnthropometrySaveResponse>("save-anthropometric-session", {
    ...input,
    status: "draft",
    protocol_version: ANTHROPOMETRY_PROTOCOL_VERSION,
  });
}

export function finalizeAnthropometrySession(
  input: SessionRequestBase & { measured_at: string; idempotency_key: string },
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

export function needsThirdReading(readingsCm: readonly number[]): boolean {
  if (readingsCm.length < 2) return false;
  const leftTenths = Math.round(readingsCm[0] * 10);
  const rightTenths = Math.round(readingsCm[1] * 10);
  return Math.abs(leftTenths - rightTenths) > 10;
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

export function formatMeasurementInput(valueCm: number, unit: MeasurementUnit): string {
  return unit === "cm" ? valueCm.toFixed(1) : (valueCm / 2.54).toFixed(2);
}

export function siteDefinition(code: AnthropometrySiteCode): AnthropometrySiteDefinition {
  return ANTHROPOMETRY_SITES.find((site) => site.code === code)!;
}
