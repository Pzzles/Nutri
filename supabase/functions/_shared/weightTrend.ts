// Weight Trend Engine — Gate 1C Canonical Implementation
//
// PRIMARY EXPORT: calculate(rawEntries, nowIso, timezone?, displayWindowDays?)
//   Implements weight_time_ewma_v3 + Theil-Sen rate + Sen/Kendall CI.
//   Matches the Python oracle in tools/weight-trend-oracle/oracle.py exactly.
//   See docs/algorithms/phase-6-weight-trend-specification.md (Gate 1C frozen).
//
// LEGACY SECTION (bottom): pre-Gate-2 implementation kept for backward
//   compatibility with get-weight-trend edge function. Do not use in new code.
//   Will be removed in Gate 2 wiring.

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
} from "./scienceConfig.ts";


// ═══════════════════════════════════════════════════════════════════════════════
// NEW v3 ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────

const DAILY_REP_VERSION   = "weight_daily_representative_v1";
const SMOOTHING_VERSION   = "weight_time_ewma_v3";
const RATE_VERSION        = "weight_rate_theil_sen_v1";
const INTERVAL_VERSION    = "weight_rate_interval_sen_v1";
const CONFIDENCE_VERSION  = "weight_trend_confidence_v1";

const HALF_LIFE_DAYS          = 7.0;
const V3_DISPLAY_WINDOW_DAYS  = 28;
const HUBER_FRACTION          = 0.05;
const HUBER_MIN_KG            = 3.0;
const HUBER_MAX_KG            = 6.0;
const SEN_CI_Z                = 1.959963985;
const RATE_WINDOW_CANDIDATES  = [28, 56, 84] as const;
const MIN_MODELLING_DAYS_RATE = 4;
const MIN_MODELLING_DAYS_CI   = 6;
const MIN_COVERAGE_PROVISIONAL = 7;
const MIN_COVERAGE_USABLE      = 14;
const STALE_RECENCY_DAYS       = 14;

// weight_trend_confidence_v1 thresholds
const CFV1_MED_MIN_DAYS      = 6;
const CFV1_MED_MIN_COVERAGE  = 14;
const CFV1_MED_MAX_RECENCY   = 14;
const CFV1_HIGH_MAX_CI_WIDTH = 0.50;
const CFV1_HIGH_MIN_DAYS     = 10;
const CFV1_HIGH_MIN_COVERAGE = 21;
const CFV1_HIGH_MAX_RECENCY  = 7;
const CFV1_HIGH_MAX_GAP      = 7;


// ── Types ─────────────────────────────────────────────────────────────────────

export interface RawEntry {
  id: string;
  measured_at: string;
  weight_kg: number;
  is_official: boolean;
  notes?: string | null;
}

export interface DailyRep {
  local_date: string;
  measured_at: string;
  weight_kg: number;
  source: "official" | "median" | "latest_official_of_multiple";
  warnings: string[];
  source_measurement_ids: string[];
}

export interface WeightEWMAPoint {
  local_date: string;
  measured_at: string;
  raw_weight_kg: number;
  trend_weight_kg: number;
  alpha: number | null;
  delta_t_days: number | null;
  huber_capped: boolean;
}

export type TrendStatus =
  | "insufficient_measurements"
  | "insufficient_coverage"
  | "provisional"
  | "usable"
  | "stale";

export interface WeeklyRateResult {
  estimate_kg: number;
  lower_kg: number | null;
  upper_kg: number | null;
  bootstrap_lower_kg: number | null;
  bootstrap_upper_kg: number | null;
}

