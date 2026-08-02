# Anthropometric Progress Data Contract

**Phase:** 10 — Anthropometric Progress Tracking<br>
**Contract:** `anthropometry_data_contract_v1`<br>
**Protocol:** `anthropometry_protocol_v1`<br>
**Status:** Gate 1 frozen; proposed schema for later implementation

## 1. Contract principles

- Raw readings are first-class immutable records.
- Finalisation is atomic; no server-side draft is persisted in v1.
- Representatives and quality classifications are calculated only by the server.
- Site codes carry explicit landmark semantics defined in the Phase 10 specification.
- `waist` and `abdomen_navel`, and every left/right limb site, remain distinct.
- Missing sites produce no row and no point. `null` means unavailable; zero is never a missing sentinel.
- Finalised sessions are not edited or deleted during normal account use.
- Dates and values are never interpolated, forward-filled, or smoothed.
- Every response identifies the protocol, calculation, and threshold versions used.

## 2. Proposed relational model

Implementation will create dedicated tables. Column types and constraints below are frozen unless a later prompt documents and versions a necessary correction.

### 2.1 `anthropometric_sessions`

| Column | Type | Null | Contract |
|---|---|---:|---|
| `id` | `uuid` | no | Primary key, server generated |
| `user_id` | `uuid` | no | FK to `profiles(id) ON DELETE CASCADE` |
| `measured_at` | `timestamptz` | no | User-supplied observation time, validated by server |
| `logged_date` | `date` | no | Derived by server in the effective profile timezone |
| `timezone` | `text` | no | Effective IANA timezone frozen at finalisation |
| `notes` | `text` | yes | Optional user note, maximum 500 characters |
| `protocol_version` | `text` | no | `anthropometry_protocol_v1` |
| `representative_algorithm_version` | `text` | no | `anthropometry_representative_v1` |
| `thresholds_version` | `text` | no | `anthropometry_repeatability_thresholds_v1` |
| `idempotency_key` | `text` | no | User-scoped, 1–128 characters |
| `payload_hash` | `text` | no | Server-generated canonical request hash for conflict detection |
| `finalized_at` | `timestamptz` | no | Server clock; establishes finalised state |
| `created_at` | `timestamptz` | no | Server default |

Required indexes/constraints:

- unique `(user_id, idempotency_key)`;
- index `(user_id, measured_at DESC, id DESC)`;
- `measured_at <= server_now + 5 minutes` enforced in finalisation logic;
- no user `UPDATE` or `DELETE` policy.

There is intentionally no `status` or draft row. Every persisted session is finalised.

### 2.2 `anthropometric_readings`

| Column | Type | Null | Contract |
|---|---|---:|---|
| `id` | `uuid` | no | Primary key, server generated |
| `session_id` | `uuid` | no | FK to session `ON DELETE CASCADE` |
| `site_code` | `text` | no | One frozen site code |
| `reading_number` | `smallint` | no | `1`, `2`, or conditionally `3` |
| `value_cm` | `numeric(5,1)` | no | Raw user reading, 5.0–300.0 inclusive |
| `created_at` | `timestamptz` | no | Server default |

Required constraints:

- unique `(session_id, site_code, reading_number)`;
- `site_code` is one of `chest`, `waist`, `abdomen_navel`, `hips`, `left_upper_arm_relaxed`, `right_upper_arm_relaxed`, `left_mid_thigh`, `right_mid_thigh`, `neck`;
- raw values and reading numbers cannot be updated;
- user access is read-only through ownership of the parent session.

Reading rows preserve request order by `reading_number`. The server must not replace them with their mean or median.

### 2.3 `anthropometric_representatives`

| Column | Type | Null | Contract |
|---|---|---:|---|
| `session_id` | `uuid` | no | Composite PK/FK to session `ON DELETE CASCADE` |
| `site_code` | `text` | no | Composite PK; matches readings |
| `representative_cm` | `numeric(5,2)` | no | Server-authoritative mean or median |
| `method` | `text` | no | `mean_of_two` or `median_of_three` |
| `reading_count` | `smallint` | no | `2` or `3` |
| `initial_pair_difference_cm` | `numeric(4,1)` | no | Absolute difference of readings 1 and 2 |
| `all_readings_range_cm` | `numeric(4,1)` | no | Maximum minus minimum across stored readings |
| `quality` | `text` | no | `within_repeatability_threshold` or `repeatability_warning` |
| `algorithm_version` | `text` | no | `anthropometry_representative_v1` |
| `created_at` | `timestamptz` | no | Server default |

Required constraints:

- primary key `(session_id, site_code)`;
- a representative must have exactly the raw readings required by its method;
- representatives cannot be directly inserted, updated, or deleted by user clients.

## 3. RLS and mutation boundary

Users may select their own sessions and related rows. Clients do not receive table-level mutation rights for any of the three tables. An authenticated finalisation endpoint calls one transaction/RPC that verifies `auth.uid()`, validates the request, computes representatives, and inserts the complete graph.

