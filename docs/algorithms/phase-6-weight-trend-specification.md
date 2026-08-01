# Phase 6 — Weight Trend Modelling: Mathematical Specification

**Version:** weight_trend_spec_v1  
**Status:** Gate 1 frozen  
**Supersedes:** Simple EWMA α=0.25 + OLS implemented in feat/weight-trend-modelling (Gate 2 will replace those with the algorithms defined here)

---

## 1. Purpose

Estimate two quantities from a user's weight log:

1. **Trend weight** — the user's current underlying weight, smoothed to reduce day-to-day noise (Pipeline A).
2. **Weekly rate** — average weight change per week with an uncertainty interval (Pipeline B).

Both quantities must work correctly for all realistic logging cadences: daily, several times per week, weekly, and sporadic.

---

## 2. Algorithm Versions

| Component | Version identifier |
|---|---|
| Daily representative selection | `weight_daily_representative_v1` |
| Time-aware EWMA smoother | `weight_time_ewma_v1` |
| Theil-Sen rate estimator | `weight_rate_theil_sen_v1` |
| Confidence scoring | `weight_trend_confidence_v1` |

All version identifiers are included in every calculation result.

---

## 3. Input Data and Window

### 3.1 Source data

Raw `weight_logs` rows are the immutable input. They are never modified, averaged, or deleted by the trend pipeline.

Required fields per row:
- `id` — unique identifier (string)
- `measured_at` — ISO-8601 timestamp with explicit timezone offset or `Z`
- `weight_kg` — numeric, must satisfy `isFinite(v) && v > 0`
- `is_official` — boolean flag set by `fn_log_weight`

### 3.2 Analysis window

**Authoritative window for current rolling trend: 28 calendar days.**

Justification:
- Matches the standard four-week fitness review cycle.
- For daily users (28 modelling days): Theil-Sen has 378 pairs — excellent statistical power.
- For weekly users (4 modelling days): bootstrap CI will be wide; confidence system reflects this honestly by returning `low` or `provisional`. This is the correct behaviour — it does not hide poor-quality data.
- For sporadic users: the window correctly captures whatever data exists in the last four weeks.

The window is measured from `now` in calendar time, not from the last N measurements.

Additional windows:
- **Goal-phase trend:** from `goal_phase.start_date` to `now` (separate calculation, not mixed with rolling window)
- **Long-term history:** all available data, EWMA line displayed but no single slope claimed

### 3.3 Validity filtering

Entries are excluded from modelling if:
- `weight_kg` is not finite
- `weight_kg ≤ 0`
- `measured_at` cannot be parsed as a valid timestamp

Excluded entries are returned in `flagged_measurements` with their `id`. They remain in raw history and are never deleted automatically.

---

## 4. Timezone and Calendar-Day Rules (`weight_daily_representative_v1`)

### 4.1 User timezone

Group measurements by the user's effective timezone, read from `profiles.timezone`. Default: `Africa/Johannesburg` (SAST, UTC+2, no DST).

Do not group by UTC date. A measurement at `2026-03-10T22:30:00Z` (00:30 SAST the next morning) belongs to `2026-03-11` in SAST.

### 4.2 SAST boundary cases

| UTC timestamp | SAST equivalent | SAST local date |
|---|---|---|
| 2026-03-10T21:59:00Z | 2026-03-10T23:59+02:00 | 2026-03-10 |
| 2026-03-10T22:00:00Z | 2026-03-11T00:00+02:00 | **2026-03-11** |
| 2026-03-10T23:59:00Z | 2026-03-11T01:59+02:00 | 2026-03-11 |

Explicit offset timestamps are parsed as-is; no assumption is made that server timezone equals user timezone.

### 4.3 Daily representative selection

At most one representative value is produced per local calendar day.