export interface TrendOutput {
  status: TrendStatus;
  algorithm_versions: {
    daily_representative: string;
    smoothing: string;
    rate: string;
    interval: string;
    confidence: string;
  };
  timezone: string;
  window: {
    start: string | null;
    end: string | null;
    elapsed_days: number;
    inclusive_calendar_days: number;
  };
  measurements: {
    raw_count: number;
    valid_count: number;
    distinct_modelling_days: number;
    excluded_count: number;
    latest_measured_at: string | null;
    largest_gap_days: number;
    selected_rate_window_days: number | null;
  };
  latest_raw_weight_kg: number | null;
  latest_trend_weight_kg: number | null;
  weekly_rate: WeeklyRateResult | null;
  confidence: "low" | "medium" | "high";
  warnings: string[];
  daily_representatives: DailyRep[];
  trend_points: WeightEWMAPoint[];
  flagged_measurements: string[];
  ols_diagnostic: {
    slope_per_day: number;
    weekly_rate_kg: number;
    r_squared: number;
  } | null;
}


// ── Internal helpers ──────────────────────────────────────────────────────────

function round6(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}

function round8(x: number): number {
  return Math.round(x * 100_000_000) / 100_000_000;
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

// Convert an ISO-8601 timestamp to a YYYY-MM-DD string in the given IANA timezone.
function toLocalDate(isoStr: string, timezone: string): string {
  const date = new Date(isoStr);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year  = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day   = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

// Step 1: validity filter
function filterValid(entries: RawEntry[]): { valid: RawEntry[]; excludedIds: string[] } {
  const valid: RawEntry[] = [];
  const excludedIds: string[] = [];
  for (const e of entries) {
    if (isFinite(e.weight_kg) && e.weight_kg > 0) {
      valid.push(e);
    } else {
      excludedIds.push(e.id);
    }
  }
  return { valid, excludedIds };
}

// Step 2: group by SAST calendar date; select one daily representative per day.
function buildDailyReps(
  entries: RawEntry[],
  timezone: string,
): { reps: DailyRep[]; warnings: string[] } {
  const byDate = new Map<string, RawEntry[]>();
  for (const e of entries) {
    const d = toLocalDate(e.measured_at, timezone);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(e);
  }

  const reps: DailyRep[] = [];
  const allWarnings: string[] = [];

  for (const date of [...byDate.keys()].sort()) {
    const dayEntries = [...byDate.get(date)!].sort((a, b) =>
      a.measured_at < b.measured_at ? -1 : a.measured_at > b.measured_at ? 1 : 0,
    );
    const officials = dayEntries.filter((e) => e.is_official);
    const dayWarnings: string[] = [];

    let repTs: string;
    let src: DailyRep["source"];
    let w: number;
    let srcIds: string[];

    if (officials.length === 0) {
      // Case C: no officials — median weight, lower-middle timestamp
      const sortedWeights = [...dayEntries].map((e) => e.weight_kg).sort((a, b) => a - b);
      const nw = sortedWeights.length;
      w = nw % 2 === 1
        ? sortedWeights[Math.floor(nw / 2)]
        : (sortedWeights[nw / 2 - 1] + sortedWeights[nw / 2]) / 2;

      const ne = dayEntries.length;
      const medEntry = ne % 2 === 1 ? dayEntries[Math.floor(ne / 2)] : dayEntries[ne / 2 - 1];
      repTs  = medEntry.measured_at;
      src    = "median";
      srcIds = dayEntries.map((e) => e.id);

    } else if (officials.length === 1) {
      // Cases A / B: exactly one official
      repTs  = officials[0].measured_at;
      src    = "official";
      w      = officials[0].weight_kg;
      srcIds = [officials[0].id];

    } else {
      // Case D: multiple officials — latest wins, emit warning
      dayWarnings.push("multiple_official_entries");
      allWarnings.push(`${date}: multiple_official_entries`);
      const latest = officials.reduce((best, e) =>
        e.measured_at > best.measured_at ? e : best,
      );
      repTs  = latest.measured_at;
      src    = "latest_official_of_multiple";
      w      = latest.weight_kg;
      srcIds = [latest.id];
    }

    reps.push({ local_date: date, measured_at: repTs, weight_kg: w, source: src, warnings: dayWarnings, source_measurement_ids: srcIds });
  }

  return { reps, warnings: allWarnings };
}

// Step 3: select adaptive rate window (28 → 56 → 84 days, smallest with ≥ 6 modelling days).
function selectRateWindow(
  allReps: DailyRep[],
  nowIso: string,
): { windowDays: number | null; reps: DailyRep[] } {
  const nowMs = new Date(nowIso).getTime();
  for (const candidate of RATE_WINDOW_CANDIDATES) {
    const cutoffMs = nowMs - candidate * 86_400_000;
    const inWindow = allReps.filter((r) => new Date(r.measured_at).getTime() >= cutoffMs);
    if (inWindow.length >= MIN_MODELLING_DAYS_CI) {
      return { windowDays: candidate, reps: inWindow };
    }
  }
  return { windowDays: null, reps: [] };
}

// Step 4: full-history time-aware EWMA with bounded Huber-capped innovations (v3).
function computeEWMA(reps: DailyRep[]): WeightEWMAPoint[] {
  if (reps.length === 0) return [];

  const sorted = [...reps].sort((a, b) =>
    a.measured_at < b.measured_at ? -1 : a.measured_at > b.measured_at ? 1 : 0,
  );

  const points: WeightEWMAPoint[] = [];
  let trend = sorted[0].weight_kg;

  points.push({
    local_date:      sorted[0].local_date,
    measured_at:     sorted[0].measured_at,
    raw_weight_kg:   sorted[0].weight_kg,
    trend_weight_kg: trend,
    alpha:           null,
    delta_t_days:    null,
    huber_capped:    false,
  });

  for (let i = 1; i < sorted.length; i++) {
    const prevMs  = new Date(sorted[i - 1].measured_at).getTime();
    const currMs  = new Date(sorted[i].measured_at).getTime();
    const deltaT  = (currMs - prevMs) / 86_400_000;
    const alpha   = 1 - Math.pow(2, -deltaT / HALF_LIFE_DAYS);

    const innovation = sorted[i].weight_kg - trend;
    const cap        = Math.min(Math.max(trend * HUBER_FRACTION, HUBER_MIN_KG), HUBER_MAX_KG);
    const capped     = Math.abs(innovation) > cap;
    const effInno    = capped ? Math.sign(innovation) * cap : innovation;

    trend = trend + alpha * effInno;

    points.push({
      local_date:      sorted[i].local_date,
      measured_at:     sorted[i].measured_at,
      raw_weight_kg:   sorted[i].weight_kg,
      trend_weight_kg: trend,
      alpha,
      delta_t_days:    deltaT,
      huber_capped:    capped,
    });
  }

  return points;
}

// Compute all pairwise slopes for Theil-Sen and Sen/Kendall.
function pairSlopes(pairs: [number, number][]): number[] {
  const slopes: number[] = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const dx = pairs[j][0] - pairs[i][0];
      const dy = pairs[j][1] - pairs[i][1];
      if (dx > 0) slopes.push(dy / dx);
    }
  }
  return slopes;
}

