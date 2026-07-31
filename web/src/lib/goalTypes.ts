export type GoalPhaseMode = "cut" | "maintenance" | "bulk";
export type GoalPhaseStatus = "active" | "completed" | "cancelled" | "superseded";
export type DailyLogStatusValue = "unknown" | "partial" | "complete";
export type MaintenanceSource = "equation_estimate" | "manual_override";
export type EnergyWarningCode = "aggressive_rate" | "target_below_floor" | "missing_fields";

export interface MissingField {
  field: string;
  reason: string;
  action: string;
}

export interface StaleField {
  field: string;
  recorded_at: string;
  days_old: number;
  action: string;
}

export interface DataQuality {
  profile_complete: boolean;
  weight_current: boolean;
  calculation_possible: boolean;
}

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
  snapshot_id: string | null;
  manual_maintenance_kcal: number | null;
  edit_count: number;
  created_at: string;
  updated_at: string;
}

export interface CalorieTargetSnapshot {
  id: string;
  user_id: string;
  goal_phase_id: string | null;
  algorithm_name: string;
  algorithm_version: string;
  activity_multiplier_version: string;
  calculation_timestamp: string;
  profile_birth_date: string;
  equation_sex: "male" | "female";
  height_cm: number;
  official_weight_kg: number;
  weight_log_id: string | null;
  weight_measured_at: string | null;
  weight_log_source: string | null;
  age_years: number;
  activity_level: string;
  activity_multiplier: number;
  calculated_bmr_kcal: number;
  calculated_tdee_kcal: number;
  manual_maintenance_kcal: number | null;
  effective_maintenance_kcal: number;
  maintenance_source: MaintenanceSource;
  goal_mode: GoalPhaseMode;
  requested_rate_kg_per_week: number;
  daily_adjustment_kcal: number;
  raw_target_kcal: number;
  final_target_kcal: number;
  warning_codes: EnergyWarningCode[];
  aggressive_rate_acknowledged: boolean;
  config_versions: Record<string, string>;
  input_provenance: Record<string, unknown>;
  created_at: string;
}

export interface EnergyCalcPreview {
  ready: boolean;
  missing_fields: MissingField[];
  stale_fields?: StaleField[];
  data_quality?: DataQuality;
  calculation_timestamp?: string;
  input_snapshot?: {
    birth_date: string;
    equation_sex: string;
    height_cm: number;
    official_weight_kg: number;
    weight_log_id: string;
    weight_measured_at?: string;
    age_years: number;
    activity_level: string;
    activity_multiplier: number;
    goal_mode: GoalPhaseMode;
    target_change_kg_per_week: number;
    manual_maintenance_kcal: number | null;
  };
  input_provenance?: Record<string, unknown>;
  estimated_bmr_kcal?: number;
  estimated_tdee_kcal?: number;
  manual_maintenance_kcal?: number | null;
  effective_maintenance_kcal?: number;
  maintenance_source?: MaintenanceSource;
  daily_adjustment_kcal?: number;
  raw_target_kcal?: number;
  recommended_target_kcal?: number;
  warnings?: EnergyWarningCode[];
  is_aggressive_rate?: boolean;
  algorithm_versions?: Record<string, string>;
  explanation?: string;
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
