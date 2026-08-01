/**
 * adaptiveMaintenance.ts
 *
 * Pure, independently-testable Phase 7 calculation module.
 *
 * algorithm: observed_maintenance_energy_balance_v1
 *
 * Formula:
 *   daily_weight_energy_balance_kcal = weeklyRateKg × 7700 ÷ 7
 *   observed_maintenance_kcal        = averageIntakeKcal − daily_weight_energy_balance_kcal
 *
 * Sign convention (matches Phase 6):
 *   weight loss  → weeklyRateKg negative → energy balance negative → maintenance > intake
 *   maintenance  → weeklyRateKg ≈ 0     → maintenance ≈ intake
 *   weight gain  → weeklyRateKg positive → energy balance positive → maintenance < intake
 *
 * Uncertainty range (bounds reverse because maintenance decreases as gain-rate increases):
 *   maintenance_lower_kcal = averageIntakeKcal − rateUpperKg × 7700 ÷ 7
 *   maintenance_upper_kcal = averageIntakeKcal − rateLowerKg × 7700 ÷ 7
 *
 * This module does NOT query the database.
 * All inputs must be pre-computed and passed in.
 */

// ── Algorithm versions ────────────────────────────────────────────────────────

export const ENERGY_BALANCE_VERSION   = "observed_maintenance_energy_balance_v1";
export const NUTRITION_QUALITY_VERSION = "maintenance_nutrition_quality_v1";
export const CONFIDENCE_VERSION       = "observed_maintenance_confidence_v1";

// ── Constants ─────────────────────────────────────────────────────────────────

/** kcal per kilogram of body-weight change (planning approximation). */
export const ENERGY_PER_KG_KCAL = 7_700;

/** Days per week (exact). */
const DAYS_PER_WEEK = 7;

// ── Nutrition quality thresholds (maintenance_nutrition_quality_v1) ───────────

/** Return no authoritative estimate below these thresholds. */
export const INSUFFICIENT_DAY_THRESHOLD   = 14;
export const INSUFFICIENT_COVERAGE_MIN    = 0.50;

/** Provisional: estimate shown but flagged as low-quality. */
export const PROVISIONAL_DAY_THRESHOLD    = 14;
export const PROVISIONAL_COVERAGE_MIN     = 0.50;

/** Usable: estimate shown at medium+ confidence. */
export const USABLE_DAY_THRESHOLD         = 20;
export const USABLE_COVERAGE_MIN          = 0.70;

/** High quality: all components needed for high confidence. */
export const HIGH_QUALITY_DAY_THRESHOLD   = 24;
export const HIGH_QUALITY_COVERAGE_MIN    = 0.85;

// ── Input type ────────────────────────────────────────────────────────────────

export type WeightTrendConfidence = "low" | "medium" | "high";
export type MaintenanceConfidence = "low" | "medium" | "high";

export type AdaptiveMaintenanceInput = {
  /** Arithmetic mean of complete + fasting eligible days. */
  averageIntakeKcal: number;
  /** Number of eligible (complete + fasting) days used in the average. */
  eligibleDayCount: number;
  /** Total calendar days in the analysis window. */
  analysisCalendarDays: number;
  /** Number of days flagged as probably_complete (partial + has meals). */
  probablyCompleteDayCount: number;
  /** Phase 6 selected weekly rate (signed: negative = loss). */
  weeklyRateKg: number;
  /** Phase 6 lower bound of weekly rate (may be null if CI unavailable). */
  rateLowerKg: number | null;
  /** Phase 6 upper bound of weekly rate. */
  rateUpperKg: number | null;
  /** Phase 6 overall confidence. */
  weightTrendConfidence: WeightTrendConfidence;
  /** Non-empty when there are data-quality concerns. */
  nutritionWarnings: string[];
  /** Active goal phase identifier (for provenance). */
  goalPhaseId: string;
  /** Equation-derived TDEE from the Phase 5 snapshot (may be null). */
  equationEstimatedTdeeKcal: number | null;
  /** User-supplied manual maintenance override (may be null). */
  manualMaintenanceOverrideKcal: number | null;
  /** Which maintenance value is in effect for this goal phase. */
  effectiveMaintenanceKcal: number | null;
  /** Source of the effective maintenance value. */
  effectiveMaintenanceSource: string | null;
};

