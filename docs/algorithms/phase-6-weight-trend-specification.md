# Phase 6 — Weight Trend Modelling: Mathematical Specification

**Version:** weight_trend_spec_v1 (Gate 1C corrections applied)
**Status:** Gate 1C frozen
**Supersedes:** Simple EWMA α=0.25 + OLS implemented in feat/weight-trend-modelling (Gate 2 will replace those with the algorithms defined here)
**Baseline SHA:** `6bb6927` (Gate 1 commit — Gate 1B corrections begin from this point)

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
| Time-aware EWMA smoother | `weight_time_ewma_v3` |
| Theil-Sen rate estimator | `weight_rate_theil_sen_v1` |
| Rate interval (authoritative) | `weight_rate_interval_sen_v1` |
| Rate interval (research reference) | `weight_rate_interval_bootstrap_v1` |
| Confidence scoring | `weight_trend_confidence_v1` |

`weight_time_ewma_v3` replaces `weight_time_ewma_v2` (Gate 1B):
- v2 introduced full-history EWMA and Huber-capped innovations.
- v3 changes the Huber cap formula to a bounded proportional cap (see §5.4):
  `HUBER_MIN_KG` reduced from 5.0 to 3.0; `HUBER_MAX_KG` added at 6.0.
  Behaviour at 100 kg is identical to v2. Differences apply below 100 kg (reduced minimum)
  and above 120 kg (ceiling applied instead of unbounded proportional cap).

`weight_rate_interval_sen_v1` replaces bootstrap as the authoritative interval:
- Fully deterministic (no random seed, no sampling).
- Degrades under serial correlation; see §6.6 for UI labelling consequences.

All version identifiers are included in every calculation result.

---

## 3. Input Data

### 3.1 Source data

Raw `weight_logs` rows are the immutable input. They are never modified or deleted by the trend pipeline.

Required fields per row:
- `id` — unique identifier (string)
- `measured_at` — ISO-8601 timestamp with explicit timezone offset or `Z`
- `weight_kg` — numeric, must satisfy `isFinite(v) && v > 0`
- `is_official` — boolean flag set by `fn_log_weight`

### 3.2 Validity filtering

Entries are excluded from modelling if:
- `weight_kg` is not finite
- `weight_kg ≤ 0`
- `measured_at` cannot be parsed as a valid timestamp

Excluded entries are returned in `flagged_measurements` with their `id`. They remain in raw history.

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
| A | Exactly one entry (official or not) | Use it |
| B | Multiple entries, exactly one official | Use the official entry |
| C | Multiple entries, none official | Median weight; median timestamp (see below) |
| D | Multiple entries, more than one official | Latest by `measured_at` wins; emit `multiple_official_entries` warning |
| E | All entries invalid | Emit `no_valid_entries` warning; no representative for this day |

**Case C — median weight:**
Sort valid `weight_kg` values. For odd count `n`, use `values[floor(n/2)]`. For even count `n`, use the average of `values[n/2−1]` and `values[n/2]`. The result may be a non-observed value (average of two entries).

**Case C — median timestamp (frozen in Gate 1B):**
Sort entries by `measured_at`. For odd count `n`, use the entry at index `floor(n/2)` (middle entry). For even count `n`, use the entry at index `n/2 − 1` (lower-middle entry). The representative `measured_at` is always the timestamp of a specific observed entry — never an interpolated midpoint.

This rule ensures the representative timestamp is deterministic regardless of count parity.

**Return `source_measurement_ids`:** every result includes the `id`(s) of the entry or entries that contributed to the representative. For Cases A, B, D: one ID. For Case C: all IDs from that day.

**Consequence for measurement bursts:** seven readings on one calendar day produce exactly one modelling point. Confidence metrics use distinct modelling days, not raw row count.

---

## 5. Pipeline A — Time-Aware EWMA (`weight_time_ewma_v2`)

### 5.1 Formula

```
alpha(delta_t) = 1 − 2^(−delta_t / half_life_days)

innovation_i = w_i − trend_{i−1}
cap_i        = max(trend_{i−1} × huber_fraction, huber_min_kg)

effective_innovation_i = clamp(innovation_i, −cap_i, +cap_i)

trend_i = trend_{i−1} + alpha(delta_t_i) × effective_innovation_i
```

