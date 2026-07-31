# Phase 5 — Measurement and Calculation Data Contract

This document is the authoritative reference for how every Phase 5 input is
collected, stored, labelled, and retained. It exists so that future phases
(adaptive maintenance, plateau detection, EWMA smoothing) can trust that the
inputs they read were what they claim to be.

---

## Guiding Principles

1. **No silent defaults.** Every required input must be explicitly present before
   a calculation proceeds. The server reports each absent field individually.

2. **Provenance over inference.** Every stored value records whether it was
   *measured*, *user-selected*, *manually estimated*, or *calculated*. These
   categories are never mixed.

3. **Immutability of snapshots.** The inputs and outputs frozen at phase-creation
   time cannot be rewritten by subsequent profile changes or re-calculations.

4. **Calculated values are clearly labelled.** API responses use the prefix
   `estimated_` or `calculated_` for equation outputs (BMR, TDEE). They are
   never presented as facts or guarantees.

5. **Measured and calculated values remain distinct.** Clients must never confuse
   a scale reading (measured) with a formula output (calculated). The
   `input_provenance` field in both responses and snapshots encodes this.

---

## Data Dictionary

### Profile fields consumed by Phase 5

| Field           | Type      | Source category  | Update frequency | Validation           |
|-----------------|-----------|-----------------|-----------------|----------------------|
| `birth_date`    | DATE      | user_selected    | One-time        | Must exist; yields age ≥ 18 |
| `sex`           | TEXT      | user_selected    | Rarely changes  | `'male'` or `'female'` only |
| `height_cm`     | NUMERIC   | user_selected    | Rarely changes  | > 0                  |
| `activity_level`| TEXT      | user_selected    | Occasionally    | One of 5 valid levels |

These fields are stored in `profiles` and frozen into `calorie_target_snapshots`
at phase-creation time.

### Weight log fields consumed by Phase 5

| Field         | Type       | Source category | Update frequency | Validation                 |
|---------------|-----------|----------------|-----------------|----------------------------|
| `weight_kg`   | NUMERIC    | measured        | Daily or weekly | > 0; ≤ 500                |
| `measured_at` | TIMESTAMPTZ| measured        | Per log entry   | Must be a valid timestamp  |
| `is_official` | BOOLEAN    | user_selected   | Per log entry   | Must be `true` to be used  |
| `source`      | TEXT       | system          | Per log entry   | e.g. `'manual'`, `'sync'` |

The latest `is_official=true` weight log is used. Both its value and its
`measured_at` timestamp are frozen in the snapshot.

### Phase-form fields

| Field                     | Type    | Source category    | Notes                              |
|--------------------------|---------|-------------------|-------------------------------------|
| `activity_level`          | TEXT    | user_selected      | Overrides profile value for this phase if supplied |
| `manual_maintenance_kcal` | NUMERIC | manually_estimated | Optional; overrides equation estimate |
| `goal_mode`               | TEXT    | user_selected      | `'cut'`, `'maintenance'`, or `'bulk'` |
| `target_change_kg_per_week`| NUMERIC | user_selected      | Required for non-maintenance phases |

---

## Provenance Categories

Every input stored in `calorie_target_snapshots.input_provenance` carries one of
these four source types:

| source_type          | Meaning                                                     | Examples                                 |
|---------------------|-------------------------------------------------------------|------------------------------------------|
| `measured`          | A physical reading taken by a device or person              | Body weight from a scale                 |
| `user_selected`     | An option explicitly chosen by the user                     | Activity level, goal mode, birth date    |
| `manually_estimated`| A number the user typed as an estimate of a real quantity   | Manual maintenance override              |
| `calculated`        | Derived from other inputs by a formula                      | BMR, TDEE, daily adjustment, final target|
| `inferred`          | Derived by the system without user confirmation             | Not used in Phase 5; reserved for Phase 6|

The `input_provenance` JSONB column has this shape:

