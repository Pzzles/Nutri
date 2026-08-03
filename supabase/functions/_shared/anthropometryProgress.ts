/**
 * Phase 10 longitudinal change and Phase 6 cross-signal description engine.
 *
 * This module is pure. It consumes stored, server-authoritative circumference
 * representatives and the canonical Phase 6 weight-trend result. It never
 * interpolates, smooths, or mutates either signal.
 */

import {
  ANTHROPOMETRY_CHANGE_VERSION,
  ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
  WEIGHT_TREND_VERSION,
} from "./scienceConfig.ts";
import {
  ANTHROPOMETRY_SITE_CODES,
  type AnthropometryQuality,
  type AnthropometrySiteCode,
} from "./anthropometry.ts";
import type { TrendOutput, WeightEWMAPoint } from "./weightTrend.ts";

export {
  ANTHROPOMETRY_CHANGE_VERSION,
  ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
};

export const ANTHROPOMETRY_CROSS_SIGNAL_MIN_DAYS = 14 as const;
export const ANTHROPOMETRY_WEIGHT_ALIGNMENT_MAX_DAYS = 7 as const;
export const ANTHROPOMETRY_DIRECTION_BAND_CM = 1 as const;

export const ANTHROPOMETRY_PROGRESS_LIMITATIONS = [
  "Circumference changes can reflect combinations of fat, muscle, glycogen, fluid, digestion, breathing, posture, and measurement technique.",
  "This feature does not measure body-fat percentage, muscle mass, visceral fat, or body recomposition.",
  "The weight comparison is descriptive and does not alter calorie targets or goal feedback.",
] as const;

export interface AnthropometryProgressInputPoint {
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

export interface AnthropometryProgressPoint extends AnthropometryProgressInputPoint {}

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

export type SignalDirection = "decreased" | "broadly_stable" | "increased";

export type WeightComparisonReasonCode =
  | "insufficient_circumference_points"
  | "circumference_interval_too_short"
  | "circumference_repeatability_warning"
  | "weight_status_not_eligible"
  | "weight_confidence_not_eligible"
  | "insufficient_weight_trend_points"
  | "no_aligned_weight_endpoint"
  | "aligned_weight_points_not_distinct"
  | "no_material_cross_signal_template";

export interface CircumferenceComparison {
  start_session_id: string;
  end_session_id: string;
  change_cm: number;
  direction: SignalDirection;
}

export interface AlignedWeightComparison {
  start_point_measured_at: string;
  end_point_measured_at: string;
  start_kg: number;
  end_kg: number;
  change_kg: number;
  stable_band_kg: number;
  direction: SignalDirection;
}

export interface AnthropometryWeightComparison {
  eligible: boolean;
  site_code: "waist" | "abdomen_navel" | null;
  circumference: CircumferenceComparison | null;
  weight_trend: AlignedWeightComparison | null;
  description: string | null;
  reason_codes?: WeightComparisonReasonCode[];
}

export interface AnthropometryProgressResult {
  series: AnthropometryProgressSeries[];
  weight_comparison: AnthropometryWeightComparison | null;
  algorithm_versions: {
    change: typeof ANTHROPOMETRY_CHANGE_VERSION;
    weight_comparison: typeof ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION;
    weight_trend: typeof WEIGHT_TREND_VERSION;
  };
  limitations: string[];
}

const DAY_MS = 86_400_000;
const SITE_ORDER = new Map<string, number>(
  ANTHROPOMETRY_SITE_CODES.map((siteCode, index) => [siteCode, index]),
);

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function changeBetween(
  start: AnthropometryProgressPoint,
  end: AnthropometryProgressPoint,
): AnthropometryChange {
  return {
    start_session_id: start.session_id,
    end_session_id: end.session_id,
    change_cm: round(end.representative_cm - start.representative_cm, 2),
    elapsed_days: round(
      (Date.parse(end.measured_at) - Date.parse(start.measured_at)) / DAY_MS,
      6,
    ),
  };
}

export function buildAnthropometrySeries(
  input: readonly AnthropometryProgressInputPoint[],
): AnthropometryProgressSeries[] {
  const grouped = new Map<AnthropometrySiteCode, AnthropometryProgressPoint[]>();
  for (const point of input) {
    const points = grouped.get(point.site_code) ?? [];
    points.push({ ...point });
    grouped.set(point.site_code, points);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => SITE_ORDER.get(left)! - SITE_ORDER.get(right)!)
    .map(([siteCode, unsorted]) => {
      const points = [...unsorted].sort((left, right) =>
        Date.parse(left.measured_at) - Date.parse(right.measured_at) ||
        left.session_id.localeCompare(right.session_id)
      );
      const latest = points[points.length - 1];
      return {
        site_code: siteCode,
        points,
        previous_change: points.length < 2
          ? null
          : changeBetween(points[points.length - 2], latest),
        since_first_change: points.length < 2
          ? null
          : changeBetween(points[0], latest),
      };
    });
}

function circumferenceDirection(changeCm: number): SignalDirection {
  if (changeCm <= -ANTHROPOMETRY_DIRECTION_BAND_CM) return "decreased";
  if (changeCm >= ANTHROPOMETRY_DIRECTION_BAND_CM) return "increased";
  return "broadly_stable";
}

function weightDirection(changeKg: number, stableBandKg: number): SignalDirection {
  if (changeKg < -stableBandKg) return "decreased";
  if (changeKg > stableBandKg) return "increased";
  return "broadly_stable";
}

function closestWeightPoint(
  measuredAt: string,
  points: readonly WeightEWMAPoint[],
): WeightEWMAPoint | null {
  const targetMs = Date.parse(measuredAt);
  const maxMs = ANTHROPOMETRY_WEIGHT_ALIGNMENT_MAX_DAYS * DAY_MS;
  let closest: WeightEWMAPoint | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const pointMs = Date.parse(point.measured_at);
    const distance = Math.abs(pointMs - targetMs);
    if (
      distance <= maxMs &&
      (distance < closestDistance ||
        (distance === closestDistance && pointMs < Date.parse(closest!.measured_at)))
    ) {
      closest = point;
      closestDistance = distance;
    }
  }
  return closest;
}