// Step 5: Theil-Sen median-of-slopes estimator.
function theilSen(pairs: [number, number][]): number | null {
  if (pairs.length < 2) return null;
  const slopes = pairSlopes(pairs);
  if (slopes.length === 0) return null;
  slopes.sort((a, b) => a - b);
  const n = slopes.length;
  return n % 2 === 1
    ? slopes[Math.floor(n / 2)]
    : (slopes[n / 2 - 1] + slopes[n / 2]) / 2;
}

// OLS for diagnostic comparison only (not the authoritative estimator).
function olsDiag(
  pairs: [number, number][],
): { slope_per_day: number; weekly_rate_kg: number; r_squared: number } | null {
  const n = pairs.length;
  if (n < 2) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const sx  = xs.reduce((s, x) => s + x, 0);
  const sy  = ys.reduce((s, y) => s + y, 0);
  const sxy = pairs.reduce((s, [x, y]) => s + x * y, 0);
  const sx2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sx2 - sx * sx;
  if (denom === 0) return null;
  const slope     = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const meanY     = sy / n;
  const ssTot     = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const ssRes     = pairs.reduce((s, [x, y]) => s + (y - (intercept + slope * x)) ** 2, 0);
  const r2        = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return { slope_per_day: slope, weekly_rate_kg: slope * 7, r_squared: r2 };
}