| Case | Condition | Action |
|---|---|---|
| A | One entry, official | Use it |
| B | Multiple entries, exactly one official | Use the official entry |
| C | Multiple entries, none official | Use the **median** of valid `weight_kg` values |
| D | Multiple entries, more than one official | Use the **latest by `measured_at`**, emit `multiple_official_entries` warning |
| E | All entries invalid | Emit `no_valid_entries` warning; no representative for this day |

Case D is a data-integrity anomaly. The behaviour is deterministic: latest official wins. The warning is surfaced in the result; it is not silently ignored.

**Consequence for measurement bursts:** seven readings on one calendar day produce exactly one modelling point (the official one, or the median). Confidence metrics use distinct modelling days, not raw row count.

---

## 5. Pipeline A — Time-Aware EWMA (`weight_time_ewma_v1`)

### 5.1 Formula

```
alpha(delta_t) = 1 − 2^(−delta_t / half_life_days)

trend_i = alpha(delta_t_i) × w_i + (1 − alpha(delta_t_i)) × trend_(i−1)
```

Where:
- `delta_t_i` — elapsed time in fractional days between the previous representative's `measured_at` and the current one's `measured_at`
- `w_i` — daily representative weight in kg
- `half_life_days = 7` (versioned; changing it requires a new version identifier)

Timestamps are not rounded to integer days. Fractional elapsed time is used throughout.

### 5.2 Initialisation

```
trend_0 = w_0
```

The first daily representative in the calculation window initialises the trend. All intermediate calculations retain full floating-point precision. The final result is rounded to six decimal places for output.

**Consequences of this initialisation:**
- If the first measurement is an outlier, the trend starts from that outlier and will converge toward the true weight over subsequent measurements. The convergence rate depends on how many measurements follow and their timing.
- The trend is therefore biased toward the first measurement early in the window. This resolves naturally as more data accumulates.
- Alternative (e.g., average of first N values) would reduce this sensitivity but adds complexity. Version 1 uses single-point initialisation.

### 5.3 Half-life analysis

| delta_t | alpha | Effect |
|---|---|---|
| 0 days | 0 | No update — impossible in practice (same-day entries are consolidated) |
| 1 day | ≈ 0.0943 | Daily user: each new measurement contributes ~9.4% weight |
| 7 days | 0.5 | Weekly user: each measurement contributes 50% weight |
| 14 days | 0.75 | Two-week gap: new measurement dominates (75%) — appropriate after long absence |
| 21 days | ≈ 0.875 | Three-week gap: near-full replacement |

**Effective lookback (centre of mass):** `half_life / ln(2) ≈ 10.1 days` for any cadence.

**Convergence across cadences:** time-aware EWMA converges to the same stable value regardless of measurement frequency. At stable weight W with any cadence, each step moves `alpha × (W − trend)` toward W. This is a mathematical property of the formula, not an assumption.

**Comparison with simple EWMA (α=0.25):**
Simple EWMA with α=0.25 treats a daily measurement and a monthly measurement identically. Time-aware EWMA correctly gives more weight to a measurement that arrives after a long gap, as it represents more accumulated elapsed time.

### 5.4 Missing periods

No synthetic values are invented for days with no measurements. The smoother simply skips to the next observed representative, applying the full elapsed-time decay. A three-week gap results in alpha≈0.875; the new measurement heavily dominates, which is the correct mathematical response.

### 5.5 Outlier policy for Pipeline A

All valid daily representatives are included in the EWMA — including statistical outliers. The time-aware formula partially self-corrects because each outlier's influence decays with half-life of 7 days.

**Trade-off documented:**
- Smoothing every valid measurement preserves responsiveness to genuine weight changes.
- A robust pre-smoother (e.g., Winsorise before EWMA) would reduce outlier impact further but introduces additional model decisions (threshold selection, definition of "outlier" pre-smoothing vs post-smoothing).
- **Version 1 decision: no pre-smoother.** Outliers are flagged in `flagged_measurements` and visible to the user. The Theil-Sen rate estimator in Pipeline B is robust to outliers independently.

---