Where:
- `delta_t_i` — elapsed fractional days from previous representative's `measured_at` to current
- `w_i` — daily representative weight in kg
- `half_life_days = 7` (product configuration; changing requires new version)
- `huber_fraction = 0.05` (5% of current trend weight; product configuration)
- `huber_min_kg = 3.0` (minimum cap in kg; product configuration)
- `huber_max_kg = 6.0` (maximum cap in kg; product configuration)

Timestamps are not rounded to integer days.

### 5.2 Initialisation

```
trend_0 = w_0
```

The first-ever daily representative initialises the trend (alpha=None, huber_capped=False). **The EWMA is computed from the first available representative across all history, not from the start of the display window.**

### 5.3 Full-history stateful EWMA

The EWMA processes **all** historical representatives in chronological order. The rolling display window (28 calendar days) is applied only when filtering `trend_points` for output — it does not restart the EWMA computation.

**Consequence:** if a user has 60 days of history and the display window covers only the last 28 days, the trend value at the start of the display window correctly reflects the prior 32 days of history. This prevents the trend from appearing to reset on each page load or window shift.

**Example (Fixture I):** 29 days stable at 110.0 kg, then 29 days at 105.0 kg. The first displayed trend point (day 30 of history) is ≈ 109.1 kg — not 105.0 kg, which a window-reset EWMA would incorrectly give.

### 5.4 Huber-capped innovations

**Rationale:** without innovation capping, a single extreme reading (e.g., 130 kg against a 103 kg trend) after a long gap produces an alpha close to 1, moving the trend to near 130 kg immediately. A subsequent return to 103 kg then over-corrects downward. The trend oscillates visually in a way that confuses users without providing information about true weight.

**Mechanism:** the innovation `w_i − trend_{i−1}` is clamped to `±cap_i` before being applied. This prevents any single measurement from moving the trend by more than `cap_i` kg.

**Cap formula (v3):** `cap_i = clamp(trend_{i−1} × 0.05, 3.0, 6.0)` — i.e. `min(max(trend × 0.05, 3.0), 6.0)`

| Baseline weight | cap (v3) | cap (v2 for comparison) |
|---|---|---|
| 50 kg | 3.0 kg | 5.0 kg |
| 60 kg | 3.0 kg | 5.0 kg |
| 100 kg | 5.0 kg | 5.0 kg (unchanged) |
| 120 kg | 6.0 kg | 6.0 kg (unchanged) |
| 150 kg | 6.0 kg | 7.5 kg |
| 200 kg | 6.0 kg | 10.0 kg |

The cap is in the proportional zone (5% × trend) for weights 60–120 kg. Below 60 kg the floor applies; above 120 kg the ceiling applies.

**Boundary case:** `|innovation| > cap` triggers capping (strict inequality). Equal-to-cap does not trigger capping. This means a genuine +5.0 kg shift from a 100 kg trend is **not capped** — the normal EWMA applies.

**Confirmed in Fixture K:** 14 days at 100 kg followed by 14 days at 105 kg. First innovation on shift day = 5.0, cap = 5.0. `5.0 > 5.0` is False → not capped. Trend converges correctly toward 105 kg.

**Confirmed in Fixture J:** 130 kg spike from 100 kg trend after 22-day gap. Innovation = 30, cap = clamp(5.0, 3.0, 6.0) = 5.0. `30 > 5.0` → capped. Trend moves to ≈ 104.43 kg, not close to 130 kg. (100 kg baseline: cap unchanged at 5.0 vs v2.)

**At 200 kg:** spike of same magnitude (230 kg from 200 kg), cap = clamp(10.0, 3.0, 6.0) = 6.0. Max displacement ≈ 5.3 kg (vs 8.9 kg under v2). Recovery within 1 kg: 17 days (vs 23 days). The ceiling prevents disproportionate displacement for heavier users.

**`huber_capped` flag:** each trend point includes `huber_capped: bool`. When true, the output value was computed from a capped innovation. This is visible in the data contract and can be used for diagnostic UI overlays.

