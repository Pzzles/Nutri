/** Pure Phase 10 change-summary and Phase 6 uncertainty comparison engine. */
import {
  ANTHROPOMETRY_CHANGE_VERSION,
  ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
  ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
  ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
  WEIGHT_TREND_VERSION,
} from "./scienceConfig.ts";
import {
  ANTHROPOMETRY_SITE_CODES,
  type AnthropometryQuality,
  type AnthropometrySiteCode,
} from "./anthropometry.ts";
import {
  anthropometryProtocolsCompatible,
  compareMeasurementContexts,
  type AnthropometryContextWarningCode,
  type AnthropometryMeasurementContext,
} from "./anthropometryContext.ts";
import type { TrendOutput } from "./weightTrend.ts";

export {
  ANTHROPOMETRY_CHANGE_VERSION,
  ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
  ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
  ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
};

export const ANTHROPOMETRY_CROSS_SIGNAL_MIN_DAYS = 14 as const;
export const ANTHROPOMETRY_WEIGHT_ALIGNMENT_MAX_DAYS = 7 as const;
export const ANTHROPOMETRY_DIRECTION_BAND_CM = 0.5 as const;

export const ANTHROPOMETRY_PROGRESS_LIMITATIONS = [
  "Circumference changes can reflect combinations of fat, muscle, glycogen, fluid, digestion, breathing, posture, and measurement technique.",
  "This feature does not measure body-fat percentage, muscle mass, visceral fat, or body recomposition.",
  "Context differences are cautions, not corrections, and never change stored representatives.",
  "The weight comparison is descriptive and does not alter calorie targets or goal feedback.",
] as const;

export interface AnthropometryProgressInputPoint {
  session_id: string;
  site_code: AnthropometrySiteCode;
  measured_at: string;
  logged_date: string;
  protocol_version: string;
  representative_cm: number;
  quality: AnthropometryQuality;
  measurement_context: AnthropometryMeasurementContext;
  selected_reading_indices?: number[] | null;
  selected_pair_spread_cm?: number | null;
  warning_codes?: string[] | null;
  eligible_for_interpretation?: boolean | null;
  algorithm_version?: string | null;
  raw_readings?: Array<{ id: string; reading_index: number; value_cm: number }>;
}

export interface AnthropometryProgressPoint extends AnthropometryProgressInputPoint {}

export interface AnthropometryComparableValue {
  session_id: string;
  measured_at: string;
  logged_date: string;
  representative_cm: number;
  quality: AnthropometryQuality;
  protocol_version: string;
  representative_algorithm_version: string | null;
}

export interface AnthropometryChangeEvidence {
  from: AnthropometryComparableValue;
  change_cm: number;
  elapsed_days: number;
  direction: CircumferenceDirection;
  context_warning_codes: AnthropometryContextWarningCode[];
}

export interface AnthropometryChangeSummary {
  latest: AnthropometryComparableValue;
  previous: AnthropometryChangeEvidence | null;
  baseline: AnthropometryChangeEvidence | null;
  warning_codes: string[];
  algorithm_version: typeof ANTHROPOMETRY_CHANGE_VERSION;
  context_comparison_version: typeof ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION;
  protocol_compatibility_version: typeof ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION;
}

export interface AnthropometryProgressSeries {
  site_code: AnthropometrySiteCode;
  points: AnthropometryProgressPoint[];
  change_summary: AnthropometryChangeSummary | null;
  warning_codes: string[];
}

export type CircumferenceDirection = "decreasing" | "broadly_stable" | "increasing";
export type WeightDirection = "decreasing" | "broadly_stable_or_uncertain" | "increasing" | "unavailable";
export type AnthropometryWeightMessageCode =
  `${"waist" | "abdomen_navel"}_${CircumferenceDirection}_weight_${Exclude<WeightDirection, "unavailable">}`;

export type WeightComparisonReasonCode =
  | "insufficient_circumference_points"
  | "sessions_too_close_for_interpretation"
  | "circumference_quality_not_eligible"
  | "incompatible_anthropometry_protocol"
  | "latest_central_measurement_not_at_weight_as_of"
  | "weight_status_not_eligible"
  | "weight_confidence_not_eligible"
  | "weight_rate_interval_unavailable"
  | "weight_data_stale"
  | "weight_not_aligned_with_anthropometry";

export interface CircumferenceComparison {
  start_session_id: string;
  end_session_id: string;
  start_measured_at: string;
  end_measured_at: string;
  change_cm: number;
  elapsed_calendar_days: number;
  direction: CircumferenceDirection;
  context_warning_codes: AnthropometryContextWarningCode[];
}

