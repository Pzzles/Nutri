// Frontend mirror of supabase/functions/_shared/weightTrend.ts
// Pure calculation module — no I/O, no API calls.
// Kept in sync with the server-side module; update both when algorithm changes.

import {
  EWMA_ALPHA,
  EWMA_VERSION,
  WEIGHT_TREND_VERSION,
  TREND_REGRESSION_WINDOW_DAYS,
  TREND_MIN_MEASUREMENTS_FOR_RATE,
  TREND_MIN_COVERAGE_DAYS_FOR_RATE,
  CONF_MEDIUM_MIN_MEASUREMENTS,
  CONF_MEDIUM_MIN_COVERAGE_DAYS,
  CONF_MEDIUM_MAX_RECENCY_DAYS,
  CONF_HIGH_MIN_MEASUREMENTS,
  CONF_HIGH_MIN_COVERAGE_DAYS,
  CONF_HIGH_MAX_RECENCY_DAYS,
  CONF_HIGH_MAX_GAP_DAYS,
  CONF_HIGH_MIN_R_SQUARED,
  OUTLIER_RESIDUAL_SIGMA,
  OUTLIER_MAX_SINGLE_DAY_FRACTION,
} from "./scienceConfig";

export interface WeightMeasurement {
  id: string;
  weight_kg: number;
  measured_at: string;
  is_official: boolean;
}

export interface EWMAPoint {
  id: string;
  measured_at: string;
  raw_weight_kg: number;
  trend_weight_kg: number;
  is_outlier: boolean;
}

export type TrendConfidence = "low" | "medium" | "high";
export type TrendWarning =
  | "insufficient_measurements"
  | "insufficient_coverage"
  | "stale_data"
  | "large_gap"
  | "single_measurement";

export interface TrendResult {
  algorithm_version: string;
  ewma_version: string;
  window_start: string | null;
  window_end: string | null;
  measurement_count: number;
  coverage_days: number;
  latest_raw_weight_kg: number | null;
  latest_trend_weight_kg: number | null;
  weekly_rate_kg: number | null;
  r_squared: number | null;
  confidence: TrendConfidence;
  warnings: TrendWarning[];
  trend_points: EWMAPoint[];
  outlier_ids: string[];
}

function elapsedDays(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function applyEWMA(
  measurements: WeightMeasurement[],
  alpha: number = EWMA_ALPHA,
): EWMAPoint[] {
  const sorted = [...measurements]
    .filter((m) => m.is_official)
    .sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at));

  if (sorted.length === 0) return [];

  const points: EWMAPoint[] = [];
  let trend = sorted[0].weight_kg;

  for (const m of sorted) {
    trend = alpha * m.weight_kg + (1 - alpha) * trend;
    points.push({
      id: m.id,
      measured_at: m.measured_at,
      raw_weight_kg: m.weight_kg,
      trend_weight_kg: trend,
      is_outlier: false,
    });
  }

  return points;
}

export function detectOutliers(points: EWMAPoint[]): EWMAPoint[] {
  if (points.length < 2) return points;

  const residuals = points.map((p) => p.raw_weight_kg - p.trend_weight_kg);
  const sd = stddev(residuals);

  return points.map((p, i) => {
    const residual = Math.abs(residuals[i]);
    const isStatistical = sd > 0 && residual > OUTLIER_RESIDUAL_SIGMA * sd;

    let isBiological = false;
    if (i > 0) {
      const prev = points[i - 1].raw_weight_kg;
      const daysDiff = Math.max(
        elapsedDays(points[i - 1].measured_at, p.measured_at),
        1,
      );
      const dailyFraction = Math.abs(p.raw_weight_kg - prev) / prev / daysDiff;
      isBiological = dailyFraction > OUTLIER_MAX_SINGLE_DAY_FRACTION;
    }

    return { ...p, is_outlier: isStatistical || isBiological };
  });
}

interface RegressionResult {
  slope_per_day: number;
  weekly_rate_kg: number;
  r_squared: number;
}

export function linearRegression(
  points: EWMAPoint[],
  windowDays: number = TREND_REGRESSION_WINDOW_DAYS,
): RegressionResult | null {
  if (points.length < 2) return null;

  const windowEnd = points[points.length - 1].measured_at;
  const windowStart = new Date(
    Date.parse(windowEnd) - windowDays * 86_400_000,
  ).toISOString();

  const inWindow = points.filter(
    (p) => !p.is_outlier && Date.parse(p.measured_at) >= Date.parse(windowStart),
  );

  if (inWindow.length < 2) return null;

  const t0 = Date.parse(inWindow[0].measured_at);
  const xs = inWindow.map((p) => (Date.parse(p.measured_at) - t0) / 86_400_000);
  const ys = inWindow.map((p) => p.trend_weight_kg);
  const n = xs.length;

  const sumX  = xs.reduce((s, x) => s + x, 0);
  const sumY  = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => {
    const yhat = intercept + slope * xs[i];
    return s + (y - yhat) ** 2;
  }, 0);
  const r_squared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  return { slope_per_day: slope, weekly_rate_kg: slope * 7, r_squared };
}