// ── Output type ───────────────────────────────────────────────────────────────

export type NutritionQualityStatus = "insufficient" | "provisional" | "usable" | "high";

export type MaintenanceStatus =
  | "usable"
  | "provisional"
  | "insufficient";

export type AdaptiveMaintenanceOutput = {
  /** Overall estimate status. */
  status: MaintenanceStatus;
  /** Overall confidence in the observed estimate. */
  confidence: MaintenanceConfidence;

  /** Nutrition side of the quality assessment. */
  nutritionQuality: NutritionQualityStatus;
  /** Eligible nutrition days used in the average. */
  eligibleDayCount: number;
  /** Total calendar days in the analysis window. */
  analysisCalendarDays: number;
  /** Fraction of analysis window covered by eligible days. */
  coverageFraction: number;

  /** Observed maintenance estimate (full precision). */
  observedMaintenanceKcal: number;
  /** Lower bound (full precision), null when Phase 6 CI unavailable. */
  maintenanceLowerKcal: number | null;
  /** Upper bound (full precision), null when Phase 6 CI unavailable. */
  maintenanceUpperKcal: number | null;

  /** Signed difference from the equation estimate. */
  observedMinusEquationKcal: number | null;
  /** Signed difference from the effective phase maintenance. */
  observedMinusEffectiveKcal: number | null;

  /** Frozen algorithm version strings. */
  algorithmVersions: {
    energyBalance: string;
    nutritionQuality: string;
    confidence: string;
  };

  /** Non-empty list of active data-quality warnings. */
  warnings: string[];

  /** Fixed limitations the caller must surface to the user. */
  limitations: string[];
};

// ── Core calculation ──────────────────────────────────────────────────────────

/**
 * Calculate observed maintenance from pre-aggregated inputs.
 *
 * Returns null when the inputs do not meet the minimum thresholds (instead of
 * throwing), so callers can distinguish "not enough data" from "bad inputs".
 */
export function calculate(input: AdaptiveMaintenanceInput): AdaptiveMaintenanceOutput | null {
  const {
    averageIntakeKcal,
    eligibleDayCount,
    analysisCalendarDays,
    weeklyRateKg,
    rateLowerKg,
    rateUpperKg,
    weightTrendConfidence,
    nutritionWarnings,
    equationEstimatedTdeeKcal,
    manualMaintenanceOverrideKcal,
    effectiveMaintenanceKcal,
  } = input;

  // ── Guard: valid inputs ────────────────────────────────────────────────────
  if (
    !Number.isFinite(averageIntakeKcal) ||
    !Number.isFinite(weeklyRateKg) ||
    !Number.isFinite(eligibleDayCount) ||
    !Number.isFinite(analysisCalendarDays) ||
    eligibleDayCount < 0 ||
    analysisCalendarDays <= 0
  ) {
    return null;
  }

  const coverageFraction =
    analysisCalendarDays > 0 ? eligibleDayCount / analysisCalendarDays : 0;

  // ── Nutrition quality classification ──────────────────────────────────────
  const nutritionQuality = classifyNutritionQuality(
    eligibleDayCount,
    coverageFraction,
    nutritionWarnings,
  );

  // ── Insufficient data: return null ────────────────────────────────────────
  if (nutritionQuality === "insufficient") {
    return null;
  }

  // ── Core energy-balance formula ───────────────────────────────────────────
  const dailyEnergyBalance = (weeklyRateKg * ENERGY_PER_KG_KCAL) / DAYS_PER_WEEK;
  const observedMaintenanceKcal = averageIntakeKcal - dailyEnergyBalance;

  // ── Uncertainty range (bounds reverse) ───────────────────────────────────
  let maintenanceLowerKcal: number | null = null;
  let maintenanceUpperKcal: number | null = null;

  if (rateLowerKg !== null && rateUpperKg !== null &&
      Number.isFinite(rateLowerKg) && Number.isFinite(rateUpperKg)) {
    // rateUpperKg subtracted gives the LOWER maintenance bound
    maintenanceLowerKcal = averageIntakeKcal - (rateUpperKg * ENERGY_PER_KG_KCAL) / DAYS_PER_WEEK;
    // rateLowerKg subtracted gives the UPPER maintenance bound
    maintenanceUpperKcal = averageIntakeKcal - (rateLowerKg * ENERGY_PER_KG_KCAL) / DAYS_PER_WEEK;
  }

  // ── Differences from comparisons ─────────────────────────────────────────
  const observedMinusEquationKcal =
    equationEstimatedTdeeKcal !== null && Number.isFinite(equationEstimatedTdeeKcal)
      ? observedMaintenanceKcal - equationEstimatedTdeeKcal
      : null;

  const observedMinusEffectiveKcal =
    effectiveMaintenanceKcal !== null && Number.isFinite(effectiveMaintenanceKcal)
      ? observedMaintenanceKcal - effectiveMaintenanceKcal
      : null;

  // ── Status and confidence ─────────────────────────────────────────────────
  const status = nutritionQuality === "provisional" ? "provisional" : "usable";
  const confidence = classifyConfidence(
    weightTrendConfidence,
    nutritionQuality,
    nutritionWarnings,
  );

  return {
    status,
    confidence,
    nutritionQuality,
    eligibleDayCount,
    analysisCalendarDays,
    coverageFraction,
    observedMaintenanceKcal,
    maintenanceLowerKcal,
    maintenanceUpperKcal,
    observedMinusEquationKcal,
    observedMinusEffectiveKcal,
    algorithmVersions: {
      energyBalance: ENERGY_BALANCE_VERSION,
      nutritionQuality: NUTRITION_QUALITY_VERSION,
      confidence: CONFIDENCE_VERSION,
    },
    warnings: [...nutritionWarnings],
    limitations: STATIC_LIMITATIONS,
  };
}

