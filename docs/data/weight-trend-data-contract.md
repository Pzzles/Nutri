# Weight Trend Data Contract

**Version:** weight_trend_spec_v1  
**Status:** Gate 1 frozen

---

## Input

### RawEntry

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique row identifier |
| `measured_at` | ISO-8601 string | yes | Must include timezone offset or `Z` |
| `weight_kg` | number | yes | Must satisfy `isFinite(v) && v > 0` |
| `is_official` | boolean | yes | Set by `fn_log_weight` |
| `notes` | string \| null | no | Not used in calculations |

### Call parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `raw_entries` | RawEntry[] | — | All entries; pipeline applies window internally |
| `now_iso` | ISO-8601 string | — | Fixed reference point; never use server-local `now()` in tests |
| `timezone` | IANA string | `"Africa/Johannesburg"` | User's effective timezone |
| `window_days` | integer | `28` | Rolling window in calendar days |

---

## Output

```json
{
  "status": "usable",

  "algorithm_versions": {
    "daily_representative": "weight_daily_representative_v1",
    "smoothing":            "weight_time_ewma_v1",
    "rate":                 "weight_rate_theil_sen_v1",
    "confidence":           "weight_trend_confidence_v1"
  },

  "timezone": "Africa/Johannesburg",

  "window": {
    "start":                   "2026-07-04T05:00:00Z",
    "end":                     "2026-07-31T05:00:00Z",
    "elapsed_days":            27.0,
    "inclusive_calendar_days": 28
  },

  "measurements": {
    "raw_count":               26,
    "valid_count":             26,
    "distinct_modelling_days": 24,
    "excluded_count":          0,
    "latest_measured_at":      "2026-07-31T05:00:00Z",
    "largest_gap_days":        2.020833
  },

  "latest_raw_weight_kg":      102.6,
  "latest_trend_weight_kg":    103.545921,

  "weekly_rate": {
    "estimate_kg":  -0.700426,
    "lower_kg":     -0.858090,
    "upper_kg":     -0.583333
  },

  "confidence":  "medium",
  "warnings":    [],

  "daily_representatives": [
    {
      "local_date":  "2026-07-04",
      "measured_at": "2026-07-04T05:00:00Z",
      "weight_kg":   105.4,
      "source":      "official",
      "warnings":    []
    }
  ],

  "trend_points": [
    {
      "local_date":      "2026-07-04",
      "measured_at":     "2026-07-04T05:00:00Z",
      "raw_weight_kg":   105.4,
      "trend_weight_kg": 105.4,
      "alpha":           null,
      "delta_t_days":    null
    }
  ],

  "flagged_measurements": [],

  "ols_diagnostic": {
    "slope_per_day":  -0.10276729,
    "weekly_rate_kg": -0.71937103,
    "r_squared":      0.912641
  }
}
```

---

## Field Definitions

### `status`

| Value | Meaning |
|---|---|
| `insufficient_measurements` | Fewer than 4 distinct modelling days |
| `insufficient_coverage` | Fewer than 7 days elapsed coverage |
| `provisional` | 4–5 days OR 7–13 days coverage |
| `usable` | ≥ 6 days, ≥ 14 days coverage, ≤ 14 days recency |
| `stale` | Latest measurement > 14 days ago |

### `window`

- `start`: `measured_at` of the earliest daily representative in the window
- `end`: `measured_at` of the latest daily representative
- `elapsed_days`: fractional days from `start` to `end`
- `inclusive_calendar_days`: count of distinct SAST calendar dates from first to last, inclusive

### `measurements`

- `raw_count`: total input rows passed to the pipeline
- `valid_count`: rows passing validity filter (finite, positive)
- `distinct_modelling_days`: count of daily representatives after consolidation
- `excluded_count`: rows failing validity filter
- `largest_gap_days`: fractional elapsed days of the longest gap between consecutive representatives

### `latest_raw_weight_kg`

The `weight_kg` of the most recent daily representative. Not smoothed.

### `latest_trend_weight_kg`

The EWMA trend weight at the final modelling point. Rounded to 6 decimal places in output.

### `weekly_rate`

All values in kg/week. `null` if fewer than 4 distinct modelling days.
`lower_kg` and `upper_kg` are `null` if fewer than 6 distinct modelling days (bootstrap minimum).

### `confidence`

`"low" | "medium" | "high"`. See specification §9 for scoring rules.

### `warnings`

String array. Possible values:

| Warning | Meaning |
|---|---|
| `insufficient_measurements` | < 4 modelling days |
| `insufficient_coverage` | < 7 days coverage |
| `stale_data` | > 14 days since latest measurement |
| `large_gap` | Any gap > 21 days |
| `multiple_official_entries` | Day with > 1 official row (date prefixed) |
| `no_valid_entries` | Day with no valid entries (date prefixed) |

### `daily_representatives`

One object per modelling day, sorted ascending by `local_date`.

`source` values: `"official"` | `"median"` | `"latest_official_of_multiple"`

### `trend_points`

One object per modelling day, sorted ascending. Includes `alpha` and `delta_t_days` for auditability.
First point has `alpha: null` and `delta_t_days: null` (initialisation point).

### `flagged_measurements`

Array of `id` strings for entries excluded from modelling due to validity failures.

### `ols_diagnostic`

OLS slope on the same (x=elapsed_days, y=representative_weight) pairs. Not the authoritative estimate. Included for reference and regression testing.

---

## Separation of Concerns

```
raw_entries        — immutable source; never modified
  ↓ validity filter
valid_entries      — finite, positive weight_kg only
  ↓ window filter
windowed_entries   — within rolling window_days of now
  ↓ SAST grouping + representative selection
daily_representatives — one per SAST calendar day
  ↓
  ├─ Pipeline A: time-aware EWMA → trend_points, latest_trend_weight_kg
  └─ Pipeline B: Theil-Sen      → weekly_rate (estimate + CI)
```

Pipelines A and B operate on the same `daily_representatives`. They do not feed into each other.
