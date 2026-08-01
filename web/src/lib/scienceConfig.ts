// Frontend mirror of supabase/functions/_shared/scienceConfig.ts
// Keep in sync with the server-side constants. Bump version strings together.

export const ALGORITHM_VERSION = "mifflin_st_jeor_v1" as const;
export const ACTIVITY_MULTIPLIER_VERSION = "activity_multiplier_v1" as const;

export const MIFFLIN_MALE_CONSTANT = 5 as const;
export const MIFFLIN_FEMALE_CONSTANT = -161 as const;

export const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary:   1.200,
  light:       1.375,
  moderate:    1.550,
  active:      1.725,
  very_active: 1.900,
};

export const ACTIVITY_LABELS: Record<string, string> = {
  sedentary:   "Sedentary – little or no exercise",
  light:       "Lightly active – light exercise 1–3 days/week",
  moderate:    "Moderately active – moderate exercise 3–5 days/week",
  active:      "Very active – hard exercise 6–7 days/week",
  very_active: "Extra active – very hard exercise or physical job",
};

export const ABSOLUTE_FLOOR_KCAL = 1000 as const;
export const AGGRESSIVE_RATE_FRACTION = 0.01 as const;
export const MAX_RATE_KG_PER_WEEK = 2.0 as const;
export const KCAL_PER_KG_FAT = 7700 as const;
export const MIN_AGE_YEARS = 18 as const;
export const MIN_MANUAL_MAINTENANCE_KCAL = 500 as const;
export const MAX_MANUAL_MAINTENANCE_KCAL = 10_000 as const;

export const CONFIG_VERSIONS = {
  algorithm:           ALGORITHM_VERSION,
  activity_multiplier: ACTIVITY_MULTIPLIER_VERSION,
} as const;

// ── Phase 6: Weight Trend & Weekly Rate ──────────────────────────────────────

export const WEIGHT_TREND_VERSION = "weight_trend_v1" as const;
export const EWMA_VERSION = "weight_ewma_v1" as const;
export const EWMA_ALPHA = 0.25 as const;
export const TREND_REGRESSION_WINDOW_DAYS = 28 as const;
export const TREND_FETCH_WINDOW_DAYS = 90 as const;
export const TREND_MIN_MEASUREMENTS_FOR_RATE = 3 as const;
export const TREND_MIN_COVERAGE_DAYS_FOR_RATE = 7 as const;

export const CONF_MEDIUM_MIN_MEASUREMENTS  = 4 as const;
export const CONF_MEDIUM_MIN_COVERAGE_DAYS = 10 as const;
export const CONF_MEDIUM_MAX_RECENCY_DAYS  = 14 as const;
export const CONF_HIGH_MIN_MEASUREMENTS    = 5 as const;
export const CONF_HIGH_MIN_COVERAGE_DAYS   = 21 as const;
export const CONF_HIGH_MAX_RECENCY_DAYS    = 7 as const;
export const CONF_HIGH_MAX_GAP_DAYS        = 14 as const;
export const CONF_HIGH_MIN_R_SQUARED       = 0.5 as const;
export const OUTLIER_RESIDUAL_SIGMA        = 2.5 as const;
export const OUTLIER_MAX_SINGLE_DAY_FRACTION = 0.10 as const;
