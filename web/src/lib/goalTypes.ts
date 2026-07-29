export type GoalPhaseMode = "cut" | "maintenance" | "bulk";
export type GoalPhaseStatus = "active" | "completed" | "cancelled" | "superseded";
export type DailyLogStatusValue = "unknown" | "partial" | "complete";

export interface GoalPhase {
  id: string;
  user_id: string;
  mode: GoalPhaseMode;
  status: GoalPhaseStatus;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  starting_weight_kg: number;
  starting_weight_source: "manual" | "latest_weight_log";
  target_weight_kg: number | null;
  target_change_kg_per_week: number | null;
  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  target_fibre_g: number | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyLogStatus {
  logged_date?: string;
  status: DailyLogStatusValue;
  marked_complete_at: string | null;
  reopened_at: string | null;
  updated_at?: string;
}

export interface WeightChange {
  starting_weight_kg: number;
  latest_weight_kg: number | null;
  change_kg: number | null;
  days_in_phase: number;
}

// Subset used by GoalPhaseCard on the Dashboard.
export interface DashboardSummaryPhase {
  active_phase: GoalPhase | null;
  daily_log_status: DailyLogStatus;
  weight_change: WeightChange | null;
}

export type PhaseTransition = "supersede" | "cancel";
