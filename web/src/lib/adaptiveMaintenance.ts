/**
 * adaptiveMaintenance.ts  (frontend API client)
 *
 * API client, types, and display helpers for Phase 7 observed maintenance.
 *
 * Do NOT import @shared/adaptiveMaintenance or duplicate the energy-balance
 * formula here.  All mathematics live server-side.
 */

import { getFunction, callFunction } from "./supabase";

// ── API response types ────────────────────────────────────────────────────────

export type MaintenanceStatus =
  | "usable"
  | "provisional"
  | "insufficient_nutrition_days"
  | "insufficient_nutrition_coverage"
  | "insufficient_weight_data"
  | "stale_weight_data"
  | "no_active_goal_phase";

export type MaintenanceConfidence = "low" | "medium" | "high";

export interface GoalPhaseSummary {
  id: string;
  mode: string;
  started_at: string;
}

export interface AnalysisWindow {
  start: string;
  end: string;
  calendar_days: number;
  selected_weight_window_days: number;
}

export interface NutritionSummary {
  eligible_days: number;
  probably_complete_days: number;
  incomplete_days: number;
  not_logged_days: number;
  coverage_fraction: number;
  average_intake_kcal: number;
}

export interface WeightTrendSummary {
  weekly_rate_kg: number;
  lower_kg: number | null;
  upper_kg: number | null;
  confidence: "low" | "medium" | "high";
}

export interface MaintenanceEstimate {
  equation_estimate_kcal: number | null;
  manual_override_kcal: number | null;
  effective_phase_value_kcal: number | null;
  effective_phase_source: string | null;
  observed_estimate_kcal: number;
  lower_kcal: number | null;
  upper_kcal: number | null;
  observed_minus_equation_kcal: number | null;
  observed_minus_effective_kcal: number | null;
}

export interface AlgorithmVersions {
  weight_trend: unknown;
  energy_balance: string;
  nutrition_quality: string;
  confidence: string;
}

export interface AdaptiveMaintenanceResponse {
  status: MaintenanceStatus;
  confidence?: MaintenanceConfidence;
  timezone?: string;
  message?: string;
  goal_phase?: GoalPhaseSummary;
  analysis_window?: AnalysisWindow;
  nutrition?: NutritionSummary;
  weight_trend?: WeightTrendSummary;
  maintenance?: MaintenanceEstimate;
  algorithm_versions?: AlgorithmVersions;
  warnings?: string[];
  limitations?: string[];
}

export interface SavedSnapshot {
  snapshot_id: string;
  created_at: string;
  observed_maintenance_kcal: number;
  confidence: MaintenanceConfidence;
  status: string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getAdaptiveMaintenance(): Promise<AdaptiveMaintenanceResponse> {
  return getFunction<AdaptiveMaintenanceResponse>("get-adaptive-maintenance");
}

export async function saveMaintenanceEstimate(goalPhaseId: string): Promise<SavedSnapshot> {
  return callFunction<SavedSnapshot>("save-maintenance-estimate", {
    goal_phase_id: goalPhaseId,
  });
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Format a kcal value for display. Rounds to nearest integer. */
export function formatKcal(kcal: number | null | undefined): string {
  if (kcal == null || !Number.isFinite(kcal)) return "—";
  return `${Math.round(kcal).toLocaleString()} kcal/day`;
}

/** Format a kcal range (lower–upper). */
export function formatKcalRange(
  lower: number | null | undefined,
  upper: number | null | undefined,
): string {
  if (lower == null || upper == null || !Number.isFinite(lower) || !Number.isFinite(upper)) return "—";
  return `${Math.round(lower).toLocaleString()}–${Math.round(upper).toLocaleString()} kcal/day`;
}

/** Human-readable coverage percentage. */
export function formatCoverage(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  return `${Math.round(fraction * 100)}%`;
}

/** Signed difference formatted as "+X kcal" or "−X kcal". */
export function formatDiff(kcal: number | null | undefined): string {
  if (kcal == null || !Number.isFinite(kcal)) return "—";
  const abs  = Math.abs(Math.round(kcal));
  const sign = kcal >= 0 ? "+" : "−";
  return `${sign}${abs.toLocaleString()} kcal/day`;
}

/** Describes the signed difference neutrally (for display). */
export function describeDiff(kcal: number | null | undefined, label: string): string {
  if (kcal == null || !Number.isFinite(kcal)) return "";
  const abs = Math.abs(Math.round(kcal));
  if (abs < 25) return `Your observed estimate is close to the ${label}.`;
  const dir = kcal > 0 ? "above" : "below";
  return `Your observed estimate is about ${abs.toLocaleString()} kcal/day ${dir} the ${label}.`;
}

/** Confidence label for display. */
export function formatConfidence(c: MaintenanceConfidence | undefined): string {
  switch (c) {
    case "high":   return "High";
    case "medium": return "Medium";
    case "low":    return "Low";
    default:       return "—";
  }
}

/** Human label for goal mode. */
export function formatGoalMode(mode: string | undefined): string {
  switch (mode) {
    case "cut":         return "Cut";
    case "maintenance": return "Maintenance";
    case "bulk":        return "Bulk";
    default:            return mode ?? "—";
  }
}

/** Whether the response contains an authoritative observed estimate. */
export function hasEstimate(r: AdaptiveMaintenanceResponse | null): r is AdaptiveMaintenanceResponse & {
  maintenance: MaintenanceEstimate;
  nutrition: NutritionSummary;
  weight_trend: WeightTrendSummary;
  analysis_window: AnalysisWindow;
} {
  return r !== null &&
    (r.status === "usable" || r.status === "provisional") &&
    r.maintenance !== undefined;
}