// Step 6: Sen/Kendall deterministic 95% CI (weight_rate_interval_sen_v1).
function senKendallCI(pairs: [number, number][]): [number, number] | null {
  const n = pairs.length;
  if (n < MIN_MODELLING_DAYS_CI) return null;

  const slopes = pairSlopes(pairs);
  if (slopes.length === 0) return null;

  slopes.sort((a, b) => a - b);
  const N       = slopes.length;
  const cAlpha  = SEN_CI_Z * Math.sqrt(n * (n - 1) * (2 * n + 5) / 18);
  const loIdx   = Math.floor((N - cAlpha) / 2);
  const hiIdx   = Math.ceil((N + cAlpha) / 2);

  if (loIdx < 0 || hiIdx >= N) return null;
  return [slopes[loIdx], slopes[hiIdx]];
}

// Max gap between consecutive representatives (in fractional days).
function calcMaxGap(reps: DailyRep[]): number {
  let max = 0;
  for (let i = 1; i < reps.length; i++) {
    const gap = (new Date(reps[i].measured_at).getTime() - new Date(reps[i - 1].measured_at).getTime()) / 86_400_000;
    if (gap > max) max = gap;
  }
  return max;
}

// Status (weight_trend_confidence_v1 §8).
function determineStatus(
  distinct: number,
  coverage: number,
  recency: number,
): TrendStatus {
  if (distinct < MIN_MODELLING_DAYS_RATE) return "insufficient_measurements";
  if (coverage < MIN_COVERAGE_PROVISIONAL)  return "insufficient_coverage";
  if (recency > STALE_RECENCY_DAYS)         return "stale";
  if (coverage < MIN_COVERAGE_USABLE)       return "provisional";
  return "usable";
}

// Confidence (weight_trend_confidence_v1 §9).
function computeConfidence(
  distinct: number,
  coverage: number,
  recency: number,
  maxGap: number,
  ciWidthWeekly: number | null,
): "low" | "medium" | "high" {
  if (distinct < CFV1_MED_MIN_DAYS || coverage < CFV1_MED_MIN_COVERAGE || recency > CFV1_MED_MAX_RECENCY) return "low";
  if (ciWidthWeekly !== null && ciWidthWeekly > 1.0)              return "low";
  if (ciWidthWeekly !== null && ciWidthWeekly > CFV1_HIGH_MAX_CI_WIDTH) return "medium";
  if (
    distinct >= CFV1_HIGH_MIN_DAYS &&
    coverage >= CFV1_HIGH_MIN_COVERAGE &&
    recency <= CFV1_HIGH_MAX_RECENCY &&
    maxGap  <= CFV1_HIGH_MAX_GAP
  ) return "high";
  return "medium";
}

function versions() {
  return {
    daily_representative: DAILY_REP_VERSION,
    smoothing:            SMOOTHING_VERSION,
    rate:                 RATE_VERSION,
    interval:             INTERVAL_VERSION,
    confidence:           CONFIDENCE_VERSION,
  };
}

function emptyTrendOutput(
  rawEntries: RawEntry[],
  valid: RawEntry[],
  excludedIds: string[],
  timezone: string,
): TrendOutput {
  return {
    status:              "insufficient_measurements",
    algorithm_versions:  versions(),
    timezone,
    window:              { start: null, end: null, elapsed_days: 0, inclusive_calendar_days: 0 },
    measurements: {
      raw_count:                rawEntries.length,
      valid_count:              valid.length,
      distinct_modelling_days:  0,
      excluded_count:           excludedIds.length,
      latest_measured_at:       null,
      largest_gap_days:         0,
      selected_rate_window_days: null,
    },
    latest_raw_weight_kg:   null,
    latest_trend_weight_kg: null,
    weekly_rate:            null,
    confidence:             "low",
    warnings:               ["insufficient_measurements"],
    daily_representatives:  [],
    trend_points:           [],
    flagged_measurements:   excludedIds,
    ols_diagnostic:         null,
  };
}


// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Full weight-trend pipeline (weight_time_ewma_v3).
 *
 * Data flow:
 *   rawEntries → filterValid → buildDailyReps (all history)
 *   all reps   → computeEWMA (full history, Huber-capped)
 *   all reps   → selectRateWindow (28/56/84 days)
 *   rate reps  → theilSen + senKendallCI + olsDiag
 *   all ewma   → display window filter → trend_points output
 */
export function calculate(
  rawEntries: RawEntry[],
  nowIso: string,
  timezone = "Africa/Johannesburg",
  displayWindowDays = V3_DISPLAY_WINDOW_DAYS,
): TrendOutput {
  const nowMs = new Date(nowIso).getTime();

  // 1. Validity filter
  const { valid, excludedIds } = filterValid(rawEntries);

  // 2. Daily representatives (full history)
  const { reps: allReps, warnings: repWarnings } = buildDailyReps(valid, timezone);

  if (allReps.length === 0) {
    return emptyTrendOutput(rawEntries, valid, excludedIds, timezone);
  }

  // 3. Full-history EWMA
  const allEwma = computeEWMA(allReps);

  // 4. Adaptive rate window
  const { windowDays: rateWindowDays, reps: rateReps } = selectRateWindow(allReps, nowIso);

  // 5. Rate, CI, OLS from rate window
  let tsSlope: number | null = null;
  let ols: ReturnType<typeof olsDiag> = null;
  let sCi: [number, number] | null = null;

  if (rateReps.length > 0) {
    const anchorMs = new Date(rateReps[0].measured_at).getTime();
    const pairs: [number, number][] = rateReps.map((r) => [
      (new Date(r.measured_at).getTime() - anchorMs) / 86_400_000,
      r.weight_kg,
    ]);
    tsSlope = theilSen(pairs);
    ols     = olsDiag(pairs);
    sCi     = senKendallCI(pairs);
  }

  // 6. Display window filter on EWMA points
  const displayCutoffMs = nowMs - displayWindowDays * 86_400_000;
  const displayEwma = allEwma.filter(
    (p) => new Date(p.measured_at).getTime() >= displayCutoffMs,
  );

  // 7. Window metadata (spans display window)
  let winStart: string | null = null;
  let winEnd:   string | null = null;
  let elapsedDays        = 0;
  let inclusiveCalDays   = 0;

  if (displayEwma.length > 0) {
    winStart = displayEwma[0].measured_at;
    winEnd   = displayEwma[displayEwma.length - 1].measured_at;
    const firstMs = new Date(winStart).getTime();
    const lastMs  = new Date(winEnd).getTime();
    elapsedDays = (lastMs - firstMs) / 86_400_000;

    const firstLocal    = toLocalDate(winStart, timezone);
    const lastLocal     = toLocalDate(winEnd, timezone);
    const firstLocalMs  = Date.parse(firstLocal);
    const lastLocalMs   = Date.parse(lastLocal);
    inclusiveCalDays    = Math.round((lastLocalMs - firstLocalMs) / 86_400_000) + 1;
  }

  // 8. Measurements metadata — gap and recency from rate window (or all reps)
  const metaReps = rateReps.length > 0 ? rateReps : allReps;
  const maxGap   = calcMaxGap(metaReps);

  const lastRepMs = new Date(allReps[allReps.length - 1].measured_at).getTime();
  const recency   = (nowMs - lastRepMs) / 86_400_000;
  const distinct  = rateReps.length;

  let rateElapsed = 0;
  if (rateReps.length > 0) {
    const rfMs = new Date(rateReps[0].measured_at).getTime();
    const rlMs = new Date(rateReps[rateReps.length - 1].measured_at).getTime();
    rateElapsed = (rlMs - rfMs) / 86_400_000;
  }

  // 9. Status and confidence
  const ciWidthWeekly = sCi ? (sCi[1] - sCi[0]) * 7 : null;
  const status        = determineStatus(distinct, rateElapsed, recency);
  const confidence    = computeConfidence(distinct, rateElapsed, recency, maxGap, ciWidthWeekly);

  // 10. Latest values
  const latestRaw   = allReps[allReps.length - 1].weight_kg;
  const latestTrend = allEwma[allEwma.length - 1].trend_weight_kg;

  // 11. Warnings (deduplicated, then sorted)
  const warnings: string[] = dedup(repWarnings);
  if (status === "insufficient_measurements" || status === "insufficient_coverage") {
    warnings.push(status);
  }
  if (recency > STALE_RECENCY_DAYS) warnings.push("stale_data");
  if (maxGap > 21)                  warnings.push("large_gap");
  warnings.sort();

  return {
    status,
    algorithm_versions: versions(),
    timezone,
    window: {
      start:                   winStart,
      end:                     winEnd,
      elapsed_days:            round6(elapsedDays),
      inclusive_calendar_days: inclusiveCalDays,
    },
    measurements: {
      raw_count:                rawEntries.length,
      valid_count:              valid.length,
      distinct_modelling_days:  distinct,
      excluded_count:           excludedIds.length,
      latest_measured_at:       allReps[allReps.length - 1].measured_at,
      largest_gap_days:         round6(maxGap),
      selected_rate_window_days: rateWindowDays,
    },
    latest_raw_weight_kg:   latestRaw,
    latest_trend_weight_kg: round6(latestTrend),
    weekly_rate: tsSlope !== null ? {
      estimate_kg:        round6(tsSlope * 7),
      lower_kg:           sCi ? round6(sCi[0] * 7) : null,
      upper_kg:           sCi ? round6(sCi[1] * 7) : null,
      bootstrap_lower_kg: null,
      bootstrap_upper_kg: null,
    } : null,
    confidence,
    warnings,
    daily_representatives: allReps,
    trend_points: displayEwma.map((p) => ({
      ...p,
      trend_weight_kg: round8(p.trend_weight_kg),
      alpha:           p.alpha !== null ? round8(p.alpha) : null,
      delta_t_days:    p.delta_t_days !== null ? round6(p.delta_t_days) : null,
    })),
    flagged_measurements: excludedIds,
    ols_diagnostic: ols ? {
      slope_per_day:  round8(ols.slope_per_day),
      weekly_rate_kg: round8(ols.weekly_rate_kg),
      r_squared:      round6(ols.r_squared),
    } : null,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY — pre-Gate-2 implementation  @deprecated
//
// These exports are retained ONLY so that:
//   • web/src/__tests__/WeightTrend.test.ts continues to pass unchanged
//   • web/src/lib/weightTypes.ts (EWMAPoint, TrendConfidence, TrendWarning types)
//     compiles without modification until Prompt 4 wires the frontend.
//
// The get-weight-trend Edge Function no longer calls calculateWeightTrend().
// No production API path reaches this code.
// All functions below will be removed in Gate 2 frontend wiring (Prompt 4).
// ═══════════════════════════════════════════════════════════════════════════════

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

function legacyElapsedDays(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
}

function legacyStddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** @deprecated Use calculate() instead. Will be removed in Prompt 4. */
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
    points.push({ id: m.id, measured_at: m.measured_at, raw_weight_kg: m.weight_kg, trend_weight_kg: trend, is_outlier: false });
  }

  return points;
}