export interface WeightRateEvidence {
  weekly_rate_kg: number | null;
  lower_kg: number | null;
  upper_kg: number | null;
  direction: WeightDirection;
  status: TrendOutput["status"] | null;
  confidence: TrendOutput["confidence"] | null;
  selected_window_days: number | null;
  as_of: string | null;
  latest_weight_measured_at: string | null;
  phase_6_window_start: string | null;
  phase_6_window_end: string | null;
}

export interface AnthropometryWeightComparison {
  eligible: boolean;
  site_code: "waist" | "abdomen_navel" | null;
  circumference: CircumferenceComparison | null;
  weight_trend: WeightRateEvidence;
  message_code: AnthropometryWeightMessageCode | null;
  description: string | null;
  reason_codes: WeightComparisonReasonCode[];
  algorithm_version: typeof ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION;
  evidence_period: {
    anthropometry_start: string;
    anthropometry_end: string;
    weight_as_of: string;
  } | null;
}

export interface AnthropometryProgressResult {
  series: AnthropometryProgressSeries[];
  weight_comparison: AnthropometryWeightComparison | null;
  algorithm_versions: {
    change_summary: typeof ANTHROPOMETRY_CHANGE_VERSION;
    context_comparison: typeof ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION;
    protocol_compatibility: typeof ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION;
    weight_comparison: typeof ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION;
    weight_trend: typeof WEIGHT_TREND_VERSION;
  };
  limitations: string[];
}

const SITE_ORDER = new Map<string, number>(
  ANTHROPOMETRY_SITE_CODES.map((siteCode, index) => [siteCode, index]),
);