### 5.5 Half-life analysis

| delta_t | alpha | Effect |
|---|---|---|
| 0 days | 0 | No update — impossible in practice |
| 1 day | ≈ 0.0943 | Daily user: ~9.4% weight to new measurement |
| 7 days | 0.5 | Weekly user: 50% weight to new measurement |
| 14 days | 0.75 | Two-week gap: new measurement dominates |
| 21 days | ≈ 0.875 | Three-week gap: near-full replacement |

**Effective lookback (centre of mass):** `half_life / ln(2) ≈ 10.1 days`.

**Comparison with simple EWMA (α=0.25):** simple EWMA treats a daily measurement and a monthly measurement identically. Time-aware EWMA correctly gives more weight to a measurement arriving after a long gap.

### 5.6 Missing periods

No synthetic values are invented for days with no measurements. The smoother skips to the next observed representative, applying full elapsed-time decay.

---

## 6. Pipeline B — Weekly Rate (`weight_rate_theil_sen_v1`)

### 6.1 Input

Daily representatives within the **adaptive rate window** (see §6.2). Rate uses raw representative weights to avoid circularity between the smoother and the rate estimate.

### 6.2 Adaptive rate window

The rate window is selected dynamically to ensure at least 6 distinct modelling days:

1. Try 28 calendar days: if ≥ 6 distinct modelling days → use 28
2. Try 56 calendar days: if ≥ 6 distinct modelling days → use 56
3. Try 84 calendar days: if ≥ 6 distinct modelling days → use 84
4. If no candidate qualifies → no rate (`selected_rate_window_days: null`)

The selected window is included in output as `measurements.selected_rate_window_days`.

**Rationale:** a fixed 28-day window fails weekly users. With 4 measurements in 28 days, no CI is possible. The adaptive window gives weekly users a meaningful rate at 56 days (8 measurements), and very sparse users at 84 days (≥ 6 measurements).

**EWMA is not affected by the rate window.** The EWMA uses full history regardless of which rate window is selected (see §5.3).

### 6.3 Theil-Sen slope

```
x_i = elapsed days from first representative in rate window (fractional)
y_i = representative weight in kg

slope = median of all pairwise slopes (y_j − y_i) / (x_j − x_i) for j > i

weekly_rate_kg = slope × 7
```

All pairs with `x_j > x_i` are included. Pairs with `x_j = x_i` (same timestamp — not possible after daily consolidation) are excluded.

### 6.4 Why Theil-Sen over OLS

Theil-Sen breakdown point ≈ 29%: up to 29% of data points can be outliers without corrupting the estimate. OLS is sensitive to a single extreme reading.

OLS is retained as `ols_diagnostic` for reference. It is not the authoritative rate estimate.

### 6.5 Computational cost

For n modelling days: `n(n−1)/2` pairwise slopes.

| Rate window | Typical modelling days | Pairs |
|---|---|---|
| 28 days | ≤ 28 | ≤ 378 |
| 56 days | ≤ 56 | ≤ 1,540 |
| 84 days | ≤ 84 | ≤ 3,486 |

All feasible in < 5ms.

### 6.6 Authoritative uncertainty interval — Sen/Kendall (`weight_rate_interval_sen_v1`)

**Method:** Gilbert (1987) ordered-slope interval derived from Kendall's distribution. Fully deterministic — no random seed, no resampling.

**Formula:**

```
N      = n(n−1)/2   (number of sorted pairwise slopes)
c_α    = 1.959963985 × √(n(n−1)(2n+5)/18)
lo_idx = floor((N − c_α) / 2)     [0-based index into sorted slopes]
hi_idx = ceil( (N + c_α) / 2)     [0-based index into sorted slopes]
CI     = (slopes[lo_idx], slopes[hi_idx])
```

Returns `null` if `lo_idx < 0` or `hi_idx ≥ N` (interval spans full range — insufficient data). Minimum 6 modelling days required.

**Serial-correlation assumption and UI labelling:**

This interval assumes roughly i.i.d. observations. Daily weight measurements exhibit positive AR(1) correlation. Empirical coverage simulation (Gate 1C, 3000 replicates per scenario, Python random, seeded per-scenario from 20260802):