/** @deprecated Will be removed in Prompt 4. */
export function detectOutliers(points: EWMAPoint[]): EWMAPoint[] {
  if (points.length < 2) return points;

  const residuals = points.map((p) => p.raw_weight_kg - p.trend_weight_kg);
  const sd = legacyStddev(residuals);

  return points.map((p, i) => {
    const residual       = Math.abs(residuals[i]);
    const isStatistical  = sd > 0 && residual > OUTLIER_RESIDUAL_SIGMA * sd;

    let isBiological = false;
    if (i > 0) {
      const prev       = points[i - 1].raw_weight_kg;
      const daysDiff   = Math.max(legacyElapsedDays(points[i - 1].measured_at, p.measured_at), 1);
      const dailyFrac  = Math.abs(p.raw_weight_kg - prev) / prev / daysDiff;
      isBiological     = dailyFrac > OUTLIER_MAX_SINGLE_DAY_FRACTION;
    }

    return { ...p, is_outlier: isStatistical || isBiological };
  });
}

interface LegacyRegressionResult {
  slope_per_day: number;
  weekly_rate_kg: number;
  r_squared: number;
}

/** @deprecated Will be removed in Prompt 4. */
export function linearRegression(
  points: EWMAPoint[],
  windowDays: number = TREND_REGRESSION_WINDOW_DAYS,
): LegacyRegressionResult | null {
  if (points.length < 2) return null;

  const windowEnd   = points[points.length - 1].measured_at;
  const windowStart = new Date(Date.parse(windowEnd) - windowDays * 86_400_000).toISOString();

  const inWindow = points.filter(
    (p) => !p.is_outlier && Date.parse(p.measured_at) >= Date.parse(windowStart),
  );
  if (inWindow.length < 2) return null;

  const t0   = Date.parse(inWindow[0].measured_at);
  const xs   = inWindow.map((p) => (Date.parse(p.measured_at) - t0) / 86_400_000);
  const ys   = inWindow.map((p) => p.trend_weight_kg);
  const n    = xs.length;
  const sumX  = xs.reduce((s, x) => s + x, 0);
  const sumY  = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY     = sumY / n;
  const ssTot     = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const ssRes     = ys.reduce((s, y, i) => s + (y - (intercept + slope * xs[i])) ** 2, 0);
  const r_squared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  return { slope_per_day: slope, weekly_rate_kg: slope * 7, r_squared };
}