function round(value: number, decimals = 6): number {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function calendarDays(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}

function circumferenceDirection(rawChangeCm: number): CircumferenceDirection {
  if (rawChangeCm <= -ANTHROPOMETRY_DIRECTION_BAND_CM) return "decreasing";
  if (rawChangeCm >= ANTHROPOMETRY_DIRECTION_BAND_CM) return "increasing";
  return "broadly_stable";
}

function eligible(point: AnthropometryProgressPoint): boolean {
  return point.eligible_for_interpretation !== false &&
    point.quality !== "repeatability_warning" && point.quality !== "high_variability";
}

function value(point: AnthropometryProgressPoint): AnthropometryComparableValue {
  return {
    session_id: point.session_id,
    measured_at: point.measured_at,
    logged_date: point.logged_date,
    representative_cm: point.representative_cm,
    quality: point.quality,
    protocol_version: point.protocol_version,
    representative_algorithm_version: point.algorithm_version ?? null,
  };
}

function evidence(from: AnthropometryProgressPoint, latest: AnthropometryProgressPoint): AnthropometryChangeEvidence {
  const raw = latest.representative_cm - from.representative_cm;
  return {
    from: value(from),
    change_cm: round(raw, 2),
    elapsed_days: calendarDays(from.logged_date, latest.logged_date),
    direction: circumferenceDirection(raw),
    context_warning_codes: compareMeasurementContexts(from.measurement_context, latest.measurement_context),
  };
}

function summary(points: AnthropometryProgressPoint[]): AnthropometryChangeSummary | null {
  const latest = points[points.length - 1];
  if (!latest || !eligible(latest)) return null;
  const compatible = points.slice(0, -1).filter((point) =>
    eligible(point) && anthropometryProtocolsCompatible(point.protocol_version, latest.protocol_version)
  );
  const previous = compatible[compatible.length - 1] ?? null;
  const baseline = compatible[0] ?? null;
  const warningCodes: string[] = [];
  if (points.slice(0, -1).some((point) =>
    !anthropometryProtocolsCompatible(point.protocol_version, latest.protocol_version)
  )) warningCodes.push("protocol_versions_not_comparable");
  return {
    latest: value(latest),
    previous: previous ? evidence(previous, latest) : null,
    baseline: baseline ? evidence(baseline, latest) : null,
    warning_codes: warningCodes,
    algorithm_version: ANTHROPOMETRY_CHANGE_VERSION,
    context_comparison_version: ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
    protocol_compatibility_version: ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
  };
}

export function buildAnthropometrySeries(
  input: readonly AnthropometryProgressInputPoint[],
): AnthropometryProgressSeries[] {
  const grouped = new Map<AnthropometrySiteCode, AnthropometryProgressPoint[]>();
  for (const point of input) grouped.set(point.site_code, [...(grouped.get(point.site_code) ?? []), { ...point }]);
  return [...grouped.entries()]
    .sort(([left], [right]) => SITE_ORDER.get(left)! - SITE_ORDER.get(right)!)
    .map(([siteCode, rows]) => {
      const points = [...rows].sort((left, right) =>
        Date.parse(left.measured_at) - Date.parse(right.measured_at) ||
        left.session_id.localeCompare(right.session_id)
      );
      const protocols = new Set(points.map((point) => point.protocol_version));
      const latest = points[points.length - 1];
      const warningCodes: string[] = [];
      if (protocols.size > 1 || points.some((point) => point.protocol_version !== "anthropometry_protocol_v1")) {
        warningCodes.push("protocol_versions_not_comparable");
      }
      if (latest && !eligible(latest)) warningCodes.push("latest_value_not_interpretation_eligible");
      return {
        site_code: siteCode,
        points,
        change_summary: summary(points),
        warning_codes: warningCodes,
      };
    });
}

export function weightDirectionFromInterval(trend: TrendOutput | null): WeightDirection {
  const rate = trend?.weekly_rate;
  if (!rate || rate.lower_kg === null || rate.upper_kg === null) return "unavailable";
  if (rate.upper_kg < 0) return "decreasing";
  if (rate.lower_kg > 0) return "increasing";
  return "broadly_stable_or_uncertain";
}

function emptyWeightEvidence(trend: TrendOutput | null, asOf: string | null): WeightRateEvidence {
  return {
    weekly_rate_kg: trend?.weekly_rate?.estimate_kg ?? null,
    lower_kg: trend?.weekly_rate?.lower_kg ?? null,
    upper_kg: trend?.weekly_rate?.upper_kg ?? null,
    direction: weightDirectionFromInterval(trend),
    status: trend?.status ?? null,
    confidence: trend?.confidence ?? null,
    selected_window_days: trend?.measurements.selected_rate_window_days ?? null,
    as_of: asOf,
    latest_weight_measured_at: trend?.measurements.latest_measured_at ?? null,
    phase_6_window_start: trend?.window.start ?? null,
    phase_6_window_end: trend?.window.end ?? null,
  };
}

function descriptionFor(site: "waist" | "abdomen_navel", circumference: CircumferenceDirection, weight: WeightDirection): string {
  const label = site === "waist" ? "waist" : "abdomen at navel";
  const circumferencePhrase = circumference === "decreasing" ? "decreased" :
    circumference === "increasing" ? "increased" : "was broadly stable";
  const weightPhrase = weight === "decreasing" ? "decreased" :
    weight === "increasing" ? "increased" : "was broadly stable or uncertain";
  return `Weight trend ${weightPhrase} while ${label} circumference ${circumferencePhrase} over the recorded period.`;
}

function messageCodeFor(
  site: "waist" | "abdomen_navel",
  circumference: CircumferenceDirection,
  weight: Exclude<WeightDirection, "unavailable">,
): AnthropometryWeightMessageCode {
  return `${site}_${circumference}_weight_${weight}`;
}

function ineligible(
  site: "waist" | "abdomen_navel" | null,
  reason: WeightComparisonReasonCode,
  trend: TrendOutput | null,
  asOf: string | null,
  circumference: CircumferenceComparison | null = null,
): AnthropometryWeightComparison {
  return {
    eligible: false,
    site_code: site,
    circumference,
    weight_trend: emptyWeightEvidence(trend, asOf),
    message_code: null,
    description: null,
    reason_codes: [reason],
    algorithm_version: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
    evidence_period: null,
  };
}

function candidate(
  series: AnthropometryProgressSeries | undefined,
  site: "waist" | "abdomen_navel",
  trend: TrendOutput | null,
  asOf: string | null,
): AnthropometryWeightComparison {
  const latest = series ? series.points[series.points.length - 1] : undefined;
  if (!series || !latest || series.points.length < 2 || !series.change_summary?.baseline) {
    if (latest && !eligible(latest)) return ineligible(site, "circumference_quality_not_eligible", trend, asOf);
    if (latest && series && series.points.some((point) => !anthropometryProtocolsCompatible(point.protocol_version, latest.protocol_version))) {
      return ineligible(site, "incompatible_anthropometry_protocol", trend, asOf);
    }
    return ineligible(site, "insufficient_circumference_points", trend, asOf);
  }
  if (asOf !== latest.measured_at) {
    return ineligible(site, "latest_central_measurement_not_at_weight_as_of", trend, asOf);
  }
  const baselineId = series.change_summary.baseline.from.session_id;
  const start = series.points.find((point) => point.session_id === baselineId)!;
  const rawChange = latest.representative_cm - start.representative_cm;
  const circumference: CircumferenceComparison = {
    start_session_id: start.session_id,
    end_session_id: latest.session_id,
    start_measured_at: start.measured_at,
    end_measured_at: latest.measured_at,
    change_cm: round(rawChange, 2),
    elapsed_calendar_days: calendarDays(start.logged_date, latest.logged_date),
    direction: circumferenceDirection(rawChange),
    context_warning_codes: compareMeasurementContexts(start.measurement_context, latest.measurement_context),
  };
  if (!anthropometryProtocolsCompatible(start.protocol_version, latest.protocol_version)) {
    return ineligible(site, "incompatible_anthropometry_protocol", trend, asOf, circumference);
  }
  if (circumference.elapsed_calendar_days < ANTHROPOMETRY_CROSS_SIGNAL_MIN_DAYS) {
    return ineligible(site, "sessions_too_close_for_interpretation", trend, asOf, circumference);
  }
  if (trend?.status === "stale" || trend?.warnings.includes("stale_data")) {
    return ineligible(site, "weight_data_stale", trend, asOf, circumference);
  }
  if (!trend || (trend.status !== "usable" && trend.status !== "provisional")) {
    return ineligible(site, "weight_status_not_eligible", trend, asOf, circumference);
  }
  if (trend.confidence !== "medium" && trend.confidence !== "high") {
    return ineligible(site, "weight_confidence_not_eligible", trend, asOf, circumference);
  }
  if (weightDirectionFromInterval(trend) === "unavailable") {
    return ineligible(site, "weight_rate_interval_unavailable", trend, asOf, circumference);
  }
  const latestWeight = trend.measurements.latest_measured_at;
  const latestDaily = trend.daily_representatives[trend.daily_representatives.length - 1];
  const latestWeightLocalDate = latestDaily?.local_date ?? latestWeight?.slice(0, 10);
  if (!latestWeight || !latestWeightLocalDate ||
    Math.abs(calendarDays(latestWeightLocalDate, latest.logged_date)) > 7) {
    return ineligible(site, "weight_not_aligned_with_anthropometry", trend, asOf, circumference);
  }
  const evidence = emptyWeightEvidence(trend, asOf);
  return {
    eligible: true,
    site_code: site,
    circumference,
    weight_trend: evidence,
    message_code: messageCodeFor(
      site,
      circumference.direction,
      evidence.direction as Exclude<WeightDirection, "unavailable">,
    ),
    description: descriptionFor(site, circumference.direction, evidence.direction),
    reason_codes: [],
    algorithm_version: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
    evidence_period: {
      anthropometry_start: start.measured_at,
      anthropometry_end: latest.measured_at,
      weight_as_of: asOf!,
    },
  };
}

export function buildWeightComparison(
  series: readonly AnthropometryProgressSeries[],
  weightTrend: TrendOutput | null,
  weightAsOf: string | null,
): AnthropometryWeightComparison {
  const waist = candidate(series.find((entry) => entry.site_code === "waist"), "waist", weightTrend, weightAsOf);
  if (waist.eligible || !["insufficient_circumference_points", "circumference_quality_not_eligible"].includes(waist.reason_codes[0])) return waist;
  const navelSeries = series.find((entry) => entry.site_code === "abdomen_navel");
  return navelSeries ? candidate(navelSeries, "abdomen_navel", weightTrend, weightAsOf) : waist;
}

export function buildAnthropometryProgress(
  points: readonly AnthropometryProgressInputPoint[],
  weightTrend: TrendOutput | null,
  includeWeightComparison = true,
  weightAsOf: string | null = null,
): AnthropometryProgressResult {
  const series = buildAnthropometrySeries(points);
  return {
    series,
    weight_comparison: includeWeightComparison
      ? buildWeightComparison(series, weightTrend, weightAsOf)
      : null,
    algorithm_versions: {
      change_summary: ANTHROPOMETRY_CHANGE_VERSION,
      context_comparison: ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
      protocol_compatibility: ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
      weight_comparison: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
      weight_trend: WEIGHT_TREND_VERSION,
    },
    limitations: [...ANTHROPOMETRY_PROGRESS_LIMITATIONS],
  };
}