## 6. Pipeline B — Weekly Rate (`weight_rate_theil_sen_v1`)

### 6.1 Input

Daily representatives (not EWMA points). The rate pipeline uses raw representative weights to avoid circularity between the smoother and the rate estimate.

### 6.2 Theil-Sen slope

```
x_i = elapsed days from first modelling date (fractional)
y_i = representative weight in kg

slope = median of all pairwise slopes (y_j − y_i) / (x_j − x_i) for j > i

weekly_rate_kg = slope × 7
```

All pairs with `x_j > x_i` are included. Duplicate timestamps (same `x`) are excluded from slope pairs to avoid division by zero; such cases are also caught by the daily-representative consolidation step.

### 6.3 Why Theil-Sen over OLS

OLS minimises squared residuals and is sensitive to outliers — one extreme reading can shift the slope significantly. Theil-Sen uses the median of pairwise slopes, which has a breakdown point of ~29% (i.e., up to 29% of data points can be outliers without corrupting the estimate). For a 28-day window with up to 28 measurements, this means several outlier days have minimal effect.

OLS is retained as a diagnostic output (`ols_diagnostic`) for reference and verification. It is not the authoritative rate estimate.

### 6.4 Computational cost

For n modelling days, Theil-Sen requires `n(n-1)/2` pairwise slopes.

| Window | Max modelling days | Pairs |
|---|---|---|
| 28 days | 28 | 378 |
| 42 days | 42 | 861 |
| 2 years | 730 | 266,085 |

For the 28-day rolling window, computation is negligible (<1ms). Even multi-year history is feasible.

### 6.5 Behaviour with special data patterns

| Pattern | Behaviour |
|---|---|
| Duplicate timestamps | Excluded from slope pairs (no zero-divisor crash) |
| Sparse data (4 points) | 6 pairs — rate calculated, CI is wide |
| Clustered at one end | All pairwise slopes include cross-cluster pairs; rate is still computed |
| Long window with phase changes | Rate reflects the overall window slope; user should use goal-phase isolation |

### 6.6 Uncertainty interval

**Method: Percentile bootstrap CI.**

- `n_boot = 999` resample iterations
- Fixed seed `42` for deterministic output
- 95% CI (`alpha = 0.05`)
- Minimum 6 distinct modelling days required; below this threshold, CI is omitted (`null`)

**Statistical defensibility:**
Bootstrap CI is non-parametric and makes no distributional assumptions. It is valid for Theil-Sen and correctly propagates to wider intervals when data is sparse. The percentile method is appropriate here; BCa (bias-corrected accelerated) bootstrap would be marginally more accurate for skewed distributions but adds implementation complexity without meaningful practical benefit given typical weight noise distributions.

**Minimum data requirement for CI:** 6 modelling days. With n=6, the bootstrap has 6^6 = 46,656 possible resamples with replacement — sufficient for stable percentile estimates. With n<6 the interval is unreliable and is omitted.

### 6.7 Output

```
weekly_rate: {
  estimate_kg:  -0.700426   // Theil-Sen × 7
  lower_kg:     -0.858090   // bootstrap 2.5th percentile × 7
  upper_kg:     -0.583333   // bootstrap 97.5th percentile × 7
}
```

---

## 7. Analysis Windows

### 7.1 Current rolling trend (v1)

**28 calendar days** (see §3.2 for justification).

### 7.2 Goal-phase trend (future)

Calculated over `[goal_phase.start_date, now]`. Uses the same pipeline. Does not mix measurements from before the current phase. Not implemented in Phase 6; defined here for completeness.

### 7.3 Long-term history

Display raw dots + EWMA trend line over all available data. Do not report a single slope across multiple behavioural phases as the current rate. The rolling 28-day window produces a rate at any point in time; the long-term view shows how that rate moved over history.

Phase transitions (loss → maintenance → regain) are visible as slope changes in the historical EWMA line, not as a single confusing average.

---

## 8. Minimum-Data States

