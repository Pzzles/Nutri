// Versioned configuration for Phase 5 baseline energy calculations.
// Bump the version string when any constant changes so that snapshots remain
// interpretable against their creation-time config.

export const ALGORITHM_VERSION = "mifflin_st_jeor_v1" as const;
export const ACTIVITY_MULTIPLIER_VERSION = "activity_multiplier_v1" as const;

// Mifflin-St Jeor sex-specific constants (kcal/day).
export const MIFFLIN_MALE_CONSTANT = 5 as const;
export const MIFFLIN_FEMALE_CONSTANT = -161 as const;

// Activity multipliers by profile activity_level value.
export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary:  1.200,
  light:      1.375,
  moderate:   1.550,
  active:     1.725,
  very_active: 1.900,
} as const;

export const ACTIVITY_LABELS: Record<string, string> = {
  sedentary:   "Sedentary – little or no exercise",
  light:       "Lightly active – light exercise 1–3 days/week",
  moderate:    "Moderately active – moderate exercise 3–5 days/week",
  active:      "Very active – hard exercise 6–7 days/week",
  very_active: "Extra active – very hard exercise or physical job",
} as const;

// Safety guardrails.
export const ABSOLUTE_FLOOR_KCAL = 1000 as const;           // reject any target below this
export const AGGRESSIVE_RATE_FRACTION = 0.01 as const;      // 1% of body weight per week
export const MAX_RATE_KG_PER_WEEK = 2.0 as const;

// Energy conversion.
export const KCAL_PER_KG_FAT = 7700 as const;  // used for weekly-rate → daily-adjustment only

// Age constraint.
export const MIN_AGE_YEARS = 18 as const;

// Manual override technical bounds.
export const MIN_MANUAL_MAINTENANCE_KCAL = 500 as const;
export const MAX_MANUAL_MAINTENANCE_KCAL = 10_000 as const;

export const CONFIG_VERSIONS = {
  algorithm:           ALGORITHM_VERSION,
  activity_multiplier: ACTIVITY_MULTIPLIER_VERSION,
} as const;

// Weight freshness threshold: weight older than this many days appears in
// stale_fields on the preview response (a warning, not a hard rejection).
export const WEIGHT_FRESHNESS_WARNING_DAYS = 30 as const;

// ── Phase 6: Weight Trend & Weekly Rate ──────────────────────────────────────

export const WEIGHT_TREND_VERSION = "weight_trend_v1" as const;

// EWMA smoothing factor. Bump version string if this changes.
export const EWMA_VERSION = "weight_ewma_v1" as const;
export const EWMA_ALPHA = 0.25 as const;

// Regression window (days of trend points used for slope calculation).
export const TREND_REGRESSION_WINDOW_DAYS = 28 as const;

// How far back to fetch weight logs to seed the EWMA (warm-up period).
export const TREND_FETCH_WINDOW_DAYS = 90 as const;

// Minimum data requirements for reporting a weekly rate.
export const TREND_MIN_MEASUREMENTS_FOR_RATE = 3 as const;
export const TREND_MIN_COVERAGE_DAYS_FOR_RATE = 7 as const;

// Confidence thresholds — LOW is the default; upgrade path is sequential.
export const CONF_MEDIUM_MIN_MEASUREMENTS = 4 as const;
export const CONF_MEDIUM_MIN_COVERAGE_DAYS = 10 as const;
export const CONF_MEDIUM_MAX_RECENCY_DAYS  = 14 as const;

export const CONF_HIGH_MIN_MEASUREMENTS   = 5 as const;
export const CONF_HIGH_MIN_COVERAGE_DAYS  = 21 as const;
export const CONF_HIGH_MAX_RECENCY_DAYS   = 7 as const;
export const CONF_HIGH_MAX_GAP_DAYS       = 14 as const;
export const CONF_HIGH_MIN_R_SQUARED      = 0.5 as const;

// Outlier detection — flag measurements whose residual from the EWMA trend
// exceeds this many standard deviations. They are never deleted, only flagged.
export const OUTLIER_RESIDUAL_SIGMA = 2.5 as const;

// Hard biological plausibility cap: a single measurement may not differ from
// the preceding official measurement by more than this fraction of body weight.
export const OUTLIER_MAX_SINGLE_DAY_FRACTION = 0.10 as const; // 10% of body weight

// ── Phase 10: Anthropometric Progress Tracking ───────────────────────────────

export const ANTHROPOMETRY_DATA_CONTRACT_VERSION =
  "anthropometry_data_contract_v2" as const;
export const ANTHROPOMETRY_PROTOCOL_VERSION =
  "anthropometry_protocol_v1" as const;
export const ANTHROPOMETRY_REPRESENTATIVE_VERSION =
  "anthropometry_representative_v1" as const;
export const ANTHROPOMETRY_THRESHOLDS_VERSION =
  "anthropometry_repeatability_thresholds_v1" as const;

// Integer tenths of a centimetre keep validation and representative selection
// deterministic across TypeScript, PostgreSQL, and future clients.
export const ANTHROPOMETRY_MIN_READING_TENTHS = 50 as const;
export const ANTHROPOMETRY_MAX_READING_TENTHS = 3000 as const;
export const ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS = 10 as const;
