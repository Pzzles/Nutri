/**
 * goalFeedback.ts  (frontend API client)
 *
 * API client, types, and display helpers for Phase 8 goal-progress feedback.
 *
 * All assessment calculations live server-side; this file only calls the
 * endpoints and provides display utilities.
 */

import { getFunction, callFunction } from "./supabase";

// ── Progress state & feedback action types ────────────────────────────────────

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

export type AdjustmentDirection = "increase" | "decrease";

// ── Evidence snapshot types ───────────────────────────────────────────────────

export interface EvidenceSnapshot {
  p6_status: string;
  p6_confidence: "low" | "medium" | "high";
  p6_weekly_rate_kg: number | null;
  p7_status: "usable" | "provisional" | "insufficient" | null;
  p7_confidence: "low" | "medium" | "high" | null;
  p7_coverage_fraction: number | null;
}

export interface GoalPhaseSummary {
  id: string;
  mode: "cut" | "maintenance" | "bulk";
  started_at: string;
  target_change_kg_per_week: number | null;
}

export interface AlgorithmVersions {
  goal_progress: string;
  goal_thresholds: string;
  energy_balance: string;
  nutrition_quality: string;
  confidence: string;
}

// ── GET response type ─────────────────────────────────────────────────────────

export interface GoalFeedbackResponse {
  progress_state: ProgressState;
  feedback_action: FeedbackAction;
  reason_codes: string[];
  advisory_calorie_adjustment_kcal: number | null;
  advisory_adjustment_direction: AdjustmentDirection | null;
  goal_attainment_ratio: number | null;
  goal_phase: GoalPhaseSummary | null;
  evidence: {
    current: EvidenceSnapshot | null;
    historical_14d: EvidenceSnapshot | null;
  };
  assessed_at: string;
  algorithm_versions: AlgorithmVersions;
  warnings: string[];
  limitations: string[];
}

// ── POST response type ────────────────────────────────────────────────────────

export interface SavedAssessment {
  assessment_id: string;
  created_at: string;
  progress_state: ProgressState;
  feedback_action: FeedbackAction;
  advisory_calorie_adjustment_kcal: number | null;
  advisory_adjustment_direction: AdjustmentDirection | null;
  goal_attainment_ratio: number | null;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getGoalFeedback(): Promise<GoalFeedbackResponse> {
  return getFunction<GoalFeedbackResponse>("get-goal-feedback");
}

export async function saveGoalFeedbackAssessment(goalPhaseId: string): Promise<SavedAssessment> {
  return callFunction<SavedAssessment>("save-goal-feedback-assessment", {
    goal_phase_id: goalPhaseId,
  });
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Human-readable headline for each progress state. */
export function stateHeadline(state: ProgressState): string {
  switch (state) {
    case "no_active_goal_phase":   return "No active goal phase";
    case "insufficient_data":      return "Not enough data yet";
    case "stale_data":             return "Weight data is out of date";
    case "on_track":               return "On track";
    case "slower_than_planned":    return "Slower than planned";
    case "faster_than_planned":    return "Faster than planned";
    case "plateau_candidate":      return "Possible plateau";
    case "likely_plateau":         return "Plateau likely";
    case "opposite_direction":     return "Moving in the wrong direction";
    case "maintenance_stable":     return "Maintaining well";
    case "maintenance_drift":      return "Weight is drifting";
  }
}

/** One-line description of what the state means. */
export function stateDescription(state: ProgressState): string {
  switch (state) {
    case "no_active_goal_phase":
      return "Set up a goal phase to start tracking your progress.";
    case "insufficient_data":
      return "Keep logging weight and food to build up enough data for an assessment.";
    case "stale_data":
      return "Your most recent weight measurement is too old. Log a new weigh-in to continue tracking.";
    case "on_track":
      return "Your observed progress is close to your planned rate. Keep it up.";
    case "slower_than_planned":
      return "Your progress rate is below your goal. This is common early in a phase.";
    case "faster_than_planned":
      return "Your progress rate is above your planned pace.";
    case "plateau_candidate":
      return "Progress appears to have slowed. Continue monitoring — this may be temporary.";
    case "likely_plateau":
      return "Two weeks of evidence suggest a sustained stall. A small calorie adjustment may help.";
    case "opposite_direction":
      return "Weight is moving in the opposite direction from your goal.";
    case "maintenance_stable":
      return "Your weight is stable within the maintenance band. You're doing well.";
    case "maintenance_drift":
      return "Weight is drifting outside the maintenance range.";
  }
}

/** Human-readable label for each feedback action. */
export function actionLabel(action: FeedbackAction): string {
  switch (action) {
    case "start_goal_phase":                return "Set up a goal phase";
    case "collect_more_data":               return "Keep collecting data";
    case "keep_current_plan":               return "Continue with current plan";
    case "review_goal_assumptions":         return "Review your goal setup";
    case "consider_less_aggressive_goal":   return "Consider a less aggressive goal";
    case "consider_small_calorie_adjustment": return "Consider a small calorie adjustment";
    case "review_maintenance_drift":        return "Review your maintenance intake";
  }
}

/** Tone/severity for each state — used to pick border and background colours. */
export type StateTone = "neutral" | "positive" | "advisory" | "warning";

export function stateTone(state: ProgressState): StateTone {
  switch (state) {
    case "no_active_goal_phase":
    case "insufficient_data":
    case "stale_data":
      return "neutral";
    case "on_track":
    case "maintenance_stable":
      return "positive";
    case "slower_than_planned":
    case "faster_than_planned":
    case "plateau_candidate":
    case "maintenance_drift":
      return "advisory";
    case "likely_plateau":
    case "opposite_direction":
      return "warning";
  }
}

/** Format a weekly rate for display (e.g. "0.30 kg/week loss"). */
export function formatWeeklyRate(rateKg: number | null | undefined): string {
  if (rateKg == null || !Number.isFinite(rateKg)) return "—";
  const abs = Math.abs(rateKg);
  if (abs < 0.01) return "Stable";
  const dir = rateKg < 0 ? "loss" : "gain";
  return `${abs.toFixed(2)} kg/week ${dir}`;
}

/** Format a goal attainment ratio as a percentage (e.g. "72%"). */
export function formatAttainment(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

/** Format an advisory calorie adjustment with direction. */
export function formatAdvisoryAdjustment(
  kcal: number | null | undefined,
  direction: AdjustmentDirection | null | undefined,
): string {
  if (kcal == null || !direction) return "";
  const verb = direction === "increase" ? "Increase" : "Decrease";
  return `${verb} intake by ~${Math.round(kcal)} kcal/day`;
}

/** Whether the response has a computed advisory adjustment. */
export function hasAdvisoryAdjustment(r: GoalFeedbackResponse): boolean {
  return r.advisory_calorie_adjustment_kcal != null && r.advisory_adjustment_direction != null;
}

/** Format a coverage fraction as a percentage. */
export function formatCoverage(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  return `${Math.round(fraction * 100)}%`;
}

/** Format goal mode for display. */
export function formatGoalMode(mode: string | undefined): string {
  switch (mode) {
    case "cut":         return "Cut";
    case "maintenance": return "Maintenance";
    case "bulk":        return "Bulk";
    default:            return mode ?? "—";
  }
}
