import { describe, expect, it } from "vitest";
import {
  ANTHROPOMETRY_CHANGE_VERSION,
  ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
  ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
  ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
  buildAnthropometryProgress,
  buildAnthropometrySeries,
  buildWeightComparison,
  weightDirectionFromInterval,
  type AnthropometryProgressInputPoint,
} from "../../functions/_shared/anthropometryProgress.ts";
import {
  anthropometryProtocolsCompatible,
  compareMeasurementContexts,
  normalizeMeasurementContext,
  type AnthropometryMeasurementContext,
} from "../../functions/_shared/anthropometryContext.ts";
import type { TrendOutput } from "../../functions/_shared/weightTrend.ts";

const BASE_CONTEXT: AnthropometryMeasurementContext = {
  version: "anthropometry_measurement_context_v1",
  local_time: "07:30:00",
  meal_timing: "before_food",
  after_bathroom: true,
  exercise_within_previous_12_hours: false,
  measurement_assistance: "self",
  clothing_level: "minimal",
};

function point(
  id: string,
  date: string,
  value: number,
  overrides: Partial<AnthropometryProgressInputPoint> = {},
): AnthropometryProgressInputPoint {
  return {
    session_id: id,
    site_code: "waist",
    measured_at: `${date}T06:00:00Z`,
    logged_date: date,
    protocol_version: "anthropometry_protocol_v1",
    representative_cm: value,
    quality: "pair_agree",
    eligible_for_interpretation: true,
    algorithm_version: "anthropometry_representative_v3",
    measurement_context: BASE_CONTEXT,
    ...overrides,
  };
}

function trend(
  asOf: string,
  rate = -0.3,
  lower: number | null = -0.5,
  upper: number | null = -0.1,
  overrides: Partial<TrendOutput> = {},
): TrendOutput {
  return {
    status: "usable",
    confidence: "high",
    algorithm_versions: {
      daily_representative: "weight_daily_representative_v1",
      smoothing: "weight_time_ewma_v3",
      rate: "weight_rate_theil_sen_v1",
      interval: "weight_rate_interval_sen_v1",
      confidence: "weight_trend_confidence_v1",
    },
    timezone: "Africa/Johannesburg",
    window: { start: "2026-06-01T06:00:00Z", end: asOf, elapsed_days: 61, inclusive_calendar_days: 62 },
    measurements: {
      raw_count: 20, valid_count: 20, distinct_modelling_days: 20,
      excluded_count: 0, latest_measured_at: asOf, largest_gap_days: 4,
      selected_rate_window_days: 56,
    },
    latest_raw_weight_kg: 79,
    latest_trend_weight_kg: 79.1,
    weekly_rate: { estimate_kg: rate, lower_kg: lower, upper_kg: upper, bootstrap_lower_kg: null, bootstrap_upper_kg: null },
    warnings: [], daily_representatives: [], trend_points: [], flagged_measurements: [], ols_diagnostic: null,
    ...overrides,
  };
}

describe("anthropometry_change_summary_v2", () => {
  it("keeps sparse points and derives previous/baseline without interpolation", () => {
    const series = buildAnthropometrySeries([
      point("three", "2026-08-01", 88.4),
      point("one", "2026-06-01", 90),
      point("two", "2026-06-20", 89.2),
    ])[0];
    expect(series.points.map((entry) => entry.session_id)).toEqual(["one", "two", "three"]);
    expect(series.change_summary?.previous).toMatchObject({ change_cm: -0.8, elapsed_days: 42 });
    expect(series.change_summary?.baseline).toMatchObject({ change_cm: -1.6, elapsed_days: 61 });
  });

  it("uses the unrounded 0.5 cm boundary", () => {
    expect(buildAnthropometrySeries([point("a", "2026-06-01", 90), point("b", "2026-07-01", 89.5)])[0]
      .change_summary?.baseline?.direction).toBe("decreasing");
    expect(buildAnthropometrySeries([point("a", "2026-06-01", 90), point("b", "2026-07-01", 89.51)])[0]
      .change_summary?.baseline?.direction).toBe("broadly_stable");
  });

  it("keeps incompatible protocol rows visible but excludes comparisons", () => {
    const series = buildAnthropometrySeries([
      point("legacy", "2026-06-01", 90, { protocol_version: "anthropometry_protocol_future_v2" }),
      point("current", "2026-08-01", 88),
    ])[0];
    expect(series.points).toHaveLength(2);
    expect(series.change_summary?.baseline).toBeNull();
    expect(series.warning_codes).toContain("protocol_versions_not_comparable");
    expect(anthropometryProtocolsCompatible("anthropometry_protocol_v1", "anthropometry_protocol_future_v2")).toBe(false);
  });

  it("allows representative v2 and v3 rows under the same compatible protocol", () => {
    const series = buildAnthropometrySeries([
      point("v2", "2026-06-01", 90, { algorithm_version: "anthropometry_representative_v2" }),
      point("v3", "2026-08-01", 88, { algorithm_version: "anthropometry_representative_v3" }),
    ])[0];
    expect(series.change_summary?.baseline?.change_cm).toBe(-2);
  });
});