| Noise model | φ | n | Coverage | Med. CI width | Bias | MAE |
|---|---|---|---|---|---|---|
| Stable, independent, daily | 0.00 | 24 | 95.3% ✓ | 0.446 kg/wk | −0.004 | 0.086 |
| Declining −0.7 kg/wk, independent | 0.00 | 24 | 95.2% ✓ | 0.445 | +0.005 | 0.086 |
| Stable, AR(1) φ=0.30 | 0.30 | 24 | 87.8% | 0.431 | +0.001 | 0.109 |
| Declining, AR(1) φ=0.30 | 0.30 | 24 | 87.3% | 0.433 | +0.002 | 0.112 |
| Stable, AR(1) φ=0.60 | 0.60 | 24 | 73.3% | 0.396 | +0.004 | 0.140 |
| Declining, AR(1) φ=0.60 | 0.60 | 24 | 72.2% | 0.393 | +0.003 | 0.143 |
| Stable, AR(1) φ=0.85 | 0.85 | 24 | 53.5% | 0.300 | +0.001 | 0.166 |
| Weekly, independent (n=8) | 0.00 | 8 | 95.2% ✓ | 0.400 | −0.001 | 0.066 |
| Weekly, AR(1) φ=0.30 (n=8) | 0.30 | 8 | 90.1% | 0.360 | −0.002 | 0.078 |
| Sporadic, independent (n=10) | 0.00 | 10 | 96.7% ✓ | 0.420 | −0.001 | 0.067 |
| Sporadic, AR(1) φ=0.30 (n=10) | 0.30 | 10 | 91.6% | 0.382 | −0.001 | 0.078 |
| Isolated outlier at midpoint | 0.00 | 24 | 96.4% ✓ | 0.480 | −0.000 | 0.086 |
| Minimal sample (n=6) | 0.00 | 6 | 96.1% ✓ | 1.112 | +0.005 | 0.147 |
| Dense, high noise, AR(1) φ=0.45 | 0.45 | 28 | 81.0% | 0.656 | +0.007 | 0.199 |

6 of 14 scenarios fall below 90%. The Theil-Sen estimator is nearly unbiased (|bias| < 0.01 kg/wk across all scenarios). Weekly and sporadic users with independent measurements achieve nominal coverage; daily users with AR(1) φ=0.30 drop to 87–88%.

**Conclusion:** coverage drops severely under realistic serial correlation (φ=0.3–0.6 typical for daily weight). The interval must **NOT** be labelled "95% confidence interval" in the UI.

**Required UI label:** "estimated uncertainty range" (not "95% confidence interval" or "95% CI").

**Rate of correlation decay:** the actual correlation structure of a user's weight depends on their diet consistency, water intake patterns, and measurement conditions. The φ = 0.3–0.6 range is a plausible assumption; φ = 0.85 is likely an upper bound.

**Tie handling:** identical pairwise slopes are handled naturally by the median selection. Identical x-values (same timestamp) are excluded. The normal approximation to Kendall's distribution does not include a tie correction; this introduces negligible error for floating-point weight measurements.

### 6.7 Research reference — Bootstrap CI (`weight_rate_interval_bootstrap_v1`)

The bootstrap CI (percentile bootstrap, n=999, seed=42) is retained in the oracle output for comparison and research purposes only. It is **not** the authoritative v1 interval and must not be surfaced in the user-facing UI.

Bootstrap results appear in the oracle output under `weekly_rate.bootstrap_lower_kg` and `weekly_rate.bootstrap_upper_kg`.

**Why bootstrap was rejected as v1:**
1. Not deterministic — the bootstrap seed is an arbitrary implementation choice, not a mathematical property.
2. Makes implicit independence assumption (resamples are drawn independently), which is no better than Sen/Kendall for correlated data.
3. Results from different oracle implementations may differ even with the same seed if they use different RNG implementations.

### 6.8 Output

```json
"weekly_rate": {
  "estimate_kg":        -0.700426,
  "lower_kg":           -0.816667,
  "upper_kg":           -0.612500,
  "bootstrap_lower_kg": -0.855061,
  "bootstrap_upper_kg": -0.592308
}
```

