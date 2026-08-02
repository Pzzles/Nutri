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
 *   4. maintenance_stable    — maintenance mode, rate near zero or range includes zero
 *   5. maintenance_drift     — maintenance mode, rate outside band AND range excludes zero
 *   6. likely_plateau        — cut, rate near zero, persistent across 14 days with quality evidence
 *   7. plateau_candidate     — cut, rate near zero, single assessment
 *   8. opposite_direction    — rate range fully excludes zero in opposite direction to goal
 *   9. on_track              — target rate inside P6 range OR attainment ratio 0.70–1.30
 *  10. slower_than_planned   — rate magnitude below target by > band
 *  11. faster_than_planned   — rate magnitude above target by > band
 *
 * Adjustment eligibility (numerical suggestion):
 *   - likely_plateau
 *   - opposite_direction (when range confirms direction)
 *   - maintenance_drift (when range confirms direction)
 *   Subject to safety blocks in computeAdjustment().
 *
 * States that NEVER receive a numerical adjustment:
 *   no_active_goal_phase, insufficient_data, stale_data, on_track,
 *   slower_than_planned, faster_than_planned, plateau_candidate,
 *   maintenance_stable
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

/** Minimum calorie floor for advisory suggestion (kcal/day). Violation → block, not clamp. */
export const ADJ_CALORIE_FLOOR = 1_000;

/** Maximum safe rate as fraction of body weight per week. */
export const MAX_SAFE_RATE_FRACTION = 0.01;

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
  /** Lower bound of weekly rate CI (kg/week). null when P6 CI unavailable. */
  currentP6RateLowerKg: number | null;
  /** Upper bound of weekly rate CI (kg/week). null when P6 CI unavailable. */
  currentP6RateUpperKg: number | null;

  // ── Current evidence (Phase 7 adaptive maintenance) ───────────────────────
  currentP7Status: "usable" | "provisional" | "insufficient" | null;
  currentP7Confidence: "low" | "medium" | "high" | null;
  currentP7CoverageFraction: number | null;
  /** P7 observed maintenance point estimate (kcal/day). null when unavailable. */
  currentP7ObservedMaintenanceKcal: number | null;
  /** Lower bound of P7 maintenance CI (kcal/day). null when unavailable. */
  currentP7ObservedMaintenanceLowerKcal: number | null;
  /** Upper bound of P7 maintenance CI (kcal/day). null when unavailable. */
  currentP7ObservedMaintenanceUpperKcal: number | null;
  /** Data-quality warnings from the current P7 calculation. */
  currentP7Warnings: string[];

  // ── Historical evidence (same metrics computed at assessedAt − 14 days) ───
  historicalP6Status: string | null;
  historicalP6Confidence: "low" | "medium" | "high" | null;
  historicalP6WeeklyRateKg: number | null;
  /** Lower bound of historical P6 rate CI. null when unavailable. */
  historicalP6RateLowerKg: number | null;
  /** Upper bound of historical P6 rate CI. null when unavailable. */
  historicalP6RateUpperKg: number | null;
  historicalP7Status: "usable" | "provisional" | "insufficient" | null;
  historicalP7Confidence: "low" | "medium" | "high" | null;
  historicalP7CoverageFraction: number | null;

  // ── Safety evidence ───────────────────────────────────────────────────────
  /** Most recent official weight (kg). Required for adjustment safety checks. */
  currentOfficialWeightKg: number | null;
  /** Current calorie target (kcal/day). Required for adjustment safety checks. */
  currentTargetCalories: number | null;
  /**
   * True when the goal phase has an unresolved warning that the target rate
   * is too aggressive (e.g., set above 1% body weight per week at phase creation).
   */
  hasUnresolvedAggressiveRateWarning: boolean;
};

