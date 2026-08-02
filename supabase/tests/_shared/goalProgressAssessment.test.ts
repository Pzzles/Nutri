/**
 * Pure unit tests for goalProgressAssessment.ts — Phase 8.
 *
 * 12 deterministic fixtures (A–L) cover every progress state.
 *
 * These tests exercise only the `assess()` function with no database or
 * network access.  All inputs are computed at the fixture level; the
 * expected outputs are derived from the specification and verified here.
 *
 * Fixture map:
 *   A — no_active_goal_phase
 *   B — stale_data
 *   C — insufficient_data
 *   D — maintenance_stable
 *   E — maintenance_drift
 *   F — on_track (cut)
 *   G — slower_than_planned with eligible advisory
 *   H — faster_than_planned (cut → consider_less_aggressive_goal)
 *   I — plateau_candidate (historical evidence not qualifying)
 *   J — likely_plateau (persistent evidence + advisory clamped to 250 kcal)
 *   K — opposite_direction (cut, gaining weight)
 *   L — faster_than_planned (bulk → review_goal_assumptions)
 */

import { describe, it, expect } from "vitest";
import {
  assess,
  GOAL_PROGRESS_VERSION,
  GOAL_THRESHOLDS_VERSION,
  type GoalProgressInput,
} from "../../functions/_shared/goalProgressAssessment.ts";

// ── Shared timestamps ─────────────────────────────────────────────────────────

const NOW = "2026-05-01T10:00:00.000Z";

/** Date that is `n` days before NOW. */
function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

// ── Minimal base inputs shared by most fixtures ───────────────────────────────

