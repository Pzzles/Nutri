# Anthropometric Progress Data Contract

**Phase:** 10 — Anthropometric Progress Tracking<br>
**Current contract:** `anthropometry_data_contract_v3`<br>
**Protocol:** `anthropometry_protocol_v1`<br>
**Status:** Remediation Gate 1 hybrid representative contract implemented

> The lifecycle material below documents the original v2 implementation. For
> current representative fields, quality states, acknowledgements, and legacy
> handling, see [the v3 remediation contract](../algorithms/phase-10-anthropometric-representative-v3.md).

## 1. Contract principles

- Raw readings are first-class preserved records; they become immutable when their session is finalised.
- Draft sessions and their raw readings are persisted and owner-editable.
- Finalisation is an atomic, one-way, server-authoritative transition.
- Representatives and quality classifications are calculated only by the server.
- Site codes carry explicit landmark semantics defined in the Phase 10 specification.
- `waist` and `abdomen_navel`, and every left/right limb site, remain distinct.
- Missing sites produce no row and no point. `null` means unavailable; zero is never a missing sentinel.
- Finalised sessions are not edited or reopened; deletion requires the explicit authenticated Prompt 3 operation.
- Dates and values are never interpolated, forward-filled, or smoothed.
- Every response identifies the protocol, calculation, and threshold versions used.

## 2. Implemented relational model

Gate 2 creates these dedicated tables in migration `0031_anthropometric_progress_model.sql`. Column types and constraints below are frozen unless a later prompt documents and versions a necessary correction. The file was mechanically renumbered from `0030` after the migration-history repair branch claimed that version.

### 2.1 `anthropometric_sessions`

| Column | Type | Null | Contract |
|---|---|---:|---|
| `id` | `uuid` | no | Primary key, server generated |
| `user_id` | `uuid` | no | FK to `profiles(id) ON DELETE CASCADE` |
| `status` | `text` | no | `draft` or `finalized`; transition is one-way |
| `measured_at` | `timestamptz` | draft: yes | User-supplied observation time, required to finalise |
| `logged_date` | `date` | draft: yes | Null in drafts; derived by server at finalisation |
| `timezone` | `text` | draft: yes | Null in drafts; effective IANA timezone frozen at finalisation |
| `notes` | `text` | yes | Optional user note, maximum 500 characters |
| `data_contract_version` | `text` | no | `anthropometry_data_contract_v2` |
| `protocol_version` | `text` | no | `anthropometry_protocol_v1` |
| `representative_algorithm_version` | `text` | draft: yes | Null in drafts; current finalisations use `anthropometry_representative_v2`; historical v1 rows remain valid |
| `thresholds_version` | `text` | draft: yes | Null in drafts; current finalisations use `anthropometry_repeatability_thresholds_v2`; historical v1 rows remain valid |
| `idempotency_key` | `text` | draft: yes | Null in drafts; user-scoped 1–128 characters when finalised |
| `payload_hash` | `text` | draft: yes | Null in drafts; server-generated canonical request hash when finalised |
| `finalized_at` | `timestamptz` | draft: yes | Null in drafts; server clock at finalisation |
| `created_at` | `timestamptz` | no | Server default |
| `updated_at` | `timestamptz` | no | Updated while draft; frozen after finalisation |

Required indexes/constraints:

- unique `(user_id, idempotency_key)`;
- index `(user_id, measured_at DESC, id DESC)`;
- `measured_at <= server_now + 5 minutes` enforced in finalisation logic;
- owners may update/delete only their draft rows; direct client finalisation and finalised mutation are denied.

Draft rows cannot carry logged date, timezone, calculation versions, idempotency values, payload hash, or finalisation time. Finalised rows require all of them. Finalised rows cannot transition back to draft.

### 2.2 `anthropometric_readings`

| Column | Type | Null | Contract |
|---|---|---:|---|
| `id` | `uuid` | no | Primary key, server generated |
| `session_id` | `uuid` | no | FK to session `ON DELETE CASCADE` |
| `site_code` | `text` | no | One frozen site code |
| `reading_number` | `smallint` | no | `1`, `2`, or conditionally `3` |
| `value_cm` | `numeric(6,2)` | no | Raw user reading, 5.0–300.0 inclusive; CHECK requires an exact 0.1 cm increment rather than silently rounding |
| `created_at` | `timestamptz` | no | Server default |
| `updated_at` | `timestamptz` | no | Updated while the parent remains a draft; frozen after finalisation |

Required constraints:

- unique `(session_id, site_code, reading_number)`;
- `site_code` is one of `chest`, `waist`, `abdomen_navel`, `hips`, `left_upper_arm_relaxed`, `right_upper_arm_relaxed`, `left_mid_thigh`, `right_mid_thigh`, `neck`;
- raw values and reading numbers may be updated only while the parent session is a draft;
- ownership is resolved through the parent session; a finalised parent makes child writes unavailable.

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
| `quality_flags` | `jsonb` | no | `[]` or `["initial_pair_exceeds_repeatability_threshold"]` as fixed by the method |
| `algorithm_version` | `text` | no | `anthropometry_representative_v1` or current `anthropometry_representative_v2` |
| `created_at` | `timestamptz` | no | Server default |

Required constraints:

- primary key `(session_id, site_code)`;
- a representative must have exactly the raw readings required by its method;
- representatives cannot be directly inserted, updated, or deleted by user clients.

## 3. RLS and mutation boundary