// ── Nutrition quality classification ─────────────────────────────────────────

export function classifyNutritionQuality(
  eligibleDays: number,
  coverageFraction: number,
  warnings: string[],
): NutritionQualityStatus {
  if (
    eligibleDays < INSUFFICIENT_DAY_THRESHOLD ||
    coverageFraction < INSUFFICIENT_COVERAGE_MIN
  ) {
    return "insufficient";
  }

  const hasMaterialWarning = warnings.some((w) => w.startsWith("material:"));

  if (
    eligibleDays >= HIGH_QUALITY_DAY_THRESHOLD &&
    coverageFraction >= HIGH_QUALITY_COVERAGE_MIN &&
    !hasMaterialWarning
  ) {
    return "high";
  }

  if (
    eligibleDays >= USABLE_DAY_THRESHOLD &&
    coverageFraction >= USABLE_COVERAGE_MIN
  ) {
    return "usable";
  }

  return "provisional";
}

// ── Confidence classification ─────────────────────────────────────────────────

export function classifyConfidence(
  weightTrendConfidence: WeightTrendConfidence,
  nutritionQuality: NutritionQualityStatus,
  warnings: string[],
): MaintenanceConfidence {
  const hasMaterialWarning = warnings.some((w) => w.startsWith("material:"));

  // High: both sides must be high-quality, no warnings
  if (
    weightTrendConfidence === "high" &&
    nutritionQuality === "high" &&
    !hasMaterialWarning
  ) {
    return "high";
  }

  // Low: any of these disqualify medium
  if (
    weightTrendConfidence === "low" ||
    nutritionQuality === "provisional" ||
    hasMaterialWarning
  ) {
    return "low";
  }

  return "medium";
}

// ── Static limitations text ───────────────────────────────────────────────────

const STATIC_LIMITATIONS: string[] = [
  "This is an estimate based on self-reported food intake and observed weight change.",
  "Not every kilogram of weight change represents exactly 7,700 kcal; this is a planning approximation.",
  "The estimated range reflects weight-trend uncertainty only and does not capture systematic food-logging error.",
  "Short-term weight change includes water, glycogen, and other factors beyond body fat.",
  "This result does not prove inaccurate logging or metabolic adaptation.",
];