const BASE: GoalProgressInput = {
  goalMode:                     "cut",
  goalTargetRateKgPerWeek:      -0.50,
  goalPhaseStartedAt:           daysAgo(15),
  assessedAt:                   NOW,
  currentP6Status:              "usable",
  currentP6Confidence:          "medium",
  currentP6WeeklyRateKg:        -0.48,
  currentP7Status:              "insufficient",
  currentP7Confidence:          null,
  currentP7CoverageFraction:    null,
  historicalP6Status:           null,
  historicalP6Confidence:       null,
  historicalP6WeeklyRateKg:     null,
  historicalP7Status:           null,
  historicalP7Confidence:       null,
  historicalP7CoverageFraction: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function algoVersions() {
  return { assessment: GOAL_PROGRESS_VERSION, thresholds: GOAL_THRESHOLDS_VERSION };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

describe("assess() — Phase 8 goal progress assessment", () => {

  // ── A: no_active_goal_phase ────────────────────────────────────────────────

  it("Fixture A — no_active_goal_phase when goalMode is null", () => {
    const result = assess({ ...BASE, goalMode: null, currentP6WeeklyRateKg: null });

    expect(result.state).toBe("no_active_goal_phase");
    expect(result.feedbackAction).toBe("start_goal_phase");
    expect(result.reasonCodes).toContain("no_active_phase");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    expect(result.advisoryAdjustmentDirection).toBeNull();
    expect(result.goalAttainmentRatio).toBeNull();
    expect(result.algorithmVersions).toEqual(algoVersions());
  });

  // ── B: stale_data ──────────────────────────────────────────────────────────

  it("Fixture B — stale_data when P6 status is stale", () => {
    const result = assess({
      ...BASE,
      currentP6Status:      "stale",
      currentP6WeeklyRateKg: null,
    });

    expect(result.state).toBe("stale_data");
    expect(result.feedbackAction).toBe("collect_more_data");
    expect(result.reasonCodes).toContain("p6_stale");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    expect(result.goalAttainmentRatio).toBeNull();
  });

  // ── C: insufficient_data ───────────────────────────────────────────────────

  it("Fixture C — insufficient_data when P6 has insufficient_measurements", () => {
    const result = assess({
      ...BASE,
      currentP6Status:      "insufficient_measurements",
      currentP6WeeklyRateKg: null,
    });

    expect(result.state).toBe("insufficient_data");
    expect(result.feedbackAction).toBe("collect_more_data");
    expect(result.reasonCodes).toContain("p6_insufficient");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    expect(result.goalAttainmentRatio).toBeNull();
  });

  // ── D: maintenance_stable ──────────────────────────────────────────────────

  it("Fixture D — maintenance_stable when rate is within ±0.10 kg/week band", () => {
    // Rate = 0.05 kg/week — inside maintenance band (0.10 kg/week).
    const result = assess({
      ...BASE,
      goalMode:                  "maintenance",
      goalTargetRateKgPerWeek:   0,
      currentP6WeeklyRateKg:     0.05,
    });

    expect(result.state).toBe("maintenance_stable");
    expect(result.feedbackAction).toBe("keep_current_plan");
    expect(result.reasonCodes).toContain("rate_near_zero");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    expect(result.goalAttainmentRatio).toBeNull();
  });

  // ── E: maintenance_drift ───────────────────────────────────────────────────

  it("Fixture E — maintenance_drift when rate exceeds ±0.10 kg/week band", () => {
    // Rate = +0.25 kg/week — outside maintenance band.
    const result = assess({
      ...BASE,
      goalMode:                  "maintenance",
      goalTargetRateKgPerWeek:   0,
      currentP6WeeklyRateKg:     0.25,
    });

    expect(result.state).toBe("maintenance_drift");
    expect(result.feedbackAction).toBe("review_maintenance_drift");
    expect(result.reasonCodes).toContain("rate_outside_band");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    expect(result.goalAttainmentRatio).toBeNull();
  });

  // ── F: on_track ────────────────────────────────────────────────────────────

  it("Fixture F — on_track when observed rate is within ±band of target", () => {
    // target=-0.50, observed=-0.48; band=max(0.10, 0.10)=0.10
    // deviation = |−0.48| − |−0.50| = −0.02 → within band
    const result = assess({ ...BASE, currentP6WeeklyRateKg: -0.48 });

    expect(result.state).toBe("on_track");
    expect(result.feedbackAction).toBe("keep_current_plan");
    expect(result.reasonCodes).toContain("rate_within_band");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    // ratio = −0.48 / −0.50 = 0.96
    expect(result.goalAttainmentRatio).toBeCloseTo(0.96, 5);
  });

  // ── G: slower_than_planned (with advisory) ─────────────────────────────────

  it("Fixture G — slower_than_planned with eligible advisory calorie adjustment", () => {
    // target=-0.50, observed=-0.20; deviation=-0.30 < -0.10 band → slower
    // Advisory eligible: p7=usable, conf=medium, coverage=0.80 ≥ 0.70
    // required = (−0.50 − (−0.20)) × 7700/7 = −0.30 × 1100 = −330
    // step = −165; rounded = round(−165/50)×50 = −3×50 = −150
    // magnitude = max(100, min(250, 150)) = 150; direction = decrease
    const result = assess({
      ...BASE,
      currentP6WeeklyRateKg:     -0.20,
      currentP7Status:           "usable",
      currentP7Confidence:       "medium",
      currentP7CoverageFraction: 0.80,
    });

    expect(result.state).toBe("slower_than_planned");
    expect(result.feedbackAction).toBe("consider_small_calorie_adjustment");
    expect(result.reasonCodes).toContain("rate_below_target");
    expect(result.advisoryCalorieAdjustmentKcal).toBe(150);
    expect(result.advisoryAdjustmentDirection).toBe("decrease");
    // ratio = −0.20 / −0.50 = 0.40
    expect(result.goalAttainmentRatio).toBeCloseTo(0.40, 5);
  });

  // ── H: faster_than_planned (cut → consider_less_aggressive_goal) ───────────

  it("Fixture H — faster_than_planned cut mode → consider_less_aggressive_goal", () => {
    // target=-0.50, observed=-0.75; deviation=0.25 > 0.10 band → faster
    // Phase is only 15 days old → not a plateau candidate
    // cut mode → action = consider_less_aggressive_goal (not review_goal_assumptions)
    const result = assess({ ...BASE, currentP6WeeklyRateKg: -0.75 });

    expect(result.state).toBe("faster_than_planned");
    expect(result.feedbackAction).toBe("consider_less_aggressive_goal");
    expect(result.reasonCodes).toContain("rate_above_target");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    // ratio = −0.75 / −0.50 = 1.50
    expect(result.goalAttainmentRatio).toBeCloseTo(1.50, 5);
  });

  // ── I: plateau_candidate ───────────────────────────────────────────────────

  it("Fixture I — plateau_candidate when current evidence qualifies but historical does not", () => {
    // Phase is 35 days old (≥ 28 required).
    // Current: usable P6, medium confidence, rate=0.03 ≤ 0.10 band, P7 provisional → candidate
    // Historical: insufficient_measurements → NOT a candidate
    // → plateau_candidate (not likely_plateau)
    const result = assess({
      ...BASE,
      goalPhaseStartedAt:           daysAgo(35),
      currentP6Status:              "usable",
      currentP6Confidence:          "medium",
      currentP6WeeklyRateKg:        0.03,
      currentP7Status:              "provisional",
      currentP7Confidence:          "medium",
      currentP7CoverageFraction:    0.65,
      historicalP6Status:           "insufficient_measurements",
      historicalP6Confidence:       "low",
      historicalP6WeeklyRateKg:     null,
      historicalP7Status:           null,
      historicalP7Confidence:       null,
      historicalP7CoverageFraction: null,
    });

    expect(result.state).toBe("plateau_candidate");
    expect(result.feedbackAction).toBe("consider_small_calorie_adjustment");
    expect(result.reasonCodes).toContain("rate_near_zero_cut");
    // Advisory is null for plateau_candidate (not yet confirmed)
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    // ratio = 0.03 / −0.50 = −0.06
    expect(result.goalAttainmentRatio).toBeCloseTo(-0.06, 5);
  });

  // ── J: likely_plateau ─────────────────────────────────────────────────────

  it("Fixture J — likely_plateau when both current and historical evidence qualify", () => {
    // Phase is 50 days old (≥ 42 required for likely_plateau).
    // Current: usable P6 high confidence, rate=0.02, P7 usable high, coverage=0.85
    // Historical (50−14=36 days old ≥ 28): usable P6 high, rate=0.04 ≤ 0.10, P7 usable
    // → likely_plateau; adj eligible; clamped to 250 kcal/day decrease
    //
    // Advisory calc: target=−0.50, observed=0.02
    //   required = (−0.50 − 0.02) × 7700/7 = −0.52 × 1100 = −572
    //   step = −286; rounded = round(−286/50)×50 = −6×50 = −300
    //   magnitude = min(250, max(100, 300)) = 250; direction = decrease
    const result = assess({
      ...BASE,
      goalPhaseStartedAt:           daysAgo(50),
      currentP6Status:              "usable",
      currentP6Confidence:          "high",
      currentP6WeeklyRateKg:        0.02,
      currentP7Status:              "usable",
      currentP7Confidence:          "high",
      currentP7CoverageFraction:    0.85,
      historicalP6Status:           "usable",
      historicalP6Confidence:       "high",
      historicalP6WeeklyRateKg:     0.04,
      historicalP7Status:           "usable",
      historicalP7Confidence:       "high",
      historicalP7CoverageFraction: 0.80,
    });

    expect(result.state).toBe("likely_plateau");
    expect(result.feedbackAction).toBe("consider_small_calorie_adjustment");
    expect(result.reasonCodes).toContain("plateau_persistent");
    expect(result.reasonCodes).toContain("rate_near_zero_cut");
    expect(result.advisoryCalorieAdjustmentKcal).toBe(250);
    expect(result.advisoryAdjustmentDirection).toBe("decrease");
    // ratio = 0.02 / −0.50 = −0.04
    expect(result.goalAttainmentRatio).toBeCloseTo(-0.04, 5);
  });

  // ── K: opposite_direction ─────────────────────────────────────────────────

  it("Fixture K — opposite_direction when weight is gaining during a cut", () => {
    // target=−0.50 (cut), observed=+0.30 (gaining); rate outside band → opposite direction
    // Advisory eligible; advisory calculation:
    //   required = (−0.50 − 0.30) × 7700/7 = −0.80 × 1100 = −880
    //   step = −440; rounded = round(−440/50)×50 = −9×50 = −450
    //   magnitude = min(250, max(100, 450)) = 250; direction = decrease
    const result = assess({
      ...BASE,
      currentP6WeeklyRateKg:     0.30,
      currentP7Status:           "usable",
      currentP7Confidence:       "medium",
      currentP7CoverageFraction: 0.80,
    });

    expect(result.state).toBe("opposite_direction");
    expect(result.feedbackAction).toBe("consider_small_calorie_adjustment");
    expect(result.reasonCodes).toContain("rate_opposite_direction");
    expect(result.advisoryCalorieAdjustmentKcal).toBe(250);
    expect(result.advisoryAdjustmentDirection).toBe("decrease");
    // ratio = 0.30 / −0.50 = −0.60
    expect(result.goalAttainmentRatio).toBeCloseTo(-0.60, 5);
  });

  // ── L: faster_than_planned (bulk → review_goal_assumptions) ───────────────

  it("Fixture L — faster_than_planned bulk mode → review_goal_assumptions", () => {
    // target=+0.25 (bulk), observed=+0.55; band=max(0.10, 0.05)=0.10
    // deviation = 0.55 − 0.25 = 0.30 > 0.10 → faster_than_planned
    // bulk mode → action = review_goal_assumptions (not consider_less_aggressive_goal)
    const result = assess({
      ...BASE,
      goalMode:                  "bulk",
      goalTargetRateKgPerWeek:   0.25,
      currentP6WeeklyRateKg:     0.55,
    });

    expect(result.state).toBe("faster_than_planned");
    expect(result.feedbackAction).toBe("review_goal_assumptions");
    expect(result.reasonCodes).toContain("rate_above_target");
    expect(result.advisoryCalorieAdjustmentKcal).toBeNull();
    // ratio = 0.55 / 0.25 = 2.20
    expect(result.goalAttainmentRatio).toBeCloseTo(2.20, 5);
  });

  // ── Invariants ─────────────────────────────────────────────────────────────

  it("all results carry the correct algorithm version strings", () => {
    // Spot-check three fixtures to ensure version strings are propagated.
    const fixtures: GoalProgressInput[] = [
      { ...BASE, goalMode: null, currentP6WeeklyRateKg: null },
      { ...BASE },
      { ...BASE, goalMode: "maintenance", goalTargetRateKgPerWeek: 0, currentP6WeeklyRateKg: 0.05 },
    ];
    for (const f of fixtures) {
      const r = assess(f);
      expect(r.algorithmVersions.assessment).toBe(GOAL_PROGRESS_VERSION);
      expect(r.algorithmVersions.thresholds).toBe(GOAL_THRESHOLDS_VERSION);
      expect(Array.isArray(r.limitations)).toBe(true);
      expect(r.limitations.length).toBeGreaterThan(0);
    }
  });

  it("advisory direction is always consistent with sign of (target − observed)", () => {
    // Increase advisory for a bulk that is slower than planned.
    // target=+0.30, observed=+0.10 → need to increase intake
    const result = assess({
      ...BASE,
      goalMode:                  "bulk",
      goalTargetRateKgPerWeek:   0.30,
      goalPhaseStartedAt:        daysAgo(15),
      currentP6WeeklyRateKg:     0.10,
      currentP7Status:           "usable",
      currentP7Confidence:       "medium",
      currentP7CoverageFraction: 0.80,
    });

    expect(result.state).toBe("slower_than_planned");
    expect(result.advisoryAdjustmentDirection).toBe("increase");
  });

  it("likely_plateau requires phase age ≥ 42 days — plateau_candidate at age 35 even with qualifying historical evidence", () => {
    // Same inputs as J but phase is only 35 days old → not likely_plateau
    const result = assess({
      ...BASE,
      goalPhaseStartedAt:           daysAgo(35),
      currentP6Status:              "usable",
      currentP6Confidence:          "high",
      currentP6WeeklyRateKg:        0.02,
      currentP7Status:              "usable",
      currentP7Confidence:          "high",
      currentP7CoverageFraction:    0.85,
      historicalP6Status:           "usable",
      historicalP6Confidence:       "high",
      historicalP6WeeklyRateKg:     0.04,
      historicalP7Status:           "usable",
      historicalP7Confidence:       "high",
      historicalP7CoverageFraction: 0.80,
    });

    // Falls back to plateau_candidate because ageDays=35 < 42
    expect(result.state).toBe("plateau_candidate");
  });
});
