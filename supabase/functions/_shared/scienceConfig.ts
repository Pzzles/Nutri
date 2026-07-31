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
