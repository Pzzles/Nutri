# Weight Trend Data Contract

**Version:** weight_trend_spec_v1  
**Status:** Gate 1B frozen

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
    "smoothing":            "weight_time_ewma_v2",
    "rate":                 "weight_rate_theil_sen_v1",
    "interval":             "weight_rate_interval_sen_v1",
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
    "largest_gap_days":        2.020833,
    "selected_rate_window_days": 28
  },

  "latest_raw_weight_kg":      102.6,
  "latest_trend_weight_kg":    103.545921,

  "weekly_rate": {
    "estimate_kg":        -0.700426,
    "lower_kg":           -0.816667,
    "upper_kg":           -0.612500,
    "bootstrap_lower_kg": -0.855061,
    "bootstrap_upper_kg": -0.592308
  },

  "confidence":  "high",
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
      "delta_t_days":    null,
      "huber_capped":    false
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
- `selected_rate_window_days`: the adaptive rate window that was selected (28, 56, or 84); `null` if no qualifying window found

### `latest_raw_weight_kg`

The `weight_kg` of the most recent daily representative. Not smoothed.

### `latest_trend_weight_kg`

The EWMA trend weight at the final modelling point. Rounded to 6 decimal places in output.

### `weekly_rate`

All values in kg/week. `null` if fewer than 4 distinct modelling days.

| Field | Description |
|---|---|
| `estimate_kg` | Theil-Sen median-of-slopes estimate |
| `lower_kg` | Sen/Kendall CI lower bound (authoritative v1) |
| `upper_kg` | Sen/Kendall CI upper bound (authoritative v1) |
| `bootstrap_lower_kg` | Bootstrap CI lower bound (research reference only — do not surface in UI) |
| `bootstrap_upper_kg` | Bootstrap CI upper bound (research reference only — do not surface in UI) |

`lower_kg` and `upper_kg` are `null` if fewer than 6 distinct modelling days.
`bootstrap_*` values are `null` if fewer than 6 distinct modelling days.

**UI labelling requirement:** The interval `[lower_kg, upper_kg]` must be labelled "uncertainty range" in the UI — never "95% confidence interval". See specification §6.6 for coverage degradation under serial correlation.

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

One object per modelling day within the 28-day display window, sorted ascending. The EWMA is computed over full history; `trend_points` contains only the display-window subset.

Includes `alpha`, `delta_t_days`, and `huber_capped` for auditability. First point has `alpha: null`, `delta_t_days: null`, and `huber_capped: false` (initialisation point).

`huber_capped: true` means the innovation was clamped before being applied. See specification §5.4.

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
  ↓ SAST grouping + representative selection (ALL history)
all_representatives   — one per SAST calendar day, full history
  ↓
  ├─ Pipeline A: time-aware EWMA v2 (full history)
  │    ↓ display window filter (last 28 days)
  │    → trend_points, latest_trend_weight_kg
  │
  └─ Pipeline B: adaptive window filter (28/56/84 days)
       ↓ Theil-Sen rate
       ↓ Sen/Kendall CI
       → weekly_rate (estimate + interval)
```

Pipeline A uses **all** historical representatives (full-history EWMA; no window reset).
Pipeline B uses the adaptive rate window to select which representatives feed the rate estimate.
The display window applied to Pipeline A output is separate from the rate window.
Pipelines A and B do not feed into each other.