Users may select their own sessions and related rows. RLS permits owners to create, update, and delete drafts and to manage raw readings only while the parent remains a draft. Clients receive no representative write policy and cannot directly transition a session to finalised. The Edge Function verifies the caller JWT and derives the user ID; its service-only RPC then atomically validates or replaces the owned draft, persists server-calculated representatives, and performs the one-way transition. The RPC is revoked from `anon` and `authenticated`, so clients cannot submit forged representative rows directly.

There is no update or reopen path for a finalised session. Prompt 3 adds an explicit authenticated whole-session deletion operation; deleting the parent cascades to its readings and representatives. Account deletion also deletes the graph. A future administrative repair, if ever required, must be separately authorised and audited.

## 4. Save and finalisation endpoints

### `POST /functions/v1/save-anthropometric-session`

Persists a draft when `status` is `draft`. A draft may contain zero to three raw readings per supplied site, may omit `measured_at`, and never contains representatives. Supplying `session_id` replaces that owned draft's raw-reading set atomically rather than merging stale readings. The same endpoint accepts `status: "finalized"` for clients using the unified workflow, with the same validation as the dedicated finalisation endpoint below.

### `POST /functions/v1/finalize-anthropometric-session`

Request:

```json
{
  "session_id": "optional-existing-draft-uuid",
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

`session_id` is optional. When present, it must identify an owned draft. Success is `201 Created` on first finalisation and `200 OK` on an identical idempotent replay. Concurrent identical requests are serialised by user and idempotency key and resolve to one session.

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
        "reading_count": 2,
        "initial_pair_difference_cm": 0.4,
        "all_readings_range_cm": 0.4,
        "quality": "within_repeatability_threshold",
        "quality_flags": []
      },
      {
        "site_code": "abdomen_navel",
        "readings_cm": [91.0, 92.2, 91.3],
        "representative_cm": 91.3,
        "method": "median_of_three",
        "reading_count": 3,
        "initial_pair_difference_cm": 1.2,
        "all_readings_range_cm": 1.2,
        "quality": "repeatability_warning",
        "quality_flags": ["initial_pair_exceeds_repeatability_threshold"]
      }
    ],
    "algorithm_versions": {
      "data_contract": "anthropometry_data_contract_v2",
      "protocol": "anthropometry_protocol_v1",
      "representative": "anthropometry_representative_v2",
      "repeatability_thresholds": "anthropometry_repeatability_thresholds_v2"
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
| `RETAKE_SITE_REQUIRED` | No pair among three readings agrees within 1.0 cm; the draft remains mutable and the site must be retaken |
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
| `before` | absent | Opaque `(measured_at, id)` cursor; no date interpolation |
| `site_code` | absent | Optional exact site filter |

Response sessions are ordered by `measured_at DESC, id DESC`. Each includes raw readings and representatives. Pagination operates on sessions, not child rows, so a session is never split across pages.

## 6. Deletion endpoint

### `DELETE /functions/v1/delete-anthropometric-session`

Request body: `{ "session_id": "uuid" }`. The authenticated owner may delete one complete draft or finalised session. Readings and representatives are removed by foreign-key cascade. A missing or cross-user ID returns the same `404 NOT_FOUND`, preventing ownership disclosure. This operation is deletion, not an edit or reopen path.

## 7. Progress endpoint

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

## 8. Ordering, missingness, and numeric representation

- Site arrays use the frozen site order from the specification, never alphabetical order.
- Point arrays are chronological ascending; history session arrays are reverse chronological.
- JSON numbers represent centimetres. Raw values have one decimal; representatives and calculated deltas may have two.
- Database `numeric` values must be serialised as JSON numbers at the endpoint boundary, not numeric strings.
- Omitted sites do not appear in `sites`, `representatives`, or `series`.
- Empty history returns `series: []` and an ineligible comparison. It does not manufacture nine empty/zero series unless the frontend explicitly builds presentation placeholders.
- `null` is used only for a known field whose calculation is unavailable. It is never converted to `0`.

## 9. Privacy integration

Gate 3:

1. includes `anthropometric_sessions`, `anthropometric_readings`, and `anthropometric_representatives` in `nutri_data_export_v2`;
2. removes the three tables during whole-account deletion through `profiles -> sessions -> children` cascades;
3. does not log request bodies, raw measurements, notes, JWTs, email addresses, or full user IDs;
4. constrains every service-role API query by the JWT-derived user ID.

## 10. Version-bump rules

Bump the named version when any listed behavior changes:

| Version | Changes requiring a bump |
|---|---|
| `anthropometry_protocol_v1` | Site meaning, landmark, body position, breathing, circuit order, or input precision |
| `anthropometry_representative_v2` | Mean/median selection, agreeing-pair gate, tie behavior, or arithmetic/rounding |
| `anthropometry_repeatability_thresholds_v2` | Reading bounds, 1.0 cm pair thresholds, required counts, retake gate, or future tolerance |
| `anthropometry_change_v1` | Point ordering, endpoint selection, elapsed-time calculation, or change calculation |
| `anthropometry_weight_comparison_v1` | Eligible sites, quality gates, 14/7-day thresholds, endpoint alignment, direction bands, or sentence templates |
| `anthropometry_data_contract_v2` | Persisted draft/finalised lifecycle, API field semantics, missingness, idempotency, or immutability behavior |

Old finalised sessions retain their stored versions. A new algorithm does not silently recalculate or overwrite historical representatives.