```json
{
  "weight": {
    "source_type": "measured",
    "log_source":  "manual",
    "measured_at": "2026-07-31T06:45:00.000Z"
  },
  "activity_level": {
    "source_type":  "user_selected",
    "provided_via": "goals_form | profile_field"
  },
  "maintenance": {
    "source_type":  "manually_estimated",
    "provided_via": "goals_form_override"
  },
  "bmr": {
    "source_type": "calculated",
    "algorithm":   "mifflin_st_jeor_v1"
  },
  "tdee": {
    "source_type": "calculated",
    "algorithm":   "activity_multiplier_v1"
  },
  "final_target": {
    "source_type": "calculated"
  }
}
```

`maintenance` is only present when a manual override was supplied.

---

## Input Readiness Response

`POST /functions/v1/preview-energy-calc` returns a structured readiness object
before any calculation. Clients must check `ready` before reading calculation
fields.

```json
{
  "ready": false,
  "missing_fields": [
    {
      "field":  "height_cm",
      "reason": "Required for the BMR formula",
      "action": "complete_profile_height"
    }
  ],
  "stale_fields": [
    {
      "field":       "official_weight",
      "recorded_at": "2026-05-01T06:00:00.000Z",
      "days_old":    91,
      "action":      "log_current_weight"
    }
  ],
  "data_quality": {
    "profile_complete":     true,
    "weight_current":       false,
    "calculation_possible": false
  }
}
```

### `missing_fields`

One entry per absent required input. Fields are reported individually —
never merged into a single string — so UIs can route the user to the right
screen for each gap.

| `field`                    | `action`                      |
|---------------------------|-------------------------------|
| `birth_date`               | `complete_profile_birth_date` |
| `equation_sex`             | `complete_profile_sex`        |
| `height_cm`                | `complete_profile_height`     |
| `activity_level`           | `select_activity_level`       |
| `official_weight_kg`       | `log_official_weight`         |
| `goal_mode`                | `select_goal_mode`            |
| `target_change_kg_per_week`| `enter_weekly_rate`           |

### `stale_fields`

Inputs that exist but whose freshness falls below the product threshold
(`WEIGHT_FRESHNESS_WARNING_DAYS = 30 days`). Stale fields are a warning, not a
hard rejection — `calculation_possible` may still be `true` when a stale weight
exists. A stale field is never conflated with a missing field.

### `data_quality`

| Field                   | True when                                                  |
|------------------------|------------------------------------------------------------|
| `profile_complete`      | All four profile fields are present and valid              |
| `weight_current`        | An official weight exists and was logged ≤ 30 days ago     |
| `calculation_possible`  | No required inputs are missing (stale weight still passes) |

---

## Snapshot Immutability

`calorie_target_snapshots` is write-once:

- RLS has `SELECT` and `INSERT` policies for the row owner.
- There are **no** `UPDATE` or `DELETE` policies.
- The only mutation after INSERT is the `goal_phase_id` back-reference, which is
  set in the same database transaction by `fn_start_goal_phase_v2` (runs as
  `SECURITY DEFINER`, bypassing RLS).

Consequences:
- Changing `profiles.activity_level` does not alter any historical snapshot.
- Changing or removing a `manual_maintenance_kcal` override does not alter any
  historical snapshot.
- If a `weight_logs` row is deleted, `snapshot.weight_log_id` is set to `NULL`
  by the FK `ON DELETE SET NULL`, but `snapshot.official_weight_kg` and
  `snapshot.weight_measured_at` retain the values that were used.

---

## Historical Applicability of Activity Level and Maintenance Override

**Phase 5:** Snapshot immutability is sufficient. Each snapshot records the
activity level and manual maintenance that applied at phase-creation time.
Profile changes afterward do not invalidate existing snapshots.

**Phase 6 (future):** When adaptive maintenance requires querying activity level
across time periods (e.g. "what was the user's activity level from Jan–Mar?"),
an `activity_level_history` effective-dated table will be added. That table is
outside the scope of Phase 5.

---

## Weight Freshness