`lower_kg` and `upper_kg` are the Sen/Kendall authoritative interval.
`bootstrap_*` are research reference only.

---

## 7. Analysis Windows

### 7.1 Rate window (adaptive)

28 / 56 / 84 calendar days — see §6.2.

### 7.2 Display window (fixed)

28 calendar days for `trend_points`. The EWMA is computed over full history; only the last 28 days are included in the output array. The `window` block in the output reflects the display window, not the rate window.

### 7.3 Goal-phase trend (future)

Calculated over `[goal_phase.start_date, now]`. Uses the same pipeline. Not implemented in Phase 6.

### 7.4 Long-term history

EWMA trend over all available data. Rate displayed only for the adaptive rate window; no single slope is reported across multi-year history. Phase transitions are visible as slope changes in the historical EWMA line.

---

## 8. Minimum-Data States

| Status | Condition |
|---|---|
| `insufficient_measurements` | distinct modelling days in rate window < 4 |
| `insufficient_coverage` | elapsed coverage in rate window < 7 days |
| `provisional` | 4–5 modelling days OR 7–13 days coverage |
| `usable` | ≥ 6 days AND ≥ 14 days coverage AND ≤ 14 days recency |
| `stale` | latest measurement > 14 days ago |

A daily user reaches `usable` after ≥ 14 days. A weekly user (4 per month) has ≥ 6 measurements in the 56-day window after two months of consistent logging.

---

## 9. Confidence Scoring (`weight_trend_confidence_v1`)

Confidence is `low | medium | high`. It is not a probability.

### 9.1 Rules (applied in order)

**Low** if any of:
- Distinct modelling days < 6
- Coverage days < 14
- Days since latest measurement > 14
- Sen/Kendall CI width (weekly) > 1.0 kg/week

**High** if all of:
- Distinct modelling days ≥ 10
- Coverage days ≥ 21
- Days since latest measurement ≤ 7
- Largest gap ≤ 7 days
- Sen/Kendall CI width (weekly) ≤ 0.50 kg/week

**Medium** otherwise.

### 9.2 Example user-facing display

```
Estimated rate:   −0.70 kg/week
Uncertainty range: −0.82 to −0.61 kg/week
Confidence:        High
Based on 24 measurement days across 28 days
Largest gap:       2 days
Latest:            1 day ago
```

Label: "uncertainty range" (not "95% CI"). See §6.6.

Do not display: `Accuracy: 87%`. No probability calibration has been performed.

---

## 10. Graph Specification

### 10.1 Default view

1. **Raw measurement dots** — all valid measurements in the display window
2. **Smoothed trend line** — EWMA trend weight connected across modelling days (full-history EWMA)

The weekly rate is displayed numerically alongside the chart.

### 10.2 Point styling

| Entry type | Style |
|---|---|
| Official entry | Hollow circle, brand colour |
| Non-official entry | Smaller hollow circle, muted colour |
| Huber-capped EWMA point | Small indicator (design to be determined in Gate 2) |

### 10.3 Gap behaviour

Long gaps must not imply continuity. The EWMA trend line stops at the last observed modelling point and resumes at the next.

### 10.4 Tooltip contents

```
Raw weight:   103.0 kg
Trend weight: 103.55 kg
Date:         30 Jul 2026
Time:         07:30 (SAST)
```

---

## 11. Known Limitations

1. **Initialisation bias (first-ever measurement).** The EWMA starts from the first-ever representative. An extreme first measurement biases the trend for several subsequent measurements. Mitigated by the large alpha(t) for long elapsed times.

2. **Sen/Kendall CI coverage under correlated noise.** See §6.6. Nominal 95% but actual coverage ~70–90% under realistic daily AR(1) correlation. The "uncertainty range" UI label correctly does not promise 95% coverage.

3. **Goal-phase isolation not implemented.** Phase 6 does not separate phases. A user who transitioned from loss to maintenance will have a rolling rate that blends both.

4. **Huber parameters are product configuration, not clinical constants.** `huber_fraction=0.05`, `huber_min_kg=5.0` are reasonable defaults but have not been validated against clinical weight-loss data. They may need tuning based on user feedback.

