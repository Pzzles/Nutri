/**
 * goalProgressAssessment.ts
 *
 * Pure, independently-testable Phase 8 calculation module.
 *
 * algorithm:  goal_progress_assessment_v1
 * thresholds: goal_progress_thresholds_v1
 *
 * Determines the user's current goal progress state from Phase 6 (weight trend)
 * and Phase 7 (adaptive maintenance) evidence, and derives a cautious feedback
 * action and optional advisory calorie adjustment.
 *
 * State priority (evaluated top-to-bottom):
 *   1. no_active_goal_phase  — goalMode is null
 *   2. stale_data            — P6 status is "stale"
 *   3. insufficient_data     — P6 insufficient, no rate, or no target
 *   4. maintenance_stable    — maintenance mode, rate near zero
 *   5. maintenance_drift     — maintenance mode, rate outside band
 *   6. likely_plateau        — cut, rate near zero, persistent across 14 days
 *   7. plateau_candidate     — cut, rate near zero, single assessment
 *   8. opposite_direction    — rate sign is opposite to target sign (outside band)
 *   9. on_track              — rate within ±band of target magnitude
 *  10. slower_than_planned   — rate magnitude below target by > band
 *  11. faster_than_planned   — rate magnitude above target by > band
 *
 * This module does NOT query the database.
 * All inputs must be pre-computed and passed in.
 */

// ── Algorithm versions ────────────────────────────────────────────────────────

export const GOAL_PROGRESS_VERSION   = "goal_progress_assessment_v1";
export const GOAL_THRESHOLDS_VERSION = "goal_progress_thresholds_v1";

// ── Constants ─────────────────────────────────────────────────────────────────

/** kcal per kilogram of body-weight change (frozen from Phase 7). */
export const ENERGY_PER_KG_KCAL = 7_700;

const DAYS_PER_WEEK = 7;

// ── Thresholds (goal_progress_thresholds_v1) ──────────────────────────────────

/** Phase must be at least this old (days) to enter plateau_candidate. */
export const PLATEAU_CANDIDATE_MIN_AGE_DAYS = 28;

/** Phase must be at least this old (days) to enter likely_plateau. */
export const LIKELY_PLATEAU_MIN_AGE_DAYS = 42;

/** Minimum P7 nutrition coverage fraction for plateau / advisory adjustment. */
export const ADJ_ELIGIBLE_MIN_COVERAGE = 0.70;

/** Band multiplier — rate must be within this fraction of |target| to be "near". */
export const BAND_MULTIPLIER = 0.20;

/** Absolute minimum band (kg/week) regardless of target. */
export const BAND_FLOOR_KG = 0.10;

/** Maintenance near-zero band (kg/week). */
export const MAINTENANCE_BAND_KG = 0.10;

/** Advisory adjustment minimum step (kcal/day). */
export const ADJ_MIN_KCAL = 100;

/** Advisory adjustment maximum step (kcal/day). */
export const ADJ_MAX_KCAL = 250;

/** Advisory adjustment half-step fraction. */
export const ADJ_HALF_STEP = 0.5;

/** Advisory adjustment rounding grain (kcal/day). */
export const ADJ_ROUND_TO = 50;

/** Minimum calorie floor for advisory suggestion (kcal/day). */
export const ADJ_CALORIE_FLOOR = 1_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProgressState =
  | "no_active_goal_phase"
  | "insufficient_data"
  | "stale_data"
  | "on_track"
  | "slower_than_planned"
  | "faster_than_planned"
  | "plateau_candidate"
  | "likely_plateau"
  | "opposite_direction"
  | "maintenance_stable"
  | "maintenance_drift";

export type FeedbackAction =
  | "start_goal_phase"
  | "collect_more_data"
  | "keep_current_plan"
  | "review_goal_assumptions"
  | "consider_less_aggressive_goal"
  | "consider_small_calorie_adjustment"
  | "review_maintenance_drift";

