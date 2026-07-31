// Pure energy calculation functions for Phase 5 baseline estimates.
// No I/O, no side effects. Independently testable.
//
// Units throughout: weight in kg, height in cm, age in completed years,
// result in kcal/day.
//
// Reference: Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO.
// "A new predictive equation for resting energy expenditure in healthy
// individuals." Am J Clin Nutr. 1990 Feb;51(2):241–7.

import {
  MIFFLIN_MALE_CONSTANT,
  MIFFLIN_FEMALE_CONSTANT,
  ACTIVITY_MULTIPLIERS,
  KCAL_PER_KG_FAT,
  ABSOLUTE_FLOOR_KCAL,
  AGGRESSIVE_RATE_FRACTION,
  MIN_AGE_YEARS,
  MIN_MANUAL_MAINTENANCE_KCAL,
  MAX_MANUAL_MAINTENANCE_KCAL,
} from "./scienceConfig.ts";

export type EquationSex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalMode = "cut" | "maintenance" | "bulk";
export type MaintenanceSource = "equation_estimate" | "manual_override";

export interface BmrInputs {
  weight_kg: number;
  height_cm: number;
  age_years: number;
  equation_sex: EquationSex;
}

export interface EnergyCalcInputs {
  weight_kg: number;
  height_cm: number;
  birth_date: string;          // ISO date string: "YYYY-MM-DD"
  equation_sex: EquationSex;
  activity_level: ActivityLevel;
  goal_mode: GoalMode;
  target_change_kg_per_week: number;
  manual_maintenance_kcal?: number | null;
  aggressive_rate_acknowledged?: boolean;
  calc_date?: string;          // ISO date string; defaults to today
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

export type WarningCode =
  | "aggressive_rate"
  | "target_below_floor"
  | "missing_fields";

export interface ValidationError {
  field: string;
  message: string;
}

// ── Age calculation ───────────────────────────────────────────────────────────

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

// ── Mifflin–St Jeor BMR ───────────────────────────────────────────────────────

export function calculateBMR(inputs: BmrInputs): number {
  const { weight_kg, height_cm, age_years, equation_sex } = inputs;
  const sexConstant = equation_sex === "male"
    ? MIFFLIN_MALE_CONSTANT
    : MIFFLIN_FEMALE_CONSTANT;

  // Full precision — do not round intermediate values.
  return 10 * weight_kg
    + 6.25 * height_cm
    - 5 * age_years
    + sexConstant;
}

// ── TDEE ─────────────────────────────────────────────────────────────────────

export function calculateTDEE(bmr: number, activity_level: string): number {
  const multiplier = ACTIVITY_MULTIPLIERS[activity_level];
  if (multiplier === undefined) {
    throw new Error(`Unknown activity level: ${activity_level}`);
  }
  return bmr * multiplier;
}

export function getActivityMultiplier(activity_level: string): number {
  const m = ACTIVITY_MULTIPLIERS[activity_level];
  if (m === undefined) throw new Error(`Unknown activity level: ${activity_level}`);
  return m;
}

// ── Maintenance source ────────────────────────────────────────────────────────

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

// ── Goal adjustment ───────────────────────────────────────────────────────────

export function calculateDailyAdjustment(rate_kg_per_week: number): number {
  // Labelled as a static planning approximation; not a dynamic weight prediction.
  return (rate_kg_per_week * KCAL_PER_KG_FAT) / 7;
}

// ── Aggressive-rate check ─────────────────────────────────────────────────────

export function isAggressiveRate(rate_kg_per_week: number, weight_kg: number): boolean {
  if (weight_kg <= 0) return false;
  return Math.abs(rate_kg_per_week) / weight_kg > AGGRESSIVE_RATE_FRACTION;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateEnergyInputs(
  inputs: Partial<EnergyCalcInputs> & { weight_kg?: number },
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!inputs.birth_date) {
    errors.push({ field: "birth_date", message: "Date of birth is required." });
  } else {
    const today = new Date();
    const birth = new Date(inputs.birth_date + "T12:00:00Z");
    if (isNaN(birth.getTime())) {
      errors.push({ field: "birth_date", message: "Date of birth is not a valid date." });
    } else if (birth > today) {
      errors.push({ field: "birth_date", message: "Date of birth cannot be in the future." });
    } else {
      const age = calculateAgeYears(inputs.birth_date);
      if (age < MIN_AGE_YEARS) {
        errors.push({
          field: "birth_date",
          message: `This calculator applies to adults aged ${MIN_AGE_YEARS} or older (calculated age: ${age}).`,
        });
      }
    }
  }

  if (!inputs.equation_sex || !["male", "female"].includes(inputs.equation_sex)) {
    errors.push({
      field: "equation_sex",
      message: "Equation sex (male or female) is required for the Mifflin–St Jeor estimate.",
    });
  }

  if (inputs.height_cm == null) {
    errors.push({ field: "height_cm", message: "Height is required." });
  } else if (!isFinite(inputs.height_cm) || inputs.height_cm <= 0) {
    errors.push({ field: "height_cm", message: "Height must be a positive number." });
  }

  if (inputs.weight_kg == null) {
    errors.push({ field: "weight_kg", message: "An official weight measurement is required." });
  } else if (!isFinite(inputs.weight_kg) || inputs.weight_kg <= 0) {
    errors.push({ field: "weight_kg", message: "Weight must be a positive finite number." });
  }

  if (!inputs.activity_level || !(inputs.activity_level in ACTIVITY_MULTIPLIERS)) {
    errors.push({ field: "activity_level", message: "Activity level is required." });
  }

  if (!inputs.goal_mode || !["cut", "maintenance", "bulk"].includes(inputs.goal_mode)) {
    errors.push({ field: "goal_mode", message: "Goal mode (cut, maintenance, or bulk) is required." });
  } else {
    const rate = inputs.target_change_kg_per_week ?? null;
    if (rate === null || !isFinite(rate)) {
      if (inputs.goal_mode !== "maintenance") {
        errors.push({ field: "target_change_kg_per_week", message: "Weekly change rate is required." });
      }
    } else {
      if (inputs.goal_mode === "cut" && rate >= 0) {
        errors.push({ field: "target_change_kg_per_week", message: "A cut phase requires a negative weekly change rate." });
      }
      if (inputs.goal_mode === "maintenance" && rate !== 0) {
        errors.push({ field: "target_change_kg_per_week", message: "A maintenance phase requires a zero rate." });
      }
      if (inputs.goal_mode === "bulk" && rate <= 0) {
        errors.push({ field: "target_change_kg_per_week", message: "A bulk phase requires a positive weekly change rate." });
      }
    }
  }

  if (inputs.manual_maintenance_kcal != null) {
    const m = inputs.manual_maintenance_kcal;
    if (!isFinite(m) || m <= 0) {
      errors.push({ field: "manual_maintenance_kcal", message: "Manual maintenance must be a positive finite number." });
    } else if (m < MIN_MANUAL_MAINTENANCE_KCAL || m > MAX_MANUAL_MAINTENANCE_KCAL) {
      errors.push({
        field: "manual_maintenance_kcal",
        message: `Manual maintenance must be between ${MIN_MANUAL_MAINTENANCE_KCAL} and ${MAX_MANUAL_MAINTENANCE_KCAL} kcal/day.`,
      });
    }
  }

  return errors;
}

// ── Full calculation ──────────────────────────────────────────────────────────

export function runEnergyCalc(inputs: EnergyCalcInputs & { weight_kg: number }): EnergyCalcResult {
  const validationErrors = validateEnergyInputs(inputs);
  if (validationErrors.length > 0) {
    throw new Error(
      `Validation failed: ${validationErrors.map((e) => e.message).join("; ")}`,
    );
  }

  const calcDate = inputs.calc_date;
  const age_years = calculateAgeYears(inputs.birth_date, calcDate);

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