describe("measurement context v1", () => {
  it("defaults omitted optional fields without fabricating booleans", () => {
    expect(normalizeMeasurementContext(undefined)).toEqual({
      meal_timing: "not_recorded", after_bathroom: null,
      exercise_within_previous_12_hours: null,
      measurement_assistance: "not_recorded", clothing_level: "not_recorded",
    });
  });

  it("rejects wrong types, unknown enums and extra trusted fields", () => {
    expect(() => normalizeMeasurementContext({ after_bathroom: "yes" })).toThrow(/true, false or null/);
    expect(() => normalizeMeasurementContext({ meal_timing: "fasted" })).toThrow(/unsupported/);
    expect(() => normalizeMeasurementContext({ local_time: "07:00:00" })).toThrow(/not accepted/);
  });

  it("warns for material differences without changing values", () => {
    const warnings = compareMeasurementContexts(BASE_CONTEXT, {
      ...BASE_CONTEXT, local_time: "13:00:01", meal_timing: "after_food",
      after_bathroom: false, exercise_within_previous_12_hours: true,
      measurement_assistance: "assisted", clothing_level: "normal",
    });
    expect(warnings).toEqual([
      "local_time_difference_over_four_hours", "meal_timing_differs",
      "bathroom_state_differs", "recent_exercise_differs",
      "measurement_assistance_differs", "clothing_level_differs",
    ]);
  });
});

describe("anthropometry_weight_comparison_v2", () => {
  const start = point("start", "2026-06-01", 90);
  const end = point("end", "2026-08-01", 87);
  const asOf = end.measured_at;

  it("derives direction only from the canonical weekly-rate interval", () => {
    expect(weightDirectionFromInterval(trend(asOf, -0.3, -0.5, -0.1))).toBe("decreasing");
    expect(weightDirectionFromInterval(trend(asOf, 0.3, 0.1, 0.5))).toBe("increasing");
    expect(weightDirectionFromInterval(trend(asOf, 0.01, -0.2, 0.3))).toBe("broadly_stable_or_uncertain");
    expect(weightDirectionFromInterval(trend(asOf, 0.1, null, null))).toBe("unavailable");
  });

  it("returns complete evidence and a descriptive message when eligible", () => {
    const comparison = buildWeightComparison(buildAnthropometrySeries([start, end]), trend(asOf), asOf);
    expect(comparison).toMatchObject({
      eligible: true, site_code: "waist", reason_codes: [],
      algorithm_version: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
      circumference: { change_cm: -3, elapsed_calendar_days: 61, direction: "decreasing" },
      weight_trend: { weekly_rate_kg: -0.3, lower_kg: -0.5, upper_kg: -0.1, direction: "decreasing", as_of: asOf },
    });
    expect(comparison.description).toMatch(/weight trend decreased.*waist circumference decreased/i);
  });

  it("enforces interval, confidence, staleness and seven-day alignment gates", () => {
    const short = point("short", "2026-06-14", 89);
    expect(buildWeightComparison(buildAnthropometrySeries([start, short]), trend(short.measured_at), short.measured_at).reason_codes)
      .toEqual(["circumference_interval_too_short"]);
    expect(buildWeightComparison(buildAnthropometrySeries([start, end]), trend(asOf, -0.2, null, null), asOf).reason_codes)
      .toEqual(["weight_rate_interval_unavailable"]);
    expect(buildWeightComparison(buildAnthropometrySeries([start, end]), trend(asOf, -0.2, -0.4, -0.1, { confidence: "low" }), asOf).reason_codes)
      .toEqual(["weight_confidence_not_eligible"]);
    const distant = trend(asOf, -0.2, -0.4, -0.1);
    distant.measurements.latest_measured_at = "2026-07-20T06:00:00Z";
    expect(buildWeightComparison(buildAnthropometrySeries([start, end]), distant, asOf).reason_codes)
      .toEqual(["weight_not_aligned_with_anthropometry"]);
  });

  it("returns all Gate 3 provenance versions and non-interference wording", () => {
    const result = buildAnthropometryProgress([], null);
    expect(result.algorithm_versions).toEqual({
      change_summary: ANTHROPOMETRY_CHANGE_VERSION,
      context_comparison: ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
      protocol_compatibility: ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
      weight_comparison: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
      weight_trend: "weight_trend_v1",
    });
    expect(result.limitations.join(" ")).toMatch(/does not alter calorie targets or goal feedback/i);
  });
});