interface ConfidenceInputs {
  measurementCount: number;
  coverageDays: number;
  daysSinceLatest: number;
  maxGapDays: number;
  rSquared: number | null;
}

export function assessConfidence(inputs: ConfidenceInputs): TrendConfidence {
  const { measurementCount, coverageDays, daysSinceLatest, maxGapDays, rSquared } = inputs;

  if (
    measurementCount < CONF_MEDIUM_MIN_MEASUREMENTS ||
    coverageDays < CONF_MEDIUM_MIN_COVERAGE_DAYS ||
    daysSinceLatest > CONF_MEDIUM_MAX_RECENCY_DAYS
  ) return "low";

  if (
    measurementCount >= CONF_HIGH_MIN_MEASUREMENTS &&
    coverageDays >= CONF_HIGH_MIN_COVERAGE_DAYS &&
    daysSinceLatest <= CONF_HIGH_MAX_RECENCY_DAYS &&
    maxGapDays <= CONF_HIGH_MAX_GAP_DAYS &&
    (rSquared ?? 0) >= CONF_HIGH_MIN_R_SQUARED
  ) return "high";

  return "medium";
}

export function calculateWeightTrend(
  measurements: WeightMeasurement[],
  nowIso: string = new Date().toISOString(),
): TrendResult {
  const official = measurements.filter((m) => m.is_official);
  const sorted = [...official].sort(
    (a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at),
  );

  const warnings: TrendWarning[] = [];
  const outlier_ids: string[] = [];

  if (sorted.length === 0) {
    return {
      algorithm_version: WEIGHT_TREND_VERSION,
      ewma_version: EWMA_VERSION,
      window_start: null,
      window_end: null,
      measurement_count: 0,
      coverage_days: 0,
      latest_raw_weight_kg: null,
      latest_trend_weight_kg: null,
      weekly_rate_kg: null,
      r_squared: null,
      confidence: "low",
      warnings: ["insufficient_measurements"],
      trend_points: [],
      outlier_ids: [],
    };
  }

  if (sorted.length === 1) {
    warnings.push("single_measurement");
    const m = sorted[0];
    return {
      algorithm_version: WEIGHT_TREND_VERSION,
      ewma_version: EWMA_VERSION,
      window_start: m.measured_at,
      window_end: m.measured_at,
      measurement_count: 1,
      coverage_days: 0,
      latest_raw_weight_kg: m.weight_kg,
      latest_trend_weight_kg: m.weight_kg,
      weekly_rate_kg: null,
      r_squared: null,
      confidence: "low",
      warnings,
      trend_points: [{
        id: m.id,
        measured_at: m.measured_at,
        raw_weight_kg: m.weight_kg,
        trend_weight_kg: m.weight_kg,
        is_outlier: false,
      }],
      outlier_ids: [],
    };
  }

  const ewmaRaw = applyEWMA(sorted);
  const trendPoints = detectOutliers(ewmaRaw);
  trendPoints.filter((p) => p.is_outlier).forEach((p) => outlier_ids.push(p.id));

  const windowStart  = sorted[0].measured_at;
  const windowEnd    = sorted[sorted.length - 1].measured_at;
  const coverageDays = elapsedDays(windowStart, windowEnd);

  let maxGapDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = elapsedDays(sorted[i - 1].measured_at, sorted[i].measured_at);
    if (gap > maxGapDays) maxGapDays = gap;
  }

  const daysSinceLatest = elapsedDays(windowEnd, nowIso);

  let regression: RegressionResult | null = null;
  if (
    sorted.length >= TREND_MIN_MEASUREMENTS_FOR_RATE &&
    coverageDays >= TREND_MIN_COVERAGE_DAYS_FOR_RATE
  ) {
    regression = linearRegression(trendPoints);
  }

  if (sorted.length < TREND_MIN_MEASUREMENTS_FOR_RATE) warnings.push("insufficient_measurements");
  if (coverageDays < TREND_MIN_COVERAGE_DAYS_FOR_RATE) warnings.push("insufficient_coverage");
  if (daysSinceLatest > 14) warnings.push("stale_data");
  if (maxGapDays > 21) warnings.push("large_gap");

  const latest = trendPoints[trendPoints.length - 1];

  const confidence = assessConfidence({
    measurementCount: sorted.length,
    coverageDays,
    daysSinceLatest,
    maxGapDays,
    rSquared: regression?.r_squared ?? null,
  });

  return {
    algorithm_version: WEIGHT_TREND_VERSION,
    ewma_version: EWMA_VERSION,
    window_start: windowStart,
    window_end: windowEnd,
    measurement_count: sorted.length,
    coverage_days: Math.round(coverageDays * 10) / 10,
    latest_raw_weight_kg: latest.raw_weight_kg,
    latest_trend_weight_kg: Math.round(latest.trend_weight_kg * 100) / 100,
    weekly_rate_kg: regression
      ? Math.round(regression.weekly_rate_kg * 1000) / 1000
      : null,
    r_squared: regression
      ? Math.round(regression.r_squared * 1000) / 1000
      : null,
    confidence,
    warnings,
    trend_points: trendPoints,
    outlier_ids,
  };
}