| Status | Condition |
|---|---|
| `insufficient_measurements` | distinct modelling days < 4 |
| `insufficient_coverage` | coverage < 7 days |
| `provisional` | 4–5 modelling days OR 7–13 days coverage |
| `usable` | ≥ 6 modelling days AND ≥ 14 days coverage AND ≤ 14 days recency |
| `stale` | latest measurement > 14 days ago |

These are the same thresholds applied regardless of cadence. A weekly user reaches `usable` after five weeks; a daily user reaches it after two weeks.

---

## 9. Confidence Scoring (`weight_trend_confidence_v1`)

Confidence is `low | medium | high`. It is not a probability.

### 9.1 Rules (applied in order)

**Low** if any of:
- Distinct modelling days < 6
- Coverage days < 14
- Days since latest measurement > 14
- Bootstrap CI width (weekly) > 1.0 kg/week

**High** if all of:
- Distinct modelling days ≥ 10
- Coverage days ≥ 21
- Days since latest measurement ≤ 7
- Largest gap ≤ 7 days
- Bootstrap CI width (weekly) ≤ 0.50 kg/week

**Medium** otherwise.

### 9.2 Example user-facing display

```
Estimated rate:  −0.70 kg/week
Likely range:    −0.86 to −0.58 kg/week
Confidence:      Medium
Based on 24 measurement days across 28 days
Largest gap:     2 days
Latest:          1 day ago
```

Do not display: `Accuracy: 87%`. No probability calibration has been performed.

---

## 10. Graph Specification

### 10.1 Default view

1. **Raw measurement dots** — all valid measurements in the window, one dot per raw entry
2. **Smoothed trend line** — EWMA trend weight connected across modelling days

The weekly rate is displayed numerically alongside the chart, not as a second line.

### 10.2 Point styling

| Entry type | Style |
|---|---|
| Official entry | Hollow circle, brand colour |
| Non-official entry | Smaller hollow circle, muted colour |
| Flagged (statistical outlier) | Orange/amber circle |

Same-day raw points are all displayed. Only the official one feeds the modelling pipeline.

### 10.3 Gap behaviour

Long gaps must not imply continuity. The EWMA trend line:
- **Stops at the last observed modelling point** (preferred for version 1)
- Resumes at the next modelling point when a new measurement arrives

Connecting across gaps with a dashed line is an acceptable v2 option but is not the default, as it may be misread as interpolation.

### 10.4 Tooltip contents

```
Raw weight:   103.0 kg        (measured value)
Trend weight: 103.55 kg       (EWMA, if available)
Date:         30 Jul 2026
Time:         07:30 (SAST)
Outlier:      ⚠ flagged       (if is_outlier)
```

---

## 11. Known Limitations