export type GoalProgressOutput = {
  state: ProgressState;
  feedbackAction: FeedbackAction;
  /** Machine-readable codes explaining the state determination. */
  reasonCodes: string[];

  // ── Canonical signed adjustment (new) ─────────────────────────────────────
  /** Signed advisory adjustment (kcal/day). Negative = lower intake, positive = raise intake. */
  suggestedAdjustmentKcal: number | null;
  /** Proposed calorie target after applying suggestedAdjustmentKcal. */
  proposedTargetKcal: number | null;
  /** Reason codes for why an adjustment was blocked. Empty when no adjustment was attempted. */
  adjustmentBlockedReasonCodes: string[];
  /** Direction of drift for maintenance_drift state. */
  maintenanceDriftDirection: "up" | "down" | null;

  // ── Compatibility aliases (for existing UI — derived from canonical fields) ─
  /** Unsigned magnitude of advisory adjustment. Alias for abs(suggestedAdjustmentKcal). */
  advisoryCalorieAdjustmentKcal: number | null;
  /** Direction of advisory adjustment. Alias derived from sign of suggestedAdjustmentKcal. */
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

/** Near-zero band in kg/week. */
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

/**
 * True when the P6 rate range has overlap with the near-zero band.
 * Used to ensure bounds don't contradict a plateau interpretation.
 * When bounds are null, returns true (no contradiction possible).
 */
function rateRangeOverlapsBand(
  lower: number | null,
  upper: number | null,
  band: number,
): boolean {
  if (lower === null || upper === null) return true;
  // Range [lower, upper] overlaps [-band, +band] when lower ≤ band AND upper ≥ -band.
  return lower <= band && upper >= -band;
}

/**
 * True when the P6 rate range fully excludes zero in the opposite direction to the goal.
 * For cut (target < 0): range must be fully positive (lower > 0) — confidently gaining.
 * For bulk (target > 0): range must be fully negative (upper < 0) — confidently losing.
 * Returns false when bounds are null (cannot confirm from bounds alone).
 */
function rangeFullyOppositeDirection(
  lower: number | null,
  upper: number | null,
  goalMode: "cut" | "bulk",
): boolean {
  if (lower === null || upper === null) return false;
  if (goalMode === "cut")  return lower > 0;   // entire range positive = gaining during cut
  if (goalMode === "bulk") return upper < 0;   // entire range negative = losing during bulk
  return false;
}

/**
 * True when the P6 rate range fully excludes zero (used for maintenance drift).
 * Returns direction of drift: "up" (gaining), "down" (losing), or null (range includes zero).
 */
function rangeExcludesZeroDirection(
  lower: number | null,
  upper: number | null,
): "up" | "down" | null {
  if (lower === null || upper === null) return null;
  if (lower > 0) return "up";    // entire range positive → gaining
  if (upper < 0) return "down";  // entire range negative → losing
  return null;                   // range includes zero → uncertain
}

/**
 * True when the target rate lies inside the P6 estimated rate range.
 * The range is [lower, upper] where lower ≤ upper numerically.
 */
function targetInsideRateRange(
  target: number,
  lower: number | null,
  upper: number | null,
): boolean {
  if (lower === null || upper === null) return false;
  const lo = Math.min(lower, upper);
  const hi = Math.max(lower, upper);
  return lo <= target && target <= hi;
}

/**
 * Returns true when this evidence set qualifies as a plateau candidate.
 *
 * Extended to check P7 confidence and coverage (used in likely_plateau persistence check).
 * Rate bounds are used to verify the range doesn't contradict the near-zero interpretation.
 */
function checkPlateauCandidate(
  mode: "cut" | "maintenance" | "bulk" | null,
  ageDays: number,
  p6Status: string,
  p6Confidence: "low" | "medium" | "high" | null,
  weeklyRateKg: number | null,
  p6RateLower: number | null,
  p6RateUpper: number | null,
  p7Status: "usable" | "provisional" | "insufficient" | null,
  p7Confidence: "low" | "medium" | "high" | null,
  p7CoverageFraction: number | null,
  band: number,
  requireP7Quality: boolean,
): boolean {
  if (mode !== "cut")                                       return false;
  if (ageDays < PLATEAU_CANDIDATE_MIN_AGE_DAYS)            return false;
  if (!isAdequateStatus(p6Status))                         return false;
  if (!isAdequateConfidence(p6Confidence))                 return false;
  if (weeklyRateKg === null)                               return false;
  if (p7Status !== "usable" && p7Status !== "provisional") return false;
  if (!rateRangeOverlapsBand(p6RateLower, p6RateUpper, band)) return false;

  // Optional: require P7 confidence and coverage (used for likely_plateau persistence check).
  if (requireP7Quality) {
    if (!isAdequateConfidence(p7Confidence))               return false;
    if ((p7CoverageFraction ?? 0) < ADJ_ELIGIBLE_MIN_COVERAGE) return false;
  }

  return Math.abs(weeklyRateKg) <= band;
}

/**
 * Evidence conflict rule (deterministic):
 * P6 and P7 materially conflict when the P7 observed maintenance CI entirely
 * excludes the current calorie target in the direction contrary to the goal:
 *   - Cut:  P7 upper bound < current target → P7 says user is above maintenance (gaining),
 *           contradicting the cut expectation.
 *   - Bulk: P7 lower bound > current target → P7 says user is below maintenance (losing),
 *           contradicting the bulk expectation.
 */
function hasEvidenceConflict(
  goalMode: "cut" | "maintenance" | "bulk" | null,
  currentTargetCalories: number | null,
  p7MaintUpperKcal: number | null,
  p7MaintLowerKcal: number | null,
): boolean {
  if (
    goalMode === null ||
    goalMode === "maintenance" ||
    currentTargetCalories === null
  ) {
    return false;
  }
  if (goalMode === "cut" && p7MaintUpperKcal !== null) {
    return p7MaintUpperKcal < currentTargetCalories;
  }
  if (goalMode === "bulk" && p7MaintLowerKcal !== null) {
    return p7MaintLowerKcal > currentTargetCalories;
  }
  return false;
}

/**
 * Compute a cautious, safety-gated advisory calorie adjustment.
 *
 * Returns { kcal: signed number | null, proposedTarget: number | null, blocked: string[] }.
 *
 * Positive kcal → increase intake; negative kcal → decrease intake.
 * When any safety condition fails, kcal and proposedTarget are null and
 * the reason codes are listed in blocked.
 *
 * required_daily_correction = (target_rate − observed_rate) × 7700 / 7
 * half_step                 = required_daily_correction × 0.50
 * rounded_half_step         = round(half_step / 50) × 50
 * bounded_magnitude         = clamp(|rounded|, 100, 250)
 * signed                    = bounded_magnitude × sign(required_daily_correction)
 */
function computeAdjustment(opts: {
  targetRate: number;
  observedRate: number;
  targetCalories: number | null;
  officialWeightKg: number | null;
  p6Confidence: "low" | "medium" | "high";
  p7Confidence: "low" | "medium" | "high" | null;
  p7Coverage: number | null;
  p7Status: "usable" | "provisional" | "insufficient" | null;
  goalMode: "cut" | "maintenance" | "bulk" | null;
  p7MaintUpperKcal: number | null;
  p7MaintLowerKcal: number | null;
  hasAggressiveWarning: boolean;
}): { kcal: number | null; proposedTarget: number | null; blocked: string[] } {
  const blocked: string[] = [];

  // ── Safety checks (order per spec §12) ────────────────────────────────────
  if (opts.targetCalories === null)     blocked.push("missing_current_target");
  if (opts.officialWeightKg === null)   blocked.push("missing_official_weight");
  if (opts.p6Confidence === "low")      blocked.push("low_weight_confidence");
  if (opts.p7Confidence === "low")      blocked.push("low_maintenance_confidence");
  if (opts.p7Status !== "usable")       blocked.push("low_maintenance_confidence");
  if ((opts.p7Coverage ?? 0) < ADJ_ELIGIBLE_MIN_COVERAGE) {
    blocked.push("insufficient_nutrition_coverage");
  }
  if (opts.hasAggressiveWarning) blocked.push("aggressive_rate_warning");

  // Rate exceeds 1% of body weight per week
  if (opts.officialWeightKg !== null && opts.targetRate !== 0) {
    if (Math.abs(opts.targetRate) > opts.officialWeightKg * MAX_SAFE_RATE_FRACTION) {
      blocked.push("rate_exceeds_one_percent_body_weight");
    }
  }

  if (blocked.length > 0) {
    return { kcal: null, proposedTarget: null, blocked };
  }

  // ── Required correction ───────────────────────────────────────────────────
  const required = (opts.targetRate - opts.observedRate) * ENERGY_PER_KG_KCAL / DAYS_PER_WEEK;

  if (!Number.isFinite(required) || Math.abs(required) < ADJ_MIN_KCAL) {
    return { kcal: null, proposedTarget: null, blocked: ["required_correction_below_minimum"] };
  }

  // ── Half-step calculation ─────────────────────────────────────────────────
  const half      = required * ADJ_HALF_STEP;
  const rounded   = Math.round(half / ADJ_ROUND_TO) * ADJ_ROUND_TO;
  const magnitude = Math.min(ADJ_MAX_KCAL, Math.max(ADJ_MIN_KCAL, Math.abs(rounded)));
  const signed    = required > 0 ? magnitude : -magnitude;

  // ── Proposed target & floor check ────────────────────────────────────────
  const proposedTarget = opts.targetCalories! + signed;
  if (proposedTarget < ADJ_CALORIE_FLOOR) {
    return {
      kcal: null,
      proposedTarget: null,
      blocked: ["proposed_target_below_floor"],
    };
  }

  // ── Evidence conflict check ───────────────────────────────────────────────
  if (hasEvidenceConflict(
    opts.goalMode,
    opts.targetCalories,
    opts.p7MaintUpperKcal,
    opts.p7MaintLowerKcal,
  )) {
    return { kcal: null, proposedTarget: null, blocked: ["evidence_conflict"] };
  }

  return { kcal: signed, proposedTarget, blocked: [] };
}

function build(
  state: ProgressState,
  action: FeedbackAction,
  reasons: string[],
  adj: { kcal: number | null; proposedTarget: number | null; blocked: string[] } | null,
  ratio: number | null,
  warnings: string[],
  driftDir: "up" | "down" | null = null,
): GoalProgressOutput {
  const kcal = adj?.kcal ?? null;
  const proposed = adj?.proposedTarget ?? null;
  const blockedReasons = adj?.blocked ?? [];

  return {
    state,
    feedbackAction: action,
    reasonCodes: reasons,

    suggestedAdjustmentKcal:       kcal,
    proposedTargetKcal:            proposed,
    adjustmentBlockedReasonCodes:  blockedReasons,
    maintenanceDriftDirection:     driftDir,

    // Compatibility aliases
    advisoryCalorieAdjustmentKcal: kcal !== null ? Math.abs(kcal) : null,
    advisoryAdjustmentDirection:
      kcal !== null ? (kcal < 0 ? "decrease" : "increase") : null,

    goalAttainmentRatio:    ratio,
    algorithmVersions: {
      assessment: GOAL_PROGRESS_VERSION,
      thresholds: GOAL_THRESHOLDS_VERSION,
    },
    warnings,
    limitations: STATIC_LIMITATIONS,
  };
}

// ── Primary export ────────────────────────────────────────────────────────────

export function assess(input: GoalProgressInput): GoalProgressOutput {
  // Destructure — do not modify the input object.
  const {
    goalMode, goalTargetRateKgPerWeek, goalPhaseStartedAt, assessedAt,
    currentP6Status, currentP6Confidence, currentP6WeeklyRateKg,
    currentP6RateLowerKg, currentP6RateUpperKg,
    currentP7Status, currentP7Confidence, currentP7CoverageFraction,
    currentP7ObservedMaintenanceLowerKcal, currentP7ObservedMaintenanceUpperKcal,
    currentP7Warnings,
    historicalP6Status, historicalP6Confidence, historicalP6WeeklyRateKg,
    historicalP6RateLowerKg, historicalP6RateUpperKg,
    historicalP7Status, historicalP7Confidence, historicalP7CoverageFraction,
    currentOfficialWeightKg, currentTargetCalories,
    hasUnresolvedAggressiveRateWarning,
  } = input;

  const warnings: string[] = [...(currentP7Warnings ?? [])];

  // ── 1. No active goal phase ───────────────────────────────────────────────
  if (goalMode === null) {
    return build("no_active_goal_phase", "start_goal_phase", ["no_active_phase"], null, null, []);
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
    const rateIsNearZero = Math.abs(rate) <= band;

    if (rateIsNearZero) {
      // Point estimate within band → stable regardless of range
      return build("maintenance_stable", "keep_current_plan", ["rate_near_zero"], null, null, warnings);
    }

    // Point estimate outside band: only classify as drift when range excludes zero.
    const driftDir = rangeExcludesZeroDirection(currentP6RateLowerKg, currentP6RateUpperKg);

    if (driftDir !== null) {
      // Range fully excludes zero: confident drift
      const adjResult = computeAdjustment({
        targetRate:          0,
        observedRate:        rate,
        targetCalories:      currentTargetCalories,
        officialWeightKg:    currentOfficialWeightKg,
        p6Confidence:        currentP6Confidence,
        p7Confidence:        currentP7Confidence,
        p7Coverage:          currentP7CoverageFraction,
        p7Status:            currentP7Status,
        goalMode,
        p7MaintUpperKcal:    currentP7ObservedMaintenanceUpperKcal ?? null,
        p7MaintLowerKcal:    currentP7ObservedMaintenanceLowerKcal ?? null,
        hasAggressiveWarning: hasUnresolvedAggressiveRateWarning,
      });
      return build(
        "maintenance_drift", "review_maintenance_drift",
        ["rate_outside_band", `drift_${driftDir}`],
        adjResult, null, warnings, driftDir,
      );
    }

    // Range includes zero: cannot confidently classify as drift → stable (uncertain)
    return build(
      "maintenance_stable", "keep_current_plan",
      ["rate_outside_band_but_range_includes_zero"],
      null, null, warnings,
    );
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
    goalMode, ageDays,
    currentP6Status, currentP6Confidence,
    rate, currentP6RateLowerKg, currentP6RateUpperKg,
    currentP7Status, currentP7Confidence, currentP7CoverageFraction,
    band,
    false, // plateau_candidate does not require P7 quality
  );

  if (isCandidateCurrent) {
    // Likely plateau: historical evidence at (now − 14 days) also qualifies.
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
        historicalP6RateLowerKg ?? null,
        historicalP6RateUpperKg ?? null,
        historicalP7Status,
        historicalP7Confidence,
        historicalP7CoverageFraction,
        band,
        true, // historical candidate check MUST satisfy P7 quality for likely_plateau
      );

    const meetsLikelyPlateau =
      ageDays >= LIKELY_PLATEAU_MIN_AGE_DAYS &&
      isCandidateHistorical &&
      currentP7Status === "usable" &&
      isAdequateConfidence(currentP7Confidence) &&
      (currentP7CoverageFraction ?? 0) >= ADJ_ELIGIBLE_MIN_COVERAGE;

    if (meetsLikelyPlateau) {
      const adjResult = computeAdjustment({
        targetRate:           target,
        observedRate:         rate,
        targetCalories:       currentTargetCalories,
        officialWeightKg:     currentOfficialWeightKg,
        p6Confidence:         currentP6Confidence,
        p7Confidence:         currentP7Confidence,
        p7Coverage:           currentP7CoverageFraction,
        p7Status:             currentP7Status,
        goalMode,
        p7MaintUpperKcal:     currentP7ObservedMaintenanceUpperKcal ?? null,
        p7MaintLowerKcal:     currentP7ObservedMaintenanceLowerKcal ?? null,
        hasAggressiveWarning: hasUnresolvedAggressiveRateWarning,
      });
      return build(
        "likely_plateau", "consider_small_calorie_adjustment",
        ["plateau_persistent", "rate_near_zero_cut"],
        adjResult, ratio, warnings,
      );
    }

    // plateau_candidate: more evidence needed — no numerical adjustment.
    return build(
      "plateau_candidate", "collect_more_data",
      ["rate_near_zero_cut"],
      { kcal: null, proposedTarget: null, blocked: [] }, ratio, warnings,
    );
  }

  // ── 8. Opposite direction ─────────────────────────────────────────────────
  // Only classify as opposite_direction when the rate range fully excludes zero
  // in the direction opposite to the goal.
  const isNearZero = Math.abs(rate) <= band;
  // goalMode is narrowed to "cut" | "bulk" here (maintenance returned above)
  const rateSignOppositeToGoal =
    !isNearZero &&
    Math.sign(rate) !== Math.sign(target);

  if (rateSignOppositeToGoal) {
    const confidentiallyOpposite = rangeFullyOppositeDirection(
      currentP6RateLowerKg, currentP6RateUpperKg,
      goalMode as "cut" | "bulk",
    );

    if (confidentiallyOpposite) {
      const adjResult = computeAdjustment({
        targetRate:           target,
        observedRate:         rate,
        targetCalories:       currentTargetCalories,
        officialWeightKg:     currentOfficialWeightKg,
        p6Confidence:         currentP6Confidence,
        p7Confidence:         currentP7Confidence,
        p7Coverage:           currentP7CoverageFraction,
        p7Status:             currentP7Status,
        goalMode,
        p7MaintUpperKcal:     currentP7ObservedMaintenanceUpperKcal ?? null,
        p7MaintLowerKcal:     currentP7ObservedMaintenanceLowerKcal ?? null,
        hasAggressiveWarning: hasUnresolvedAggressiveRateWarning,
      });
      return build(
        "opposite_direction", "consider_small_calorie_adjustment",
        ["rate_opposite_direction"],
        adjResult, ratio, warnings,
      );
    }
    // Range includes zero: fall through to slower_than_planned with cautious language.
  }

  // ── 9. On-track ───────────────────────────────────────────────────────────
  // Classify on_track when the target rate lies inside the P6 rate range,
  // OR when the goal attainment ratio is within 0.70–1.30 (inclusive).
  const onTrackByRange   = targetInsideRateRange(target, currentP6RateLowerKg, currentP6RateUpperKg);
  const onTrackByRatio   = ratio !== null && ratio >= 0.70 && ratio <= 1.30;

  if (onTrackByRange || onTrackByRatio) {
    const reasonCode = onTrackByRange ? "target_inside_rate_range" : "rate_within_band";
    return build("on_track", "keep_current_plan", [reasonCode], null, ratio, warnings);
  }

  // ── 10 & 11. Slower / faster than planned ────────────────────────────────
  // At this point rate is in the same direction as the goal (opposite direction
  // already handled above) but not on-track.

  // Slower than planned: neutral review action, NO numerical adjustment.
  if (ratio !== null && ratio < 0.70) {
    return build(
      "slower_than_planned", "review_goal_assumptions",
      ["rate_below_target"],
      { kcal: null, proposedTarget: null, blocked: [] }, ratio, warnings,
    );
  }

  // Also catch the case where bounds are null and rate is in the opposite sign
  // (absolute deviation would show slower — see note in opposite_direction check above).
  const absRate    = Math.abs(rate);
  const absTgt     = Math.abs(target);
  const deviation  = absRate - absTgt;

  if (deviation < 0) {
    return build(
      "slower_than_planned", "review_goal_assumptions",
      ["rate_below_target"],
      { kcal: null, proposedTarget: null, blocked: [] }, ratio, warnings,
    );
  }

  // Faster than planned.
  if (goalMode === "cut") {
    return build(
      "faster_than_planned", "consider_less_aggressive_goal",
      ["rate_above_target"], null, ratio, warnings,
    );
  }
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
