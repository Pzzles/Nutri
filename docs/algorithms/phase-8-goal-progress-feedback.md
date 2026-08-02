# Phase 8 — Goal Progress Feedback Algorithm

**Algorithm:** `goal_progress_assessment_v1`  
**Thresholds:** `goal_progress_thresholds_v1`  
**Module:** `supabase/functions/_shared/goalProgressAssessment.ts`

---

## Purpose

Phase 8 periodically assesses whether the user's observed weight-change rate is
consistent with their goal target, and provides a cautious, evidence-gated
feedback action to guide next steps.

The assessment is **advisory only**. No calorie target, goal phase, or nutrition
data is modified by this module or its endpoints.

---

## Inputs

The module receives pre-computed Phase 6 (weight trend) and Phase 7 (adaptive
maintenance) evidence for two time points:

| Field | Source |
|---|---|
| `goalMode` | `goal_phases.mode` |
| `goalTargetRateKgPerWeek` | `goal_phases.target_change_kg_per_week` |
| `goalPhaseStartedAt` | `goal_phases.started_at` |
| `assessedAt` | Server clock at assessment time |
| `currentP6*` | P6 run against all data up to now |
| `currentP7*` | P7 run against the P6 analysis window (now) |
| `historicalP6*` | P6 run against data up to (now − 14 days) |
| `historicalP7*` | P7 run against P6 window at (now − 14 days) |

---

## Progress States

States are evaluated in priority order (first match wins):

| Priority | State | Trigger |
|---|---|---|
| 1 | `no_active_goal_phase` | `goalMode === null` |
| 2 | `stale_data` | P6 status is `stale` |
| 3 | `insufficient_data` | P6 status insufficient, no rate, or no target |
| 4 | `maintenance_stable` | Maintenance mode, `|rate| ≤ 0.10 kg/week` or P6 range includes zero |
| 5 | `maintenance_drift` | Maintenance mode, `|rate| > band` AND P6 range fully excludes zero |
| 6 | `likely_plateau` | Cut, rate near zero, persistent across 14 days (P7 quality required for historical evidence) |
| 7 | `plateau_candidate` | Cut, rate near zero, current evidence only |
| 8 | `opposite_direction` | P6 range fully excludes zero in the direction opposite to goal |
| 9 | `on_track` | Target rate inside P6 range OR attainment ratio 0.70–1.30 |
| 10 | `slower_than_planned` | Attainment ratio < 0.70, or rate sign opposite without range confirmation |
| 11 | `faster_than_planned` | Attainment ratio > 1.30 |

---

## Near-Zero Band

The band is used both for plateau detection (rate stalling near zero) and for
the on-track window (rate near target):

```
band = max(0.10, |target_rate| × 0.20)   for cut / bulk
band = 0.10                               for maintenance
```

---

## Plateau Detection

### plateau_candidate criteria (all must hold)

1. `goalMode === "cut"`
2. Phase age ≥ 28 days
3. P6 status is `usable` or `provisional`
4. P6 confidence is `medium` or `high`
5. P7 status is `usable` or `provisional`
6. `|observed_rate| ≤ band`

### likely_plateau criteria (all must hold)

All `plateau_candidate` criteria **plus**:

1. Phase age ≥ 42 days
2. Historical evidence (at now − 14 days) also qualifies as `plateau_candidate`, with the additional requirement that historical P7 confidence is `medium` or `high` AND historical P7 coverage fraction ≥ 0.70
3. Current P7 status is `usable` (not just provisional)
4. Current P7 confidence is `medium` or `high`
5. Current P7 coverage fraction ≥ 0.70

---

## Advisory Calorie Adjustment

An advisory adjustment is computed for `likely_plateau`, `opposite_direction`, and `maintenance_drift`. It is **not** computed for `plateau_candidate` or `slower_than_planned`.

### Safety blocks (checked in order)

If any block fires, `suggested_adjustment_kcal` is null and the block codes appear in `adjustment_blocked_reason_codes`:

| Code | Condition |
|---|---|
| `missing_current_target` | No calorie target available |
| `missing_official_weight` | No official weight log available |
| `low_weight_confidence` | P6 confidence is `low` |
| `low_maintenance_confidence` | P7 confidence is `low` |
| `insufficient_nutrition_coverage` | P7 coverage < 70% |
| `aggressive_rate_warning` | Unresolved aggressive-rate warning on the snapshot |
| `rate_exceeds_one_percent_body_weight` | Required rate correction > 1% body weight/week |
| `required_correction_below_minimum` | Corrected amount < 100 kcal/day |
| `proposed_target_below_floor` | Proposed target < 1 000 kcal/day (not clamped — blocked) |
| `evidence_conflict` | P7 maintenance CI fully excludes the current calorie target in the direction contrary to the goal |

### Formula

```
required_daily = (target_rate − observed_rate) × 7700 / 7
step           = required_daily × 0.50
rounded        = round(step / 50) × 50
magnitude      = clamp(|rounded|, 100, 250)
signed         = magnitude × sign(required_daily)   # negative = decrease intake
proposed       = current_target + signed
```

`suggested_adjustment_kcal` is signed (negative = eat less). `advisory_calorie_adjustment_kcal` is the unsigned magnitude for backwards compatibility. `proposed_target_kcal` is the resulting daily target.

The half-step (`× 0.50`) implements cautious, incremental adjustment rather than
correcting the full deficit in one go.

The advisory is **never saved to the goal phase**. Any actual calorie-target
change requires explicit user confirmation through the goal flow.

---

## Feedback Actions

| State | Action |
|---|---|
| `no_active_goal_phase` | `start_goal_phase` |
| `insufficient_data`, `stale_data` | `collect_more_data` |
| `on_track`, `maintenance_stable` | `keep_current_plan` |
| `faster_than_planned` (cut) | `consider_less_aggressive_goal` |
| `faster_than_planned` (bulk) | `review_goal_assumptions` |
| `maintenance_drift` | `review_maintenance_drift` |
| `slower_than_planned` | `review_goal_assumptions` |
| `plateau_candidate` | `collect_more_data` |
| `opposite_direction`, `likely_plateau` | `consider_small_calorie_adjustment` |

---

## Goal Attainment Ratio

```
goal_attainment_ratio = observed_rate / target_rate
```

- Positive ratio means progress is in the same direction as the goal.
- Null for maintenance mode or when target/rate is unavailable.
- Values > 1.0 mean faster than planned; values near 0 mean stalled.

---

## Constants

| Constant | Value |
|---|---|
| `ENERGY_PER_KG_KCAL` | 7 700 kcal/kg |
| `PLATEAU_CANDIDATE_MIN_AGE_DAYS` | 28 |
| `LIKELY_PLATEAU_MIN_AGE_DAYS` | 42 |
| `ADJ_ELIGIBLE_MIN_COVERAGE` | 0.70 |
| `BAND_MULTIPLIER` | 0.20 |
| `BAND_FLOOR_KG` | 0.10 kg/week |
| `MAINTENANCE_BAND_KG` | 0.10 kg/week |
| `ADJ_MIN_KCAL` | 100 kcal/day |
| `ADJ_MAX_KCAL` | 250 kcal/day |
| `ADJ_ROUND_TO` | 50 kcal |

---

## Limitations (always returned)

- Assessment based on observed weight change and self-reported food intake.
- Advisory only — does not constitute medical or dietary advice.
- No calorie target changed by this assessment.
- Short-term fluctuations (water, glycogen, hormonal) may affect observed rate.
- Advisory adjustments are indicative only; individual metabolic responses vary.
- Does not diagnose metabolic adaptation or inaccurate logging.