interface LegacyConfidenceInputs {
  measurementCount: number;
  coverageDays: number;
  daysSinceLatest: number;
  maxGapDays: number;
  rSquared: number | null;
}

/** @deprecated Will be removed in Prompt 4. */
export function assessConfidence(inputs: LegacyConfidenceInputs): TrendConfidence {
  const { measurementCount, coverageDays, daysSinceLatest, maxGapDays, rSquared } = inputs;

  if (
    measurementCount < CONF_MEDIUM_MIN_MEASUREMENTS ||
    coverageDays     < CONF_MEDIUM_MIN_COVERAGE_DAYS ||
    daysSinceLatest  > CONF_MEDIUM_MAX_RECENCY_DAYS
  ) return "low";

  if (
    measurementCount >= CONF_HIGH_MIN_MEASUREMENTS &&
    coverageDays     >= CONF_HIGH_MIN_COVERAGE_DAYS &&
    daysSinceLatest  <= CONF_HIGH_MAX_RECENCY_DAYS &&
    maxGapDays       <= CONF_HIGH_MAX_GAP_DAYS &&
    (rSquared ?? 0)  >= CONF_HIGH_MIN_R_SQUARED
  ) return "high";

  return "medium";
}

/**
 * @deprecated Not reachable through any production API path.
 * The get-weight-trend Edge Function now calls calculate() directly.
 * Retained only for WeightTrend.test.ts. Will be removed in Prompt 4.
 */
