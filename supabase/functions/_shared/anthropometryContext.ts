import {
  ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
  ANTHROPOMETRY_MEASUREMENT_CONTEXT_VERSION,
  ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
  ANTHROPOMETRY_PROTOCOL_VERSION,
} from "./scienceConfig.ts";

export {
  ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
  ANTHROPOMETRY_MEASUREMENT_CONTEXT_VERSION,
  ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
};

export const MEAL_TIMINGS = ["before_food", "after_food", "not_recorded"] as const;
export const MEASUREMENT_ASSISTANCE = ["self", "assisted", "not_recorded"] as const;
export const CLOTHING_LEVELS = ["minimal", "light", "normal", "other", "not_recorded"] as const;

export type MealTiming = typeof MEAL_TIMINGS[number];
export type MeasurementAssistance = typeof MEASUREMENT_ASSISTANCE[number];
export type ClothingLevel = typeof CLOTHING_LEVELS[number];

export interface AnthropometryMeasurementContext {
  version: string | null;
  local_time: string | null;
  meal_timing: MealTiming;
  after_bathroom: boolean | null;
  exercise_within_previous_12_hours: boolean | null;
  measurement_assistance: MeasurementAssistance;
  clothing_level: ClothingLevel;
}

export interface AnthropometryContextInput {
  meal_timing: MealTiming;
  after_bathroom: boolean | null;
  exercise_within_previous_12_hours: boolean | null;
  measurement_assistance: MeasurementAssistance;
  clothing_level: ClothingLevel;
}

export type AnthropometryContextWarningCode =
  | "time_of_day_differs_materially"
  | "meal_timing_differs"
  | "bathroom_context_differs"
  | "recent_exercise_context_differs"
  | "measurement_assistance_differs"
  | "clothing_level_differs";

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  fallback: T[number],
): T[number] {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${field} has an unsupported value`);
  }
  return value as T[number];
}

function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${field} must be true, false or null`);
  return value;
}

export function normalizeMeasurementContext(value: unknown): AnthropometryContextInput {
  if (value === undefined || value === null) {
    return {
      meal_timing: "not_recorded",
      after_bathroom: null,
      exercise_within_previous_12_hours: null,
      measurement_assistance: "not_recorded",
      clothing_level: "not_recorded",
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("measurement_context must be an object");
  }
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "meal_timing",
    "after_bathroom",
    "exercise_within_previous_12_hours",
    "measurement_assistance",
    "clothing_level",
  ]);
  const extra = Object.keys(input).find((key) => !allowed.has(key));
  if (extra) throw new Error(`measurement_context.${extra} is not accepted`);
  return {
    meal_timing: enumValue(input.meal_timing, MEAL_TIMINGS, "meal_timing", "not_recorded"),
    after_bathroom: optionalBoolean(input.after_bathroom, "after_bathroom"),
    exercise_within_previous_12_hours: optionalBoolean(
      input.exercise_within_previous_12_hours,
      "exercise_within_previous_12_hours",
    ),
    measurement_assistance: enumValue(
      input.measurement_assistance,
      MEASUREMENT_ASSISTANCE,
      "measurement_assistance",
      "not_recorded",
    ),
    clothing_level: enumValue(input.clothing_level, CLOTHING_LEVELS, "clothing_level", "not_recorded"),
  };
}

export function contextFromRow(row: Record<string, unknown>): AnthropometryMeasurementContext {
  return {
    version: typeof row.measurement_context_version === "string"
      ? row.measurement_context_version
      : null,
    local_time: typeof row.local_time === "string" ? row.local_time : null,
    meal_timing: MEAL_TIMINGS.includes(row.meal_timing as MealTiming)
      ? row.meal_timing as MealTiming
      : "not_recorded",
    after_bathroom: typeof row.after_bathroom === "boolean" ? row.after_bathroom : null,
    exercise_within_previous_12_hours:
      typeof row.exercise_within_previous_12_hours === "boolean"
        ? row.exercise_within_previous_12_hours
        : null,
    measurement_assistance: MEASUREMENT_ASSISTANCE.includes(
      row.measurement_assistance as MeasurementAssistance,
    ) ? row.measurement_assistance as MeasurementAssistance : "not_recorded",
    clothing_level: CLOTHING_LEVELS.includes(row.clothing_level as ClothingLevel)
      ? row.clothing_level as ClothingLevel
      : "not_recorded",
  };
}

function seconds(time: string | null): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0) : null;
}

export function compareMeasurementContexts(
  left: AnthropometryMeasurementContext,
  right: AnthropometryMeasurementContext,
): AnthropometryContextWarningCode[] {
  const warnings: AnthropometryContextWarningCode[] = [];
  const leftSeconds = seconds(left.local_time);
  const rightSeconds = seconds(right.local_time);
  if (leftSeconds !== null && rightSeconds !== null) {
    const direct = Math.abs(leftSeconds - rightSeconds);
    const circular = Math.min(direct, 86_400 - direct);
    if (circular > 4 * 3600) warnings.push("time_of_day_differs_materially");
  }
  if (left.meal_timing !== "not_recorded" && right.meal_timing !== "not_recorded" &&
    left.meal_timing !== right.meal_timing) warnings.push("meal_timing_differs");
  if (left.after_bathroom !== null && right.after_bathroom !== null &&
    left.after_bathroom !== right.after_bathroom) warnings.push("bathroom_context_differs");
  if (left.exercise_within_previous_12_hours !== null &&
    right.exercise_within_previous_12_hours !== null &&
    left.exercise_within_previous_12_hours !== right.exercise_within_previous_12_hours) {
    warnings.push("recent_exercise_context_differs");
  }
  if (left.measurement_assistance !== "not_recorded" &&
    right.measurement_assistance !== "not_recorded" &&
    left.measurement_assistance !== right.measurement_assistance) {
    warnings.push("measurement_assistance_differs");
  }
  if (left.clothing_level !== "not_recorded" && right.clothing_level !== "not_recorded" &&
    left.clothing_level !== right.clothing_level) warnings.push("clothing_level_differs");
  return warnings;
}

/** v1 intentionally recognises only the frozen WHO-based Phase 10 protocol. */
export function anthropometryProtocolsCompatible(left: string, right: string): boolean {
  return left === ANTHROPOMETRY_PROTOCOL_VERSION && right === ANTHROPOMETRY_PROTOCOL_VERSION;
}