5. **Sparse users below 84-day threshold.** A user with fewer than 6 modelling days across their entire history gets no rate. No further fallback is implemented. Status: `insufficient_measurements`.

---

## 12. Resolved Decisions (Gate 1B)

The following decisions were unresolved at Gate 1 and are now frozen:

1. **Adaptive rate window:** 28/56/84 days based on ≥6 modelling days. Implemented.
2. **Uncertainty interval method:** Sen/Kendall deterministic interval. Bootstrap retained as research reference.
3. **EWMA window behaviour:** full-history stateful (v2). Does not restart at display window boundary.
4. **Case C median timestamp:** lower-middle entry by `measured_at` for even count. Implemented.
5. **Outlier protection for Pipeline A:** Huber-capped innovation with `cap = max(trend × 0.05, 5.0)`. Implemented as part of `weight_time_ewma_v2`.

Remaining open for Gate 2:
- Chart gap visual (dashed connector vs. break)
- Goal-phase isolation (requires goals system)
- OLS residual as secondary outlier flag

---

## 13. Mathematical Review Answers

### 13.1 Does seven-day half-life create acceptable lag?

**Yes.** Centre-of-mass lookback is `7/ln(2) ≈ 10.1 days`. For ~0.5 kg/week genuine change against ~1 kg daily noise, 7-day half-life provides appropriate smoothing while remaining responsive. Product configuration, not clinically validated.

### 13.2 Does time-aware EWMA converge across cadences?

**Yes.** Mathematical fact: for constant true weight W, each step moves trend `alpha(delta_t) × (W − trend)` toward W regardless of cadence.

### 13.3 Is Theil-Sen computationally practical?

**Yes.** Maximum 3,486 pairwise slopes for the 84-day rate window (84 daily measurements). Well within < 5ms on any modern device.

### 13.4 What exact uncertainty method is used?

Sen/Kendall deterministic ordered-slope interval, nominal 95%, `z=1.959963985`. See §6.6. **Not** bootstrap. Percentile bootstrap retained as research reference only.

### 13.5 How does it behave with sparse data?

With the 84-day adaptive window, a user with ≥ 6 modelling days in 84 days gets a rate and CI. Below 6 days: rate is null. Status: `insufficient_measurements`.

### 13.6 Minimum modelling days for interval?

6 distinct modelling days. Verified algebraically: at n=6, `lo_idx=2, hi_idx=13` (out of 15 slopes) — a non-trivial interval. At n=5, `hi_idx ≥ N` → no interval.

### 13.7 Should confidence depend directly on interval width?

**Yes.** CI width > 1.0 kg/week → `low`. 0.5–1.0 → caps at `medium`. ≤ 0.5 → one of the `high` conditions. CI width directly measures rate reliability.

### 13.8 Is daily consolidation sufficient to prevent bursts?

**Yes.** Seven readings on one calendar day → one modelling point. No density weighting needed.

### 13.9 Rate window: why adaptive?

Fixed 28-day window fails weekly users (4 measurements → no CI). Adaptive 28/56/84 gives weekly users a rate at 56 days with ≥ 8 measurements. Very sparse users at 84 days with ≥ 6 measurements. Users with < 6 across all history get an honest "insufficient" status rather than a misleading narrow-window result.

### 13.10 How are goal-phase trends separated?

Not implemented in Phase 6. Requires goal-phase start/end dates from the goals system.

### 13.11 What is product choice vs validated constant?

| Item | Classification |
|---|---|
| `half_life_days = 7` | Product configuration |
| Rate window candidates [28, 56, 84] | Product configuration |
| `huber_fraction = 0.05` | Product configuration |
| `huber_min_kg = 5.0` | Product configuration |
| Sen/Kendall 95% nominal | Statistical convention |
| Minimum 6 days for CI | Statistical guideline (algebraic requirement) |
| Theil-Sen as estimator | Statistical fact (more robust than OLS) |
| CI width → confidence cap | Product policy |
| UI label "uncertainty range" | Required by §6.6 coverage results |
| Convergence of time-aware EWMA | Mathematical fact |