export function calculateWeightTrend(
  measurements: WeightMeasurement[],
  nowIso: string = new Date().toISOString(),
): TrendResult {
  const official = measurements.filter((m) => m.is_official);
  const sorted   = [...official].sort(
    (a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at),
  );

  const warnings: TrendWarning[] = [];
  const outlier_ids: string[]    = [];

  if (sorted.length === 0) {
    return {
      algorithm_version:      WEIGHT_TREND_VERSION,
      ewma_version:           EWMA_VERSION,
      window_start:           null,
      window_end:             null,
      measurement_count:      0,
      coverage_days:          0,
      latest_raw_weight_kg:   null,
      latest_trend_weight_kg: null,
      weekly_rate_kg:         null,
      r_squared:              null,
      confidence:             "low",
      warnings:               ["insufficient_measurements"],
      trend_points:           [],
      outlier_ids:            [],
    };
  }

  if (sorted.length === 1) {
    warnings.push("single_measurement");
    const m = sorted[0];
    return {
      algorithm_version:      WEIGHT_TREND_VERSION,
      ewma_version:           EWMA_VERSION,
      window_start:           m.measured_at,
      window_end:             m.measured_at,
      measurement_count:      1,
      coverage_days:          0,
      latest_raw_weight_kg:   m.weight_kg,
      latest_trend_weight_kg: m.weight_kg,
      weekly_rate_kg:         null,
      r_squared:              null,
      confidence:             "low",
      warnings,
      trend_points:           [{ id: m.id, measured_at: m.measured_at, raw_weight_kg: m.weight_kg, trend_weight_kg: m.weight_kg, is_outlier: false }],
      outlier_ids:            [],
    };
  }

  const ewmaRaw    = applyEWMA(sorted);
  const trendPoints = detectOutliers(ewmaRaw);
  trendPoints.filter((p) => p.is_outlier).forEach((p) => outlier_ids.push(p.id));

  const windowStart  = sorted[0].measured_at;
  const windowEnd    = sorted[sorted.length - 1].measured_at;
  const coverageDays = legacyElapsedDays(windowStart, windowEnd);

  let maxGapDaysVal = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = legacyElapsedDays(sorted[i - 1].measured_at, sorted[i].measured_at);
    if (gap > maxGapDaysVal) maxGapDaysVal = gap;
  }

  const daysSinceLatest = legacyElapsedDays(windowEnd, nowIso);

  let regression: LegacyRegressionResult | null = null;
  if (
    sorted.length >= TREND_MIN_MEASUREMENTS_FOR_RATE &&
    coverageDays   >= TREND_MIN_COVERAGE_DAYS_FOR_RATE
  ) {
    regression = linearRegression(trendPoints);
  }

  if (sorted.length  < TREND_MIN_MEASUREMENTS_FOR_RATE) warnings.push("insufficient_measurements");
  if (coverageDays   < TREND_MIN_COVERAGE_DAYS_FOR_RATE) warnings.push("insufficient_coverage");
  if (daysSinceLatest > 14)  warnings.push("stale_data");
  if (maxGapDaysVal   > 21)  warnings.push("large_gap");

  const latest     = trendPoints[trendPoints.length - 1];
  const confidence = assessConfidence({
    measurementCount: sorted.length,
    coverageDays,
    daysSinceLatest,
    maxGapDays: maxGapDaysVal,
    rSquared: regression?.r_squared ?? null,
  });

  return {
    algorithm_version:      WEIGHT_TREND_VERSION,
    ewma_version:           EWMA_VERSION,
    window_start:           windowStart,
    window_end:             windowEnd,
    measurement_count:      sorted.length,
    coverage_days:          Math.round(coverageDays * 10) / 10,
    latest_raw_weight_kg:   latest.raw_weight_kg,
    latest_trend_weight_kg: Math.round(latest.trend_weight_kg * 100) / 100,
    weekly_rate_kg:         regression ? Math.round(regression.weekly_rate_kg * 1000) / 1000 : null,
    r_squared:              regression ? Math.round(regression.r_squared * 1000) / 1000 : null,
    confidence,
    warnings,
    trend_points:           trendPoints,
    outlier_ids,
  };
}