function descriptionFor(
  siteCode: "waist" | "abdomen_navel",
  circumference: SignalDirection,
  weight: SignalDirection,
): string | null {
  const siteLabel = siteCode === "waist" ? "waist" : "abdomen at navel";
  if (weight === "broadly_stable" && circumference !== "broadly_stable") {
    return `Weight trend was broadly stable while ${siteLabel} circumference ${circumference}.`;
  }
  if (weight === "decreased" && circumference === "decreased") {
    return `Weight trend and ${siteLabel} circumference both decreased over this period.`;
  }
  if (weight === "increased" && circumference === "increased") {
    return `Weight trend and ${siteLabel} circumference both increased over this period.`;
  }
  if (weight === "decreased" && circumference === "increased") {
    return `Weight trend decreased while ${siteLabel} circumference increased.`;
  }
  if (weight === "increased" && circumference === "decreased") {
    return `Weight trend increased while ${siteLabel} circumference decreased.`;
  }
  return null;
}

function ineligible(
  siteCode: "waist" | "abdomen_navel" | null,
  reason: WeightComparisonReasonCode,
  circumference: CircumferenceComparison | null = null,
  weightTrend: AlignedWeightComparison | null = null,
): AnthropometryWeightComparison {
  return {
    eligible: false,
    site_code: siteCode,
    circumference,
    weight_trend: weightTrend,
    description: null,
    reason_codes: [reason],
  };
}

interface CandidateResult {
  comparison: AnthropometryWeightComparison;
  mayFallback: boolean;
}