export type GoalProgressInput = {
  /**
   * null when there is no active goal phase — immediately yields no_active_goal_phase.
   * "cut" | "maintenance" | "bulk" for an active phase.
   */
  goalMode: "cut" | "maintenance" | "bulk" | null;

  /** Weekly change target (signed: negative for cut, positive for bulk, 0 for maintenance). */
  goalTargetRateKgPerWeek: number | null;

  /** ISO timestamp: when this goal phase started. */
  goalPhaseStartedAt: string;

  /** ISO timestamp: server clock at time of this assessment. */
  assessedAt: string;

  // ── Current evidence (Phase 6 weight trend) ───────────────────────────────
  currentP6Status: string;
  currentP6Confidence: "low" | "medium" | "high";
  /** Weekly rate (kg/week, signed). null when P6 cannot produce a rate. */
  currentP6WeeklyRateKg: number | null;

  // ── Current evidence (Phase 7 adaptive maintenance) ───────────────────────
  currentP7Status: "usable" | "provisional" | "insufficient" | null;
  currentP7Confidence: "low" | "medium" | "high" | null;
  currentP7CoverageFraction: number | null;

  // ── Historical evidence (same metrics computed at assessedAt − 14 days) ───
  historicalP6Status: string | null;
  historicalP6Confidence: "low" | "medium" | "high" | null;
  historicalP6WeeklyRateKg: number | null;
  historicalP7Status: "usable" | "provisional" | "insufficient" | null;
  historicalP7Confidence: "low" | "medium" | "high" | null;
  historicalP7CoverageFraction: number | null;
};

