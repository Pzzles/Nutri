// Frontend mirror of supabase/functions/_shared/energyCalc.ts
// Pure functions — no I/O, no side effects. Used for live preview in the UI
// before the user submits to the server (which always recalculates authoritatively).

import {
  MIFFLIN_MALE_CONSTANT,
  MIFFLIN_FEMALE_CONSTANT,
  ACTIVITY_MULTIPLIERS,
  KCAL_PER_KG_FAT,
  ABSOLUTE_FLOOR_KCAL,
  AGGRESSIVE_RATE_FRACTION,
  MIN_MANUAL_MAINTENANCE_KCAL,
  MAX_MANUAL_MAINTENANCE_KCAL,
} from "./scienceConfig";

export type EquationSex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalMode = "cut" | "maintenance" | "bulk";
export type MaintenanceSource = "equation_estimate" | "manual_override";
export type WarningCode = "aggressive_rate" | "target_below_floor" | "missing_fields";

export interface BmrInputs {
  weight_kg: number;
  height_cm: number;
  age_years: number;
  equation_sex: EquationSex;
}

export interface EnergyCalcResult {
  age_years: number;
  estimated_bmr_kcal: number;
  estimated_tdee_kcal: number;
  activity_multiplier: number;
  manual_maintenance_kcal: number | null;
  effective_maintenance_kcal: number;
  maintenance_source: MaintenanceSource;
  daily_adjustment_kcal: number;
  raw_target_kcal: number;
  recommended_target_kcal: number;
  warnings: WarningCode[];
  is_aggressive_rate: boolean;
}

export function calculateAgeYears(birth_date: string, calc_date?: string): number {
  const birth = new Date(birth_date + "T12:00:00Z");
  const today = calc_date ? new Date(calc_date + "T12:00:00Z") : new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

export function calculateBMR(inputs: BmrInputs): number {
  const { weight_kg, height_cm, age_years, equation_sex } = inputs;
  const sexConstant = equation_sex === "male" ? MIFFLIN_MALE_CONSTANT : MIFFLIN_FEMALE_CONSTANT;
  return 10 * weight_kg + 6.25 * height_cm - 5 * age_years + sexConstant;
}

export function getActivityMultiplier(activity_level: string): number {
  const m = ACTIVITY_MULTIPLIERS[activity_level];
  if (m === undefined) throw new Error(`Unknown activity level: ${activity_level}`);
  return m;
}

export function resolveMaintenanceKcal(
  tdee: number,
  manual?: number | null,
): { effective: number; source: MaintenanceSource } {
  if (
    manual != null &&
    isFinite(manual) &&
    manual >= MIN_MANUAL_MAINTENANCE_KCAL &&
    manual <= MAX_MANUAL_MAINTENANCE_KCAL
  ) {
    return { effective: manual, source: "manual_override" };
  }
  return { effective: tdee, source: "equation_estimate" };
}

export function calculateDailyAdjustment(rate_kg_per_week: number): number {
  return (rate_kg_per_week * KCAL_PER_KG_FAT) / 7;
}

export function isAggressiveRate(rate_kg_per_week: number, weight_kg: number): boolean {
  if (weight_kg <= 0) return false;
  return Math.abs(rate_kg_per_week) / weight_kg > AGGRESSIVE_RATE_FRACTION;
}

export interface LiveCalcInputs {
  birth_date: string;
  equation_sex: EquationSex;
  height_cm: number;
  weight_kg: number;
  activity_level: ActivityLevel;
  goal_mode: GoalMode;
  target_change_kg_per_week: number;
  manual_maintenance_kcal?: number | null;
}

export function runLiveEnergyCalc(inputs: LiveCalcInputs): EnergyCalcResult {
  const age_years = calculateAgeYears(inputs.birth_date);
  const estimated_bmr_kcal = calculateBMR({
    weight_kg: inputs.weight_kg,
    height_cm: inputs.height_cm,
    age_years,
    equation_sex: inputs.equation_sex,
  });

  const activity_multiplier = getActivityMultiplier(inputs.activity_level);
  const estimated_tdee_kcal = estimated_bmr_kcal * activity_multiplier;

  const { effective: effective_maintenance_kcal, source: maintenance_source } =
    resolveMaintenanceKcal(estimated_tdee_kcal, inputs.manual_maintenance_kcal);

  const rate = inputs.goal_mode === "maintenance" ? 0 : (inputs.target_change_kg_per_week ?? 0);
  const daily_adjustment_kcal = calculateDailyAdjustment(rate);
  const raw_target_kcal = effective_maintenance_kcal + daily_adjustment_kcal;

  const warnings: WarningCode[] = [];
  const aggressive = isAggressiveRate(rate, inputs.weight_kg);
  if (aggressive) warnings.push("aggressive_rate");
  if (raw_target_kcal < ABSOLUTE_FLOOR_KCAL) warnings.push("target_below_floor");

  return {
    age_years,
    estimated_bmr_kcal,
    estimated_tdee_kcal,
    activity_multiplier,
    manual_maintenance_kcal: inputs.manual_maintenance_kcal ?? null,
    effective_maintenance_kcal,
    maintenance_source,
    daily_adjustment_kcal,
    raw_target_kcal,
    recommended_target_kcal: raw_target_kcal,
    warnings,
    is_aggressive_rate: aggressive,
  };
}