There is no normal endpoint to update or delete a finalised session. Service-role access must not expose an edit path. Account deletion remains allowed and deletes the parent user/session graph. A future administrative repair, if ever required, must be separately authorised and audited; it is outside v1.

## 4. Finalisation endpoint

### `POST /functions/v1/finalize-anthropometric-session`

Request:

```json
{
  "idempotency_key": "3d16dc2f-617a-4e43-8550-89999e2ec9ae",
  "protocol_version": "anthropometry_protocol_v1",
  "measured_at": "2026-08-02T06:30:00+02:00",
  "notes": "Morning, before breakfast",
  "sites": [
    { "site_code": "waist", "readings_cm": [88.2, 88.6] },
    { "site_code": "abdomen_navel", "readings_cm": [91.0, 92.2, 91.3] }
  ]
}
```

The request must not contain `representative_cm`, `change_cm`, quality, weight data, algorithm output, or user ID. Unknown fields are rejected with `FORBIDDEN_FIELD` rather than silently ignored when they could impersonate calculated data.

Success: `201 Created` on first finalisation and `200 OK` on an identical idempotent replay.

```json
{
  "success": true,
  "data": {
    "session": {
      "id": "0ad50822-6991-43a7-b856-e675d6285c41",
      "measured_at": "2026-08-02T04:30:00.000Z",
      "logged_date": "2026-08-02",
      "timezone": "Africa/Johannesburg",
      "notes": "Morning, before breakfast",
      "finalized_at": "2026-08-02T04:32:00.000Z"
    },
    "sites": [
      {
        "site_code": "waist",
        "readings_cm": [88.2, 88.6],
        "representative_cm": 88.4,
        "method": "mean_of_two",
        "initial_pair_difference_cm": 0.4,
        "all_readings_range_cm": 0.4,
        "quality": "within_repeatability_threshold"
      },
      {
        "site_code": "abdomen_navel",
        "readings_cm": [91.0, 92.2, 91.3],
        "representative_cm": 91.3,
        "method": "median_of_three",
        "initial_pair_difference_cm": 1.2,
        "all_readings_range_cm": 1.2,
        "quality": "repeatability_warning"
      }
    ],
    "algorithm_versions": {
      "data_contract": "anthropometry_data_contract_v1",
      "protocol": "anthropometry_protocol_v1",
      "representative": "anthropometry_representative_v1",
      "repeatability_thresholds": "anthropometry_repeatability_thresholds_v1"
    }
  },
  "error": null
}
```

### 4.1 Validation errors

All failures use the standard Nutri envelope. Required stable codes:

| Code | Condition |
|---|---|
| `UNAUTHENTICATED` | Missing/invalid user session |
| `METHOD_NOT_ALLOWED` | Method is not POST |
| `UNSUPPORTED_PROTOCOL_VERSION` | Client protocol version is not current/supported |
| `VALIDATION_ERROR` | Missing key/time/sites, invalid notes, or malformed structure |
| `UNKNOWN_SITE` | Site code is not in the frozen dictionary |
| `DUPLICATE_SITE` | A site appears twice in one request |
| `READING_OUT_OF_RANGE` | Raw reading is outside 5.0–300.0 cm |
| `INVALID_READING_PRECISION` | Raw reading has precision finer than 0.1 cm |
| `THIRD_READING_REQUIRED` | First pair differs by > 1.0 cm and only two readings were sent |
| `UNEXPECTED_THIRD_READING` | First pair differs by ≤ 1.0 cm but a third was sent |
| `INVALID_READING_COUNT` | Reading count is not 2 or 3 as determined by the first pair |
| `FUTURE_MEASUREMENT` | `measured_at` exceeds the five-minute tolerance |
| `FORBIDDEN_FIELD` | Client supplied a server-authoritative field |
| `IDEMPOTENCY_CONFLICT` | Key exists with a different canonical payload |
| `INTERNAL_ERROR` | Transaction/calculation failure; no partial record persists |

## 5. History endpoint

### `GET /functions/v1/get-anthropometric-sessions`

Query parameters:

| Parameter | Default | Contract |
|---|---|---|
| `limit` | `20` | Integer 1–100 sessions |
| `before` | absent | Opaque cursor; no date interpolation |
| `site_code` | absent | Optional exact site filter |

Response sessions are ordered by `measured_at DESC, id DESC`. Each includes raw readings and representatives. Pagination operates on sessions, not child rows, so a session is never split across pages.

## 6. Progress endpoint

### `GET /functions/v1/get-anthropometric-progress`

Query parameters:

| Parameter | Default | Contract |
|---|---|---|
| `from` | absent | Optional inclusive ISO timestamp |
| `to` | server now | Inclusive ISO timestamp |
| `site_code` | all | One exact site or all sites |
| `include_weight_comparison` | `true` | Enables eligible descriptive comparison only |

Response shape:

```json
{
  "success": true,
  "data": {
    "series": [
      {
        "site_code": "waist",
        "points": [
          {
            "session_id": "uuid-a",
            "measured_at": "2026-06-07T05:00:00.000Z",
            "logged_date": "2026-06-07",
            "representative_cm": 92.1,
            "quality": "within_repeatability_threshold"
          },
          {
            "session_id": "uuid-b",
            "measured_at": "2026-08-02T05:00:00.000Z",
            "logged_date": "2026-08-02",
            "representative_cm": 88.7,
            "quality": "within_repeatability_threshold"
          }
        ],
        "previous_change": {
          "start_session_id": "uuid-a",
          "end_session_id": "uuid-b",
          "change_cm": -3.4,
          "elapsed_days": 56.0
        },
        "since_first_change": {
          "start_session_id": "uuid-a",
          "end_session_id": "uuid-b",
          "change_cm": -3.4,
          "elapsed_days": 56.0
        }
      }
    ],
    "weight_comparison": {
      "eligible": true,
      "site_code": "waist",
      "circumference": {
        "start_session_id": "uuid-a",
        "end_session_id": "uuid-b",
        "change_cm": -3.4,
        "direction": "decreased"
      },
      "weight_trend": {
        "start_point_measured_at": "2026-06-07T05:15:00.000Z",
        "end_point_measured_at": "2026-08-02T04:50:00.000Z",
        "start_kg": 80.2,
        "end_kg": 80.3,
        "change_kg": 0.1,
        "stable_band_kg": 0.5,
        "direction": "broadly_stable"
      },
      "description": "Weight trend was broadly stable while waist circumference decreased."
    },
    "algorithm_versions": {
      "change": "anthropometry_change_v1",
      "weight_comparison": "anthropometry_weight_comparison_v1",
      "weight_trend": "weight_trend_v1"
    },
    "limitations": [
      "Circumference changes can reflect combinations of fat, muscle, glycogen, fluid, digestion, breathing, posture, and measurement technique.",
      "This feature does not measure body-fat percentage, muscle mass, visceral fat, or body recomposition.",
      "The weight comparison is descriptive and does not alter calorie targets or goal feedback."
    ]
  },
  "error": null
}
```

If a comparison is not eligible, `weight_comparison` remains structured:

```json
{
  "eligible": false,
  "site_code": null,
  "circumference": null,
  "weight_trend": null,
  "description": null,
  "reason_codes": ["no_aligned_weight_endpoint"]
}
```

Stable ineligibility reason codes:

- `insufficient_circumference_points`
- `circumference_interval_too_short`
- `circumference_repeatability_warning`
- `weight_status_not_eligible`
- `weight_confidence_not_eligible`
- `insufficient_weight_trend_points`
- `no_aligned_weight_endpoint`
- `aligned_weight_points_not_distinct`
- `no_material_cross_signal_template`

## 7. Ordering, missingness, and numeric representation

- Site arrays use the frozen site order from the specification, never alphabetical order.
- Point arrays are chronological ascending; history session arrays are reverse chronological.
- JSON numbers represent centimetres. Raw values have one decimal; representatives and calculated deltas may have two.
- Database `numeric` values must be serialised as JSON numbers at the endpoint boundary, not numeric strings.
- Omitted sites do not appear in `sites`, `representatives`, or `series`.
- Empty history returns `series: []` and an ineligible comparison. It does not manufacture nine empty/zero series unless the frontend explicitly builds presentation placeholders.
- `null` is used only for a known field whose calculation is unavailable. It is never converted to `0`.

## 8. Privacy integration

The next implementation prompt must:

1. include `anthropometric_sessions`, `anthropometric_readings`, and `anthropometric_representatives` in user data export;
2. bump the export contract version because the exported shape changes;
3. remove the three tables during whole-account deletion, preferably through `profiles -> sessions -> children` cascades;
4. ensure logs never contain raw measurements, notes, JWTs, email addresses, or full user IDs;
5. return only rows owned by the authenticated user.

## 9. Version-bump rules

Bump the named version when any listed behavior changes:

| Version | Changes requiring a bump |
|---|---|
| `anthropometry_protocol_v1` | Site meaning, landmark, body position, breathing, circuit order, or input precision |
| `anthropometry_representative_v1` | Mean/median selection, tie behavior, or arithmetic/rounding |
| `anthropometry_repeatability_thresholds_v1` | Reading bounds, 1.0 cm threshold, required counts, future tolerance |
| `anthropometry_change_v1` | Point ordering, endpoint selection, elapsed-time calculation, or change calculation |
| `anthropometry_weight_comparison_v1` | Eligible sites, quality gates, 14/7-day thresholds, endpoint alignment, direction bands, or sentence templates |
| `anthropometry_data_contract_v1` | Persisted or API field semantics, missingness, idempotency, or immutability behavior |

Old finalised sessions retain their stored versions. A new algorithm does not silently recalculate or overwrite historical representatives.
