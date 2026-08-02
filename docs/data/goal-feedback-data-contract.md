# Goal Feedback Data Contract

**Phase:** 8 — Plateau Detection and Cautious Goal Feedback  
**Table:** `public.goal_feedback_assessments`  
**GET endpoint:** `get-goal-feedback`  
**POST endpoint:** `save-goal-feedback-assessment`

---

## Table: `goal_feedback_assessments`

Immutable, user-scoped assessment snapshots. One row per
`(user_id, goal_phase_id, assessed_date)`.

### Schema

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | Primary key (gen_random_uuid) |
| `user_id` | `uuid` | NOT NULL | FK → `profiles.id` |
| `goal_phase_id` | `uuid` | NOT NULL | FK → `goal_phases.id` |
| `goal_mode` | `text` | NOT NULL | `cut` \| `maintenance` \| `bulk` |
| `goal_phase_started_at` | `timestamptz` | NOT NULL | Provenance: when phase started |
| `goal_target_rate_kg_per_week` | `numeric(5,3)` | NULL | Null when no target set |
| `assessed_at` | `timestamptz` | NOT NULL | Server clock at assessment time |
| `assessed_date` | `date` | NOT NULL | GENERATED from `assessed_at::DATE` |
| `progress_state` | `text` | NOT NULL | One of 11 states (see below) |
| `reason_codes` | `jsonb` | NOT NULL | Array of machine-readable strings |
| `feedback_action` | `text` | NOT NULL | One of 7 actions (see below) |
| `advisory_calorie_adjustment_kcal` | `numeric(6,1)` | NULL | Compat alias — unsigned magnitude |
| `advisory_adjustment_direction` | `text` | NULL | Compat alias — `increase` \| `decrease` |
| `suggested_adjustment_kcal` | `numeric(6,1)` | NULL | Signed canonical adjustment (negative = eat less) |
| `proposed_target_kcal` | `numeric(7,1)` | NULL | Proposed daily calorie target after adjustment |
| `adjustment_blocked_reason_codes` | `jsonb` | NOT NULL | Array of block code strings (empty when no attempt) |
| `maintenance_drift_direction` | `text` | NULL | `up` \| `down` — drift direction for `maintenance_drift` |
| `goal_attainment_ratio` | `numeric(8,4)` | NULL | Null for maintenance |
| `current_p6_status` | `text` | NOT NULL | P6 status at assessment time |
| `current_p6_confidence` | `text` | NOT NULL | `low` \| `medium` \| `high` |
| `current_p6_weekly_rate_kg` | `numeric(8,6)` | NULL | Null when no rate |
| `current_rate_lower_kg` | `numeric(8,6)` | NULL | P6 CI lower bound |
| `current_rate_upper_kg` | `numeric(8,6)` | NULL | P6 CI upper bound |
| `current_p7_status` | `text` | NULL | `usable` \| `provisional` \| `insufficient` |
| `current_p7_confidence` | `text` | NULL | `low` \| `medium` \| `high` |
| `current_p7_coverage_fraction` | `numeric(6,5)` | NULL | 0–1 |
| `historical_p6_status` | `text` | NULL | P6 status at (assessedAt − 14 days) |
| `historical_p6_confidence` | `text` | NULL | — |
| `historical_p6_weekly_rate_kg` | `numeric(8,6)` | NULL | — |
| `previous_rate_lower_kg` | `numeric(8,6)` | NULL | Historical P6 CI lower bound |
| `previous_rate_upper_kg` | `numeric(8,6)` | NULL | Historical P6 CI upper bound |
| `historical_p7_status` | `text` | NULL | — |
| `historical_p7_confidence` | `text` | NULL | — |
| `historical_p7_coverage_fraction` | `numeric(6,5)` | NULL | — |
| `current_official_weight_kg` | `numeric(6,3)` | NULL | Most-recent official weight at assessment time |
| `current_target_calories` | `numeric(7,1)` | NULL | Calorie target from the snapshot |
| `algorithm_versions` | `jsonb` | NOT NULL | `{goal_progress, goal_thresholds, energy_balance, …}` |
| `warnings` | `jsonb` | NOT NULL | Array of strings |
| `limitations` | `jsonb` | NOT NULL | Array of strings |
| `created_at` | `timestamptz` | NOT NULL | DEFAULT now() |

### Indexes

- **`idx_gfa_idempotency`** (UNIQUE) on `(user_id, goal_phase_id, assessed_date)` — enforces one saved assessment per user per phase per day.
- **`idx_gfa_user_id`** on `(user_id, created_at DESC)` — efficient per-user queries.
- **`idx_gfa_goal_phase_id`** on `(goal_phase_id)` — efficient per-phase queries.

### RLS Policies