function compareCandidate(
  series: AnthropometryProgressSeries | undefined,
  siteCode: "waist" | "abdomen_navel",
  weightTrend: TrendOutput | null,
): CandidateResult {
  if (!series || series.points.length < 2) {
    return {
      comparison: ineligible(siteCode, "insufficient_circumference_points"),
      mayFallback: true,
    };
  }

  const start = series.points[0];
  const end = series.points[series.points.length - 1];
  const change = changeBetween(start, end);
  const circumference: CircumferenceComparison = {
    start_session_id: start.session_id,
    end_session_id: end.session_id,
    change_cm: change.change_cm,
    direction: circumferenceDirection(change.change_cm),
  };

  if (change.elapsed_days < ANTHROPOMETRY_CROSS_SIGNAL_MIN_DAYS) {
    return {
      comparison: ineligible(
        siteCode,
        "circumference_interval_too_short",
        circumference,
      ),
      mayFallback: true,
    };
  }
  if (
    start.quality === "repeatability_warning" || end.quality === "repeatability_warning" ||
    start.eligible_for_interpretation === false || end.eligible_for_interpretation === false
  ) {
    return {
      comparison: ineligible(
        siteCode,
        "circumference_repeatability_warning",
        circumference,
      ),
      mayFallback: true,
    };
  }
  if (!weightTrend) {
    return {
      comparison: ineligible(siteCode, "weight_status_not_eligible", circumference),
      mayFallback: false,
    };
  }
  if (weightTrend.status !== "provisional" && weightTrend.status !== "usable") {
    return {
      comparison: ineligible(siteCode, "weight_status_not_eligible", circumference),
      mayFallback: false,
    };
  }
  if (weightTrend.confidence !== "medium" && weightTrend.confidence !== "high") {
    return {
      comparison: ineligible(siteCode, "weight_confidence_not_eligible", circumference),
      mayFallback: false,
    };
  }
  if (weightTrend.trend_points.length < 2) {
    return {
      comparison: ineligible(siteCode, "insufficient_weight_trend_points", circumference),
      mayFallback: false,
    };
  }

  const startWeight = closestWeightPoint(start.measured_at, weightTrend.trend_points);
  const endWeight = closestWeightPoint(end.measured_at, weightTrend.trend_points);
  if (!startWeight || !endWeight) {
    return {
      comparison: ineligible(siteCode, "no_aligned_weight_endpoint", circumference),
      mayFallback: true,
    };
  }
  if (Date.parse(startWeight.measured_at) >= Date.parse(endWeight.measured_at)) {
    return {
      comparison: ineligible(
        siteCode,
        "aligned_weight_points_not_distinct",
        circumference,
      ),
      mayFallback: true,
    };
  }

  const rawWeightChange = endWeight.trend_weight_kg - startWeight.trend_weight_kg;
  const rawStableBand = Math.max(0.5, startWeight.trend_weight_kg * 0.005);
  const alignedWeight: AlignedWeightComparison = {
    start_point_measured_at: startWeight.measured_at,
    end_point_measured_at: endWeight.measured_at,
    start_kg: startWeight.trend_weight_kg,
    end_kg: endWeight.trend_weight_kg,
    change_kg: round(rawWeightChange, 6),
    stable_band_kg: round(rawStableBand, 6),
    direction: weightDirection(rawWeightChange, rawStableBand),
  };
  const description = descriptionFor(
    siteCode,
    circumference.direction,
    alignedWeight.direction,
  );
  if (!description) {
    return {
      comparison: ineligible(
        siteCode,
        "no_material_cross_signal_template",
        circumference,
        alignedWeight,
      ),
      mayFallback: false,
    };
  }

  return {
    comparison: {
      eligible: true,
      site_code: siteCode,
      circumference,
      weight_trend: alignedWeight,
      description,
    },
    mayFallback: false,
  };
}

export function buildWeightComparison(
  series: readonly AnthropometryProgressSeries[],
  weightTrend: TrendOutput | null,
): AnthropometryWeightComparison {
  const waistSeries = series.find((entry) => entry.site_code === "waist");
  const navelSeries = series.find((entry) => entry.site_code === "abdomen_navel");
  if (!waistSeries && !navelSeries) {
    return ineligible(null, "insufficient_circumference_points");
  }
  if (!waistSeries) {
    return compareCandidate(navelSeries, "abdomen_navel", weightTrend).comparison;
  }
  const waist = compareCandidate(
    waistSeries,
    "waist",
    weightTrend,
  );
  if (waist.comparison.eligible || !waist.mayFallback) return waist.comparison;

  if (!navelSeries || navelSeries.points.length < 2) return waist.comparison;
  return compareCandidate(navelSeries, "abdomen_navel", weightTrend).comparison;
}

export function buildAnthropometryProgress(
  points: readonly AnthropometryProgressInputPoint[],
  weightTrend: TrendOutput | null,
  includeWeightComparison = true,
): AnthropometryProgressResult {
  const series = buildAnthropometrySeries(points);
  return {
    series,
    weight_comparison: includeWeightComparison
      ? buildWeightComparison(series, weightTrend)
      : null,
    algorithm_versions: {
      change: ANTHROPOMETRY_CHANGE_VERSION,
      weight_comparison: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
      weight_trend: WEIGHT_TREND_VERSION,
    },
    limitations: [...ANTHROPOMETRY_PROGRESS_LIMITATIONS],
  };
}