The product threshold is `WEIGHT_FRESHNESS_WARNING_DAYS = 30`, defined in
`supabase/functions/_shared/scienceConfig.ts`.

| Scenario                         | Behaviour                                      |
|---------------------------------|------------------------------------------------|
| Weight ≤ 30 days old             | `data_quality.weight_current = true`; no warning |
| Weight > 30 days old             | Appears in `stale_fields`; calculation still proceeds |
| No official weight at all        | Appears in `missing_fields`; `ready = false`    |

There is no hard block for stale weight in Phase 5. A user who hasn't weighed in
for two months can still start a goal phase — their stale weight is used with a
visible warning.

---

## Daily Log Completeness

The `daily_log_status` table records whether each day was explicitly closed:

| Status     | Meaning                                                             |
|-----------|---------------------------------------------------------------------|
| `unknown`  | The day was never opened or no explicit status was set              |
| `partial`  | Meals were logged but the day was not marked complete               |
| `complete` | The user explicitly marked this day as complete                     |

An `unknown` or `partial` day with 900 kcal logged is **not** the same as a
`complete` day with 900 kcal logged. Phase 6 adaptive maintenance algorithms
**must** filter by `status = 'complete'` before including a day's intake in any
trend or maintenance estimate. Incomplete days are excluded, not averaged down.

Phase 6 will extend these states to `probably_complete`, `not_logged`, and
`fasting` to allow finer-grained filtering. The current `partial` state maps
to the future `incomplete`.

---

## Retention Behaviour

| Table                      | Retention policy                                              |
|---------------------------|---------------------------------------------------------------|
| `calorie_target_snapshots` | Permanent — no expiry, no soft-delete                         |
| `weight_logs`              | Permanent (user can delete manually via the Weight page)      |
| `goal_phases`              | Permanent (ended phases become history records)               |
| `daily_log_status`         | Permanent per-day rows; status can be updated by the user     |
| `profiles`                 | Permanent; values can be updated but not deleted per-field    |

---

## Validation Rules Summary

| Field                     | Rule                                          | Error code            |
|--------------------------|-----------------------------------------------|-----------------------|
| `final_target_kcal`       | Must be ≥ 1000 kcal/day                        | `TARGET_BELOW_FLOOR`  |
| `target_change_kg_per_week`| \|rate\| / weight_kg > 0.01 → warning          | `AGGRESSIVE_RATE_UNACKNOWLEDGED` (if no ack) |
| `manual_maintenance_kcal` | Must be in [500, 10 000] if supplied           | `VALIDATION_ERROR`    |
| `target_calories` in body | Must **not** be supplied by the client         | `FORBIDDEN_FIELD`     |
| `equation_sex`            | Must be `'male'` or `'female'`                 | `VALIDATION_ERROR`    |
| `age_years`               | Must be ≥ 18                                   | `VALIDATION_ERROR`    |
| `height_cm`               | Must be > 0                                    | `VALIDATION_ERROR`    |
| `weight_kg`               | Must be > 0                                    | `VALIDATION_ERROR`    |

---

## Algorithm Versioning

All frozen constants are tagged with a version string stored in
`calorie_target_snapshots.config_versions`:

```json
{
  "algorithm":           "mifflin_st_jeor_v1",
  "activity_multiplier": "activity_multiplier_v1"
}
```

If any constant changes (e.g. a multiplier is updated), **both** version strings
must be bumped together in `supabase/functions/_shared/scienceConfig.ts` and its
frontend mirror `web/src/lib/scienceConfig.ts`. Bumping the version creates a
clear audit trail: snapshots with the old version used the old constants; new
snapshots use the new ones.

---

## What Is Out of Scope (Phase 6)

This contract covers only Phase 5 inputs. The following are deferred:

- EWMA weight smoothing (smoothed weight as a `calculated` input replacing raw weight)
- Adaptive maintenance (a `calculated` maintenance value derived from observed
  weight change over time)
- Plateau detection trigger conditions
- Effective-dated activity-level history table
- `probably_complete`, `not_logged`, and `fasting` daily-log states
