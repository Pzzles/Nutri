# Phase 5 — Energy Baseline Calculations

## Overview

Phase 5 adds a scientifically grounded calorie-target calculation to the goal-phase workflow.
When a user starts a goal phase, the server derives an authoritative calorie target from their
profile and the most recent official weight log. The user cannot override the calorie target
directly — they can only supply inputs (mode, rate, activity level, optional maintenance
override) and let the server calculate.

An immutable snapshot of the calculation is stored alongside the phase so that future profile
changes do not retroactively alter what was used at phase creation time.

---

## Algorithm: Mifflin–St Jeor (1990)

**Reference:** Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO.
"A new predictive equation for resting energy expenditure in healthy individuals."
*Am J Clin Nutr.* 1990 Feb;51(2):241–7.

### BMR formula

```
BMR = 10 × weight_kg + 6.25 × height_cm − 5 × age_years + sex_constant
```

| Sex    | sex_constant |
|--------|-------------|
| male   | +5          |
| female | −161        |

The sex-constant difference is exactly **166 kcal/day** for identical biometric inputs.

No intermediate values are rounded; the result is rounded only when returned to the client.

---

## TDEE and Activity Multipliers

```
TDEE = BMR × activity_multiplier
```

Activity levels and their multipliers are versioned under `activity_multiplier_v1`:

| activity_level | multiplier | Description                                       |
|---------------|-----------|---------------------------------------------------|
| sedentary      | 1.200     | Little or no exercise                            |
| light          | 1.375     | Light exercise 1–3 days/week                     |
| moderate       | 1.550     | Moderate exercise 3–5 days/week                  |
| active         | 1.725     | Hard exercise 6–7 days/week                      |
| very_active    | 1.900     | Very hard exercise or a physical job             |

---

## Maintenance Source

The **effective maintenance** is determined as follows:

1. If `manual_maintenance_kcal` is supplied and within `[500, 10,000]` kcal/day:
   - `maintenance_source = "manual_override"`
   - `effective_maintenance = manual_maintenance_kcal`
2. Otherwise:
   - `maintenance_source = "equation_estimate"`
   - `effective_maintenance = TDEE`

---

## Calorie Target Calculation

```
daily_adjustment = rate_kg_per_week × 7700 ÷ 7
raw_target       = effective_maintenance + daily_adjustment
final_target     = raw_target
```

**Sign convention:** Negative rate → deficit (cut); positive rate → surplus (bulk); zero → maintenance.

The constant **7,700 kcal/kg** is a static planning approximation for fat tissue energy content.
It is used for goal-planning only — it does not predict actual body composition changes.

---

## Safety Guardrails

### 1. Absolute floor — 1,000 kcal/day

If `final_target < 1000`, the request is rejected with HTTP 422, error code `TARGET_BELOW_FLOOR`.
The target is **never silently clamped** — the caller must reduce the rate or adjust the
manual maintenance to bring the target above 1,000 kcal/day.

### 2. Aggressive rate warning — 1% of body weight per week

If `|rate_kg_per_week| / weight_kg > 0.01`, a warning code `aggressive_rate` is added to
the response. The server also requires `aggressive_rate_acknowledged = true` in the
`start-goal-phase` request body; without it, the request is rejected with HTTP 422,
error code `AGGRESSIVE_RATE_UNACKNOWLEDGED`.

This threshold (1% of body weight per week) is a commonly cited guideline in the strength
and body composition literature for distinguishing conservative from aggressive rates of
change. It is **not a medical recommendation**.

---

## Age Calculation

Age is computed as **completed calendar years** using the UTC midday of the birth date and
the calculation date. If the user's birthday has not yet occurred in the current year,
age = (current year − birth year − 1).

Minimum age: 18 years. The Mifflin–St Jeor equation is validated for adults only.

---

## Immutable Calculation Snapshots

Every call to `start-goal-phase` that produces a calorie target creates a row in
`calorie_target_snapshots`. This table:

- Has no `UPDATE` or `DELETE` RLS policy — rows are write-once.
- Records all inputs (birth date, sex, height, weight, activity level, algorithm versions).
- Records all intermediate outputs (BMR, TDEE, maintenance source, daily adjustment).
- Is linked to the goal phase via a circular FK resolved in the same transaction
  (`fn_start_goal_phase_v2`).

The snapshot preserves what the server knew at the moment of phase creation. Subsequent
profile changes (new height, new activity level) do not alter past snapshots.

---

## Versioning

All algorithm constants are tagged with a version identifier stored in the snapshot:

| Field                      | Current value          | Meaning                         |
|---------------------------|----------------------|--------------------------------|
| `algorithm_version`        | `mifflin_st_jeor_v1` | BMR equation identity           |
| `activity_multiplier_version` | `activity_multiplier_v1` | Multiplier table identity  |

Both versions are frozen in `scienceConfig.ts` (backend) and mirrored in
`web/src/lib/scienceConfig.ts` (frontend). Bump both strings together if any constant changes.

---

## What Is Out of Scope (Phase 6)

The following are **not** implemented in Phase 5:

- EWMA weight smoothing
- Adaptive maintenance (dynamic adjustment based on observed weight change)
- Plateau detection
- Regression-based trend modelling
- Dynamic calorie target updates mid-phase
- Waist-to-height ratio or body composition estimates
- Hall metabolic model

---

## Endpoints

### `POST /functions/v1/preview-energy-calc`

Read-only. Returns the full energy breakdown for the authenticated user's current profile and
most recent official weight. No goal phase is created or mutated.

**Request body:**
```json
{
  "goal_mode": "cut",
  "target_change_kg_per_week": -0.5,
  "activity_level": "moderate",
  "manual_maintenance_kcal": null,
  "aggressive_rate_acknowledged": false
}
```

**Response (success):**
```json
{
  "eligible": true,
  "missing_fields": [],
  "estimated_bmr_kcal": 1719,
  "estimated_tdee_kcal": 2664,
  "effective_maintenance_kcal": 2664,
  "maintenance_source": "equation_estimate",
  "daily_adjustment_kcal": -550,
  "recommended_target_kcal": 2114,
  "warnings": [],
  "is_aggressive_rate": false,
  "algorithm_versions": {
    "algorithm": "mifflin_st_jeor_v1",
    "activity_multiplier": "activity_multiplier_v1"
  },
  "explanation": "..."
}
```

**Response (ineligible — missing profile fields):**
```json
{
  "eligible": false,
  "missing_fields": ["height_cm", "official_weight_kg"],
  "instructions": "Complete your profile..."
}
```

### `POST /functions/v1/start-goal-phase`

Creates a goal phase with a server-derived calorie target. The caller must **not** supply
`target_calories`; the server calculates it authoritatively from the profile + weight.

**Key Phase 5 request fields:**
```json
{
  "mode": "cut",
  "starting_weight_source": "latest_weight_log",
  "target_change_kg_per_week": -0.5,
  "activity_level": "moderate",
  "manual_maintenance_kcal": null,
  "aggressive_rate_acknowledged": false
}
```

**Response (success):**
```json
{
  "phase": { "id": "...", "target_calories": 2114, ... },
  "snapshot": { "id": "...", "final_target_kcal": 2114, "algorithm_version": "mifflin_st_jeor_v1", ... }
}
```