| Policy | Action | Condition |
|---|---|---|
| `gfa_select_own` | SELECT | `auth.uid() = user_id` |
| `gfa_insert_own` | INSERT | `auth.uid() = user_id` |

No UPDATE or DELETE via user sessions. Service role handles idempotency upserts.

---

## Valid Enum Values

### Progress States (11)

```
no_active_goal_phase | insufficient_data | stale_data | on_track
slower_than_planned  | faster_than_planned | plateau_candidate | likely_plateau
opposite_direction   | maintenance_stable  | maintenance_drift
```

### Feedback Actions (7)

```
start_goal_phase | collect_more_data | keep_current_plan
review_goal_assumptions | consider_less_aggressive_goal
consider_small_calorie_adjustment | review_maintenance_drift
```

---

## GET Endpoint: `get-goal-feedback`

**Method:** `GET`  
**Auth:** Bearer JWT (required)  
**Side-effects:** None — read-only

### Response Body (`data`)

```jsonc
{
  "progress_state": "on_track",                    // ProgressState
  "feedback_action": "keep_current_plan",          // FeedbackAction
  "reason_codes": ["rate_within_band"],             // string[]

  // Canonical signed fields (v2)
  "suggested_adjustment_kcal": null,               // number | null — negative = decrease
  "proposed_target_kcal": null,                    // number | null
  "adjustment_blocked_reason_codes": [],           // string[] — empty when no attempt
  "maintenance_drift_direction": null,             // "up" | "down" | null

  // Compatibility aliases
  "advisory_calorie_adjustment_kcal": null,         // number | null — unsigned magnitude
  "advisory_adjustment_direction": null,            // "increase" | "decrease" | null

  "goal_attainment_ratio": 0.96,                   // number | null
  "goal_phase": {
    "id": "…",
    "mode": "cut",
    "started_at": "…",
    "target_change_kg_per_week": -0.5
  },
  "evidence": {
    "current": {
      "p6_status": "usable",
      "p6_confidence": "high",
      "p6_weekly_rate_kg": -0.48,
      "p6_rate_lower_kg": -0.60,              // number | null — P6 CI lower bound
      "p6_rate_upper_kg": -0.36,              // number | null — P6 CI upper bound
      "p7_status": "usable",
      "p7_confidence": "high",
      "p7_coverage_fraction": 0.86
    },
    "historical_14d": { /* same shape */ }
  },
  "assessed_at": "2026-05-01T10:00:00.000Z",
  "algorithm_versions": {
    "goal_progress": "goal_progress_assessment_v1",
    "goal_thresholds": "goal_progress_thresholds_v1",
    "energy_balance": "observed_maintenance_energy_balance_v1",
    "nutrition_quality": "maintenance_nutrition_quality_v1",
    "confidence": "observed_maintenance_confidence_v1"
  },
  "warnings": [],
  "limitations": ["This assessment is based on observed weight change…"]
}
```

### Error Codes

| HTTP | Code | When |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Missing or invalid JWT |

---

## POST Endpoint: `save-goal-feedback-assessment`

**Method:** `POST`  
**Auth:** Bearer JWT (required)  
**Body:** `{ "goal_phase_id": "<uuid>" }`

The server **always recalculates** the assessment before saving.
Frontend-supplied calculation values are ignored.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `goal_phase_id` | `string (uuid)` | Yes | Must match the user's active goal phase |

### Response Body (`data`)

```jsonc
{
  "assessment_id": "…",           // uuid of the saved row
  "created_at": "…",              // ISO timestamp
  "progress_state": "on_track",
  "feedback_action": "keep_current_plan",
  "advisory_calorie_adjustment_kcal": null,
  "advisory_adjustment_direction": null,
  "goal_attainment_ratio": 0.96
}
```

### Error Codes

| HTTP | Code | When |
|---|---|---|
| 400 | `INVALID_PARAM` | Missing `goal_phase_id` |
| 401 | `UNAUTHENTICATED` | Missing or invalid JWT |
| 422 | `NO_ACTIVE_PHASE` | No active goal phase found |
| 422 | `PHASE_MISMATCH` | `goal_phase_id` does not match active phase |
| 500 | `DB_ERROR` | Database write failed |

### Idempotency

Repeated calls on the same calendar day (user local time) for the same
`goal_phase_id` upsert the existing row rather than inserting a new one.
The idempotency key is `(user_id, goal_phase_id, assessed_date)`.

---

## Security

- User ID comes only from the verified JWT. No client-supplied user ID is accepted.
- Server clock is used for `assessed_at`. No client-supplied timestamp is accepted.
- The server recalculates before saving. Frontend-supplied state, rates, or adjustment values are never persisted.
- Saving does not alter `goal_phases`, `calorie_target_snapshots`, or any calorie target.
- No JWTs, keys, passwords, or full private rows are logged.