1. **Initialisation bias.** The EWMA starts from the first measurement in the window. An outlier in the first position biases the trend for several subsequent measurements. Mitigated by the 28-day window (the first point's influence decays after ~3 half-lives ≈ 21 days).

2. **Bootstrap CI stability at n<10.** With fewer than 10 modelling days the bootstrap CI may be asymmetric or wide. The confidence scoring accounts for this, but the interval itself should be interpreted cautiously.

3. **Goal-phase isolation not implemented.** Phase 6 does not separate phases. A user who transitioned from loss to maintenance will have a rolling rate that blends both.

4. **No biological plausibility filter.** A 10 kg overnight swing that passes database validation (1–500 kg) will be included in the EWMA. The flag system identifies it but does not exclude it from Pipeline A.

5. **No adaptive window.** Weekly users with only 4 modelling days in 28 days will receive `provisional` status. A future version could dynamically extend the window to 42–56 days for such users.

---

## 12. Unresolved Decisions

The following are open for Gate 2 and beyond:

1. **Dynamic window extension.** Should the system automatically extend from 28 to 42 days for users with <6 modelling days in the default window?
2. **OLS residual as outlier detection.** Should measurements with OLS residual > 2.5σ be flagged as statistical outliers in `flagged_measurements`?
3. **Non-official entries when no official exists.** Case C uses median of non-official entries for a day's representative. Should such days count toward modelling days for confidence scoring?
4. **Chart gap visual.** Version 1 stops the trend line at the last observation. Version 2 may draw a dashed connector. Decision deferred to UI review.
5. **Goal-phase isolation.** Requires goal-phase start/end dates from the goals system. Not available in Phase 6.
6. **Bootstrap CI method.** BCa bootstrap is marginally more accurate than percentile for skewed data. Deferred pending evidence that percentile CI is meaningfully biased in practice.

---

## 13. Mathematical Review Answers

### 13.1 Does seven-day half-life create acceptable lag?

**Yes.** Centre-of-mass lookback is `7/ln(2) ≈ 10.1 days` for any cadence. For a user detecting ~0.5 kg/week change against ~1 kg daily noise, the 7-day half-life smooths approximately one week of fluctuation while remaining responsive to genuine trends. A shorter half-life (e.g., 3–4 days) would be noisier; a longer half-life (e.g., 14 days) would lag genuine changes by two weeks. This is a product configuration choice, not a clinically validated constant.

### 13.2 Does time-aware EWMA converge across cadences?

**Yes.** Mathematical fact: when the true weight is constant at W, each step moves the trend `alpha(delta_t) × (W − trend)` toward W regardless of delta_t. The convergence is slower for infrequent users (fewer updates per calendar period) but the limiting value is identical.

### 13.3 Is Theil-Sen computationally practical?

**Yes.** Maximum 378 pairwise slopes for 28 daily measurements. Even 2 years of daily data (730 points) requires 266,085 comparisons — well within the capacity of any modern device in under 5ms.

### 13.4 What exact uncertainty method will be used?

Percentile bootstrap, n=999, seed=42, 95% CI. See §6.6.

### 13.5 How does it behave with sparse data?

With n=6 points, the CI exists but is wide. The confidence system caps at `low` when CI width > 1.0 kg/week. Below n=6 modelling days, CI is omitted entirely.

### 13.6 Minimum modelling days for interval?

6 distinct modelling days. See §6.6.

### 13.7 Should confidence depend directly on interval width?

**Yes.** Wide CI (> 1.0 kg/week) → `low`. Medium CI (0.5–1.0 kg/week) → caps at `medium`. Narrow CI (≤ 0.5 kg/week) is one of the conditions for `high`. The interval width is an empirical measure of rate reliability and should directly influence the confidence label.

### 13.8 Is daily consolidation sufficient to prevent bursts?

**Yes.** After daily consolidation, the maximum contribution of any calendar day is one modelling point. Seven readings on one day = one modelling point. No additional density weighting is necessary.

### 13.9 Rolling window: 28, 42, or 56 days?

**28 days.** See §3.2 for full justification. The confidence system honestly communicates when 28 days is insufficient (weekly users early in their tracking history).

### 13.10 How are goal-phase trends separated?

Goal-phase trend: calculated from `goal_phase.start_date` to `now`, same pipeline, different window bounds. Not implemented in Phase 6.

### 13.11 How are long-term charts calculated?

EWMA over all available data (no window cap). Rate displayed only for the 28-day rolling window; the long-term chart does not report a single slope. See §7.3.

### 13.12 What is product choice vs validated constant?

| Item | Classification |
|---|---|
| `half_life_days = 7` | Product configuration |
| Rolling window = 28 days | Product configuration |
| Bootstrap CI 95% | Statistical convention |
| Bootstrap seed = 42 | Implementation choice (reproducibility) |
| Minimum 6 days for CI | Statistical guideline |
| Theil-Sen as estimator | Statistical fact (more robust than OLS) |
| Convergence of time-aware EWMA | Mathematical fact |
| CI width → confidence cap | Product policy |
| 1–500 kg database validity range | Product / clinical convention |