export type GoalProgressOutput = {
  state: ProgressState;
  feedbackAction: FeedbackAction;
  /** Machine-readable codes explaining the state determination. */
  reasonCodes: string[];
  /** Advisory adjustment magnitude (kcal/day, always positive). null = not applicable. */
  advisoryCalorieAdjustmentKcal: number | null;
  /** "increase" or "decrease" relative to current intake. null when no adjustment. */
  advisoryAdjustmentDirection: "increase" | "decrease" | null;
  /**
   * observed_rate / target_rate.  Positive means same direction as goal.
   * null for maintenance mode or when target / rate is unavailable.
   */
  goalAttainmentRatio: number | null;
  algorithmVersions: { assessment: string; thresholds: string };
  warnings: string[];
  limitations: string[];
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function goalPhaseAgeDays(startedAt: string, assessedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end   = new Date(assessedAt).getTime();
  return Math.max(0, (end - start) / 86_400_000);
}

/** Near-zero band in kg/week (same value used for plateau detection and on-track window). */
function nearZeroBand(targetRate: number | null, mode: "cut" | "maintenance" | "bulk" | null): number {
  if (mode === "maintenance") return MAINTENANCE_BAND_KG;
  if (targetRate === null || mode === null) return BAND_FLOOR_KG;
  return Math.max(BAND_FLOOR_KG, Math.abs(targetRate) * BAND_MULTIPLIER);
}

function isAdequateStatus(status: string): boolean {
  return status === "usable" || status === "provisional";
}

function isAdequateConfidence(c: "low" | "medium" | "high" | null): boolean {
  return c === "medium" || c === "high";
}

/** Returns true when this evidence set qualifies as a plateau candidate. */
function checkPlateauCandidate(
  mode: "cut" | "maintenance" | "bulk" | null,
  ageDays: number,
  p6Status: string,
  p6Confidence: "low" | "medium" | "high",
  weeklyRateKg: number | null,
  p7Status: "usable" | "provisional" | "insufficient" | null,
  band: number,
): boolean {
  if (mode !== "cut")                                           return false;
  if (ageDays < PLATEAU_CANDIDATE_MIN_AGE_DAYS)                return false;
  if (!isAdequateStatus(p6Status))                             return false;
  if (!isAdequateConfidence(p6Confidence))                     return false;
  if (weeklyRateKg === null)                                   return false;
  if (p7Status !== "usable" && p7Status !== "provisional")     return false;
  // Rate is near zero — weight stalling despite a cut goal.
  return Math.abs(weeklyRateKg) <= band;
}

/** Whether the input quality allows an advisory calorie adjustment to be shown. */
function isAdjEligible(
  p6Status: string,
  p6Confidence: "low" | "medium" | "high",
  p7Status: "usable" | "provisional" | "insufficient" | null,
  p7Confidence: "low" | "medium" | "high" | null,
  p7Coverage: number | null,
): boolean {
  return (
    p6Status !== "stale" &&
    isAdequateConfidence(p6Confidence) &&
    p7Status === "usable" &&
    isAdequateConfidence(p7Confidence) &&
    (p7Coverage ?? 0) >= ADJ_ELIGIBLE_MIN_COVERAGE
  );
}

/**
 * Half-step advisory calorie adjustment.
 *
 * required_daily_correction = (target_rate − observed_rate) × 7700 / 7
 * step = 50% of required, rounded to nearest 50, clamped 100–250 kcal/day.
 */
function calcAdjustment(
  targetRate: number,
  observedRate: number,
): { kcal: number; direction: "increase" | "decrease" } | null {
  const required = (targetRate - observedRate) * ENERGY_PER_KG_KCAL / DAYS_PER_WEEK;
  if (!Number.isFinite(required) || required === 0) return null;

  const step      = required * ADJ_HALF_STEP;
  const rounded   = Math.round(step / ADJ_ROUND_TO) * ADJ_ROUND_TO;
  const magnitude = Math.min(ADJ_MAX_KCAL, Math.max(ADJ_MIN_KCAL, Math.abs(rounded)));
  const direction: "increase" | "decrease" = required > 0 ? "increase" : "decrease";

  return { kcal: magnitude, direction };
}

function build(
  state: ProgressState,
  action: FeedbackAction,
  reasons: string[],
  adj: { kcal: number; direction: "increase" | "decrease" } | null,
  ratio: number | null,
  warnings: string[],
): GoalProgressOutput {
  return {
    state,
    feedbackAction: action,
    reasonCodes: reasons,
    advisoryCalorieAdjustmentKcal: adj?.kcal ?? null,
    advisoryAdjustmentDirection: adj?.direction ?? null,
    goalAttainmentRatio: ratio,
    algorithmVersions: { assessment: GOAL_PROGRESS_VERSION, thresholds: GOAL_THRESHOLDS_VERSION },
    warnings,
    limitations: STATIC_LIMITATIONS,
  };
}

// ── Primary export ────────────────────────────────────────────────────────────

export function assess(input: GoalProgressInput): GoalProgressOutput {
  const {
    goalMode, goalTargetRateKgPerWeek, goalPhaseStartedAt, assessedAt,
    currentP6Status, currentP6Confidence, currentP6WeeklyRateKg,
    currentP7Status, currentP7Confidence, currentP7CoverageFraction,
    historicalP6Status, historicalP6Confidence, historicalP6WeeklyRateKg,
    historicalP7Status,
  } = input;

  const warnings: string[] = [];

  // ── 1. No active goal phase ───────────────────────────────────────────────
  if (goalMode === null) {
    return build("no_active_goal_phase", "start_goal_phase", ["no_active_phase"], null, null, warnings);
  }

  const ageDays = goalPhaseAgeDays(goalPhaseStartedAt, assessedAt);
  const band    = nearZeroBand(goalTargetRateKgPerWeek, goalMode);

  // ── 2. Stale data ─────────────────────────────────────────────────────────
  if (currentP6Status === "stale") {
    return build("stale_data", "collect_more_data", ["p6_stale"], null, null, warnings);
  }

  // ── 3. Insufficient data ──────────────────────────────────────────────────
  const p6Insufficient =
    currentP6Status === "insufficient_measurements" ||
    currentP6Status === "insufficient_coverage";
  if (p6Insufficient || currentP6WeeklyRateKg === null) {
    return build("insufficient_data", "collect_more_data", ["p6_insufficient"], null, null, warnings);
  }

  const rate = currentP6WeeklyRateKg;

  // ── 4 & 5. Maintenance mode ───────────────────────────────────────────────
  if (goalMode === "maintenance") {
    if (Math.abs(rate) <= band) {
      return build("maintenance_stable", "keep_current_plan", ["rate_near_zero"], null, null, warnings);
    }
    return build("maintenance_drift", "review_maintenance_drift", ["rate_outside_band"], null, null, warnings);
  }

  // ── Cut / Bulk mode ───────────────────────────────────────────────────────
  const target = goalTargetRateKgPerWeek;

  if (target === null) {
    return build("insufficient_data", "collect_more_data", ["no_target_rate"], null, null, warnings);
  }

  const ratio: number | null =
    Number.isFinite(target) && target !== 0 ? rate / target : null;

  // ── 6 & 7. Plateau detection (cut mode only) ──────────────────────────────
  const isCandidateCurrent = checkPlateauCandidate(
    goalMode, ageDays, currentP6Status, currentP6Confidence,
    rate, currentP7Status, band,
  );

  if (isCandidateCurrent) {
    // Likely plateau: historical evidence also shows plateau candidate.
    const historicalAgeDays = Math.max(0, ageDays - 14);
    const isCandidateHistorical =
      historicalP6Status !== null &&
      historicalP6WeeklyRateKg !== null &&
      checkPlateauCandidate(
        goalMode,
        historicalAgeDays,
        historicalP6Status,
        historicalP6Confidence ?? "low",
        historicalP6WeeklyRateKg,
        historicalP7Status,
        band,
      );

    if (
      ageDays >= LIKELY_PLATEAU_MIN_AGE_DAYS &&
      isCandidateHistorical &&
      currentP7Status === "usable" &&
      isAdequateConfidence(currentP7Confidence) &&
      (currentP7CoverageFraction ?? 0) >= ADJ_ELIGIBLE_MIN_COVERAGE
    ) {
      const adj = isAdjEligible(
        currentP6Status, currentP6Confidence,
        currentP7Status, currentP7Confidence, currentP7CoverageFraction,
      ) ? calcAdjustment(target, rate) : null;
      return build(
        "likely_plateau", "consider_small_calorie_adjustment",
        ["plateau_persistent", "rate_near_zero_cut"], adj, ratio, warnings,
      );
    }

    return build(
      "plateau_candidate", "consider_small_calorie_adjustment",
      ["rate_near_zero_cut"], null, ratio, warnings,
    );
  }

  // ── 8. Opposite direction ─────────────────────────────────────────────────
  // Rate sign is opposite to target sign AND rate is outside the near-zero band.
  const isNearZero   = Math.abs(rate) <= band;
  const oppDirection = !isNearZero && (Math.sign(rate) !== Math.sign(target));

  if (oppDirection) {
    const adj = isAdjEligible(
      currentP6Status, currentP6Confidence,
      currentP7Status, currentP7Confidence, currentP7CoverageFraction,
    ) ? calcAdjustment(target, rate) : null;
    return build(
      "opposite_direction", "consider_small_calorie_adjustment",
      ["rate_opposite_direction"], adj, ratio, warnings,
    );
  }

  // ── 9–11. Rate vs target magnitude ───────────────────────────────────────
  const absRate   = Math.abs(rate);
  const absTgt    = Math.abs(target);
  const deviation = absRate - absTgt;   // positive = faster, negative = slower

  if (Math.abs(deviation) <= band) {
    return build("on_track", "keep_current_plan", ["rate_within_band"], null, ratio, warnings);
  }

  if (deviation < -band) {
    // Slower than planned.
    const adj = isAdjEligible(
      currentP6Status, currentP6Confidence,
      currentP7Status, currentP7Confidence, currentP7CoverageFraction,
    ) ? calcAdjustment(target, rate) : null;
    return build(
      "slower_than_planned", "consider_small_calorie_adjustment",
      ["rate_below_target"], adj, ratio, warnings,
    );
  }

  // Faster than planned.
  if (goalMode === "cut") {
    return build(
      "faster_than_planned", "consider_less_aggressive_goal",
      ["rate_above_target"], null, ratio, warnings,
    );
  }
  // bulk — gaining faster than planned
  return build(
    "faster_than_planned", "review_goal_assumptions",
    ["rate_above_target"], null, ratio, warnings,
  );
}

// ── Static limitations ────────────────────────────────────────────────────────

const STATIC_LIMITATIONS: string[] = [
  "This assessment is based on observed weight change and self-reported food intake.",
  "Progress states are advisory only and do not constitute medical or dietary advice.",
  "No calorie target has been changed by this assessment.",
  "Short-term weight fluctuations (water, glycogen, hormonal) may affect the observed rate.",
  "Advisory calorie adjustments are indicative only; individual metabolic responses vary.",
  "This result does not diagnose metabolic adaptation or inaccurate logging.",
];
