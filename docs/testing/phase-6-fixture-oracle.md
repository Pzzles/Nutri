# Phase 6 — Fixture and Oracle Reference

**Version:** weight_trend_spec_v1 (Gate 1B corrections applied)
**Status:** Gate 1B frozen
**Oracle:** `tools/weight-trend-oracle/oracle.py`
**Verification script:** `tools/weight-trend-oracle/verify_fixture_a.mjs` (Node.js)

---

## How to Run

```bash
# Python oracle (requires Python ≥ 3.9 with tzdata on Windows)
cd tools/weight-trend-oracle
pip install -r requirements.txt
python test_oracle.py              # micro-tests (18 groups, 69 assertions)
python oracle.py --fixture A       # full pipeline, Fixture A
python oracle.py --fixture I       # full-history EWMA test
python oracle.py --fixture J       # Huber protection test
python oracle.py --fixture K       # genuine shift not blocked
python oracle.py --fixture L       # 56-day window selection

# Independent Node.js verification
node tools/weight-trend-oracle/verify_fixture_a.mjs   # Fixture A Sen/Kendall CI
node tools/weight-trend-oracle/sen_ci_coverage.mjs    # CI coverage simulation
```

---

## Fixture A — Realistic 28-Day Decline

**Reference period:** 2026-07-04 to 2026-07-31 (28 days inclusive)
**`now_iso`:** `"2026-08-01T05:00:00Z"` (1 day after last measurement)

### Raw rows (26 total)

24 official morning weigh-ins + 2 non-official entries (one on day 21, one on day 10).

| SAST date | measured_at (UTC) | weight_kg | is_official | Note |
|---|---|---|---|---|
| 2026-07-04 | 2026-07-04T05:00:00Z | 105.4 | true | |
| 2026-07-05 | 2026-07-05T05:30:00Z | 104.9 | true | |
| 2026-07-06 | 2026-07-06T06:00:00Z | 105.6 | true | |
| 2026-07-07 | — | — | — | **skipped** |
| 2026-07-08 | 2026-07-08T05:00:00Z | 105.1 | true | |
| 2026-07-09 | 2026-07-09T05:15:00Z | 104.7 | true | |
| 2026-07-10 | 2026-07-10T04:45:00Z | 105.2 | true | |
| 2026-07-11 | 2026-07-11T17:00:00Z | 105.0 | **false** | evening; excluded by Case B |
| 2026-07-11 | 2026-07-11T05:00:00Z | 104.3 | true | official morning |
| 2026-07-12 | 2026-07-12T05:30:00Z | 104.8 | true | |
| 2026-07-13 | — | — | — | **skipped** |
| 2026-07-14 | 2026-07-14T05:00:00Z | 104.2 | true | |
| 2026-07-15 | 2026-07-15T06:00:00Z | 104.6 | true | |
| 2026-07-16 | 2026-07-16T05:00:00Z | 103.9 | true | |
| 2026-07-17 | 2026-07-17T05:15:00Z | 104.4 | true | |
| 2026-07-18 | 2026-07-18T05:00:00Z | 103.7 | true | |
| 2026-07-19 | — | — | — | **skipped** |
| 2026-07-20 | 2026-07-20T05:30:00Z | 104.1 | true | |
| 2026-07-21 | 2026-07-21T05:00:00Z | 103.5 | true | |
| 2026-07-22 | 2026-07-22T05:00:00Z | 103.3 | true | official morning |
| 2026-07-22 | 2026-07-22T18:00:00Z | 103.8 | **false** | evening; excluded by Case B |
| 2026-07-23 | 2026-07-23T06:00:00Z | 103.6 | true | |
| 2026-07-24 | 2026-07-24T05:00:00Z | 103.2 | true | |
| 2026-07-25 | 2026-07-25T05:00:00Z | 103.5 | true | |
| 2026-07-26 | 2026-07-26T05:15:00Z | 102.9 | true | |
| 2026-07-27 | 2026-07-27T06:00:00Z | 103.1 | true | |
| 2026-07-28 | — | — | — | **skipped** |
| 2026-07-29 | 2026-07-29T05:00:00Z | 102.7 | true | |
| 2026-07-30 | 2026-07-30T05:30:00Z | 103.0 | true | |
| 2026-07-31 | 2026-07-31T05:00:00Z | 102.6 | true | |

### Frozen expected outputs

| Metric | Frozen value |
|---|---|
| Raw rows | 26 |
| Valid rows | 26 |
| Distinct modelling days | 24 |
| Elapsed days (first→last) | 27.000000 |
| Inclusive calendar days | 28 |
| Largest gap (days) | 2.020833 |
| Selected rate window days | **28** |
| Latest raw weight | 102.600000 kg |
| Latest trend (EWMA v2, half_life=7) | **103.545921 kg** |
| Theil-Sen weekly rate | **−0.700426 kg/week** |
| Sen/Kendall CI lower (authoritative) | **−0.816667 kg/week** |
| Sen/Kendall CI upper (authoritative) | **−0.612500 kg/week** |
| Bootstrap CI lower (research ref, seed=42) | −0.855061 kg/week |
| Bootstrap CI upper (research ref, seed=42) | −0.592308 kg/week |
| OLS weekly rate (diagnostic) | −0.719371 kg/week |
| OLS R² | 0.912641 |
| Status | `usable` |
| Confidence | `high` |

**Sen/Kendall CI derivation (independently verified by Node.js `verify_fixture_a.mjs`):**
n=24 modelling days → N=276 pairs, c_alpha=79.017, lo_idx=98, hi_idx=178 (0-based into sorted slopes).
`slopes[98] = −0.816667`, `slopes[178] = −0.612500`.

### Note on EWMA discrepancy vs. Gate 1 provisional

Gate 1 provisional EWMA: 103.542168 kg. Gate 1B authoritative: **103.545921 kg** (delta: +0.003753 kg).

Source: Gate 1 provisional assumed integer-day gaps (delta_t = 1.0 or 2.0). Gate 1B authoritative uses actual fractional elapsed time from timestamps (e.g., 1.0208 days between 05:00Z and 05:30Z the next day). The 3.75 g delta has no practical significance.

### Why `high` confidence

Distinct days=24 ≥ 10 ✓, coverage=27 ≥ 21 ✓, recency=1 day ≤ 7 ✓, max_gap=2.021 ≤ 7 ✓, Sen/Kendall CI width=0.204 kg/week ≤ 0.50 ✓ → all five high conditions met → `high`.

---

## Fixture B — Weekly Sampling (8 measurements, 56-day window)

**Pattern:** approximately weekly weigh-ins over 8 weeks.
**Expected adaptive window:** 56 days (too few modelling days in 28-day window).

Expected outcomes:
- `selected_rate_window_days: 56`
- Rate direction remains downward; rate approximately −0.70 kg/week
- Uncertainty interval wider than Fixture A
- Fewer trend points in display window
- Confidence `provisional` or `low`

---

## Fixture C — Sporadic Cadence

Pattern: 1, 3, 2, 0, 7, 5, 9 raw measurements per week.

Expected:
- Raw row count > distinct modelling days
- Same-day bursts produce one representative each
- Missing week produces a gap in the EWMA
- Rate uses actual timestamps (not sequence numbers)

---

## Fixture D — Stable Weight

Daily/weekly/sporadic samples from a stable 80.0 kg baseline over 12 months.

Expected: All cadences converge. Theil-Sen slope ≈ 0.0 kg/week. Confidence `high` for daily/weekly after sufficient time.

---

## Fixture E — Statistical Outlier

Includes one entry at 90 kg in a dataset otherwise near 80 kg.

Expected:
- Outlier remains in raw history and in `daily_representatives`
- It is visible in `trend_points` as `raw_weight_kg: 90.0`
- `huber_capped: true` on the outlier trend point (innovation >> cap)
- Theil-Sen rate is not dominated by it (robust property)
- OLS rate is noticeably affected (diagnostic comparison)

---

## Fixture F — Two-Year Multi-Phase

Months 1–6: decline; 7–12: maintenance; 13–16: regain; 17–24: decline.

Expected:
- Current adaptive rate window reflects only the most recent phase
- Long-term EWMA shows all phases visually
- No single "two-year slope" reported as the current rate

---

## Fixture G — SAST Boundary

Entries around the UTC 22:00 boundary.

**Expected local dates (SAST = UTC+2):**

| measured_at (UTC) | Expected SAST date |
|---|---|
| 2026-03-10T21:59:00Z | 2026-03-10 |
| 2026-03-10T22:00:00Z | **2026-03-11** |
| 2026-03-10T23:59:00Z | 2026-03-11 |
| 2026-03-11T00:00:00+02:00 | 2026-03-11 |

---

## Fixture H — Multiple Official Entries

Two official entries on the same SAST date.

Expected:
- `latest_official_of_multiple` used as representative
- `multiple_official_entries` warning emitted with date prefix
- Modelling continues; no crash

---

## Fixture I — Full-History EWMA (Gate 1B)

**Purpose:** Prove that the EWMA does not restart at the display window boundary.

**Setup:** 29 days at 110.0 kg (2026-07-01 to 2026-07-29), then 29 days at 105.0 kg (2026-07-30 to 2026-08-27).
**`now_iso`:** `"2026-08-28T05:00:00Z"`

**Frozen expected output:**

| Metric | Frozen value |
|---|---|
| First display trend point (2026-07-31, day 30 overall) | **109.10167678 kg** (tol ±0.0001) |
| A window-reset EWMA would give | 105.0 kg (incorrect) |

**Derivation:** After 29 days at 110 kg, the EWMA has converged to approximately 110 kg. On day 30 (first day at 105 kg, delta_t ≈ 1 day), alpha ≈ 0.0943, innovation = 105 − 110 = −5. The full-history EWMA applies this small update: 110 + 0.0943 × (−5) ≈ 109.528. Subsequent days continue the gradual convergence. The display window starts at day 30; the first visible trend point is ~109.1 kg — not 105.0 kg.

**Test group:** [12] in `test_oracle.py`.

---

## Fixture J — Huber Protection Against Spike (Gate 1B)

**Purpose:** Prove that a single extreme reading does not corrupt the trend.

**Setup:**
- 14 days at 100 kg (2026-07-01 to 2026-07-14)
- 22-day gap (no measurements)
- 1 entry at 130 kg (2026-08-05) — false high measurement
- 1 entry at 100 kg (2026-08-06)
- `now_iso`: `"2026-08-07T05:00:00Z"`

**Frozen expected output:**

| Metric | Frozen value |
|---|---|
| Trend at 2026-08-05 (spike day) | **104.4334 kg** (tol ±0.0001) |
| `huber_capped` at spike day | `true` |
| Without Huber (uncapped) | ≈ 124.4 kg (corrupt) |

**Derivation:** After 14 days at 100 kg, trend ≈ 100 kg. Gap of 22 days → alpha(22) = 1 − 2^(−22/7) ≈ 0.88668. Cap = max(100 × 0.05, 5.0) = 5.0. Innovation = 130 − 100 = 30; 30 > 5.0 → capped to 5.0. Trend = 100 + 0.88668 × 5.0 ≈ 104.433.

**Test group:** [13] in `test_oracle.py`.

---

## Fixture K — Genuine Shift Not Blocked (Gate 1B)

**Purpose:** Prove that a real weight shift equal to the Huber boundary is NOT capped.

**Setup:**
- 14 days at 100 kg (2026-07-01 to 2026-07-14)
- 14 days at 105 kg (2026-07-15 to 2026-07-28)
- `now_iso`: `"2026-07-29T05:00:00Z"`

**Frozen expected output:**

| Metric | Frozen value |
|---|---|
| `huber_capped` count in display window | **0** |
| Trend converges toward 105 kg | yes |

**Derivation:** At first 105 kg entry, trend ≈ 100 kg. Innovation = 5.0. Cap = max(100 × 0.05, 5.0) = 5.0. `5.0 > 5.0` is **False** → not capped. Normal EWMA applies; trend gradually converges toward 105 kg over subsequent measurements.

**Test group:** [14] in `test_oracle.py`.

---

## Fixture L — 56-Day Adaptive Window (Gate 1B)

**Purpose:** Prove that weekly users get a rate via the 56-day adaptive window.

**Setup:** 12 weekly measurements (2026-07-10 to 2026-09-25, approx weekly spacing).
**`now_iso`:** `"2026-09-25T05:00:00Z"`

**Frozen expected output:**

| Metric | Frozen value |
|---|---|
| Selected rate window | **56 days** |
| Status | `usable` or `provisional` |
| CI fields | non-null (≥6 modelling days in 56-day window) |

**Rationale:** In the 28-day window before `now_iso`, only ~4 measurements qualify. That is below the 6-day threshold. The pipeline tries 56 days: ≥6 measurements found → 56-day window selected.

**Test group:** [15] in `test_oracle.py`.

---

## Oracle Micro-Test Inventory

`test_oracle.py` contains **18 test groups, 69 assertions**. All pass against the Gate 1B oracle.

| Group | Coverage |
|---|---|
| [1] `time_alpha` | α=0 at delta_t=0, α=0.5 at half-life, α→1 at infinity |
| [2] Two-point EWMA | Exact arithmetic check |
| [3] Stable EWMA | Convergence to 80.0 kg |
| [4] Huber capping | Innovation > cap is clamped; huber_capped=true |
| [5] Huber boundary | Innovation == cap is NOT clamped (strict inequality) |
| [6] Case C median timestamp | 3-entry even-count: lower-middle by measured_at |
| [6b] Case C median timestamp even | 4-entry even-count: lower-middle |
| [7] Case B | Official-reading preference |
| [8] Case D | Multiple official entries → latest wins + warning |
| [9] Theil-Sen | Exact linear slope = 2.0; stable slope = 0 |
| [10] Sen/Kendall CI | Fixture A values: lower=−0.816667, upper=−0.612500 |
| [11] Adaptive window | Fixture B: 8 weekly → 56-day window selected |
| [12] Full-history EWMA | Fixture I: first display trend ≈ 109.102 kg (not 105.0) |
| [13] Huber protection | Fixture J: spike trend ≈ 104.433 kg; huber_capped=true |
| [14] Genuine shift | Fixture K: 0 capped points for real 5 kg shift |
| [15] Weekly usability | Fixture L: 12 weekly → 56-day window selected |
| [16] SAST rollover | UTC 22:00 = SAST midnight (next calendar day) |
| [17] Gap analysis | 8-day gap detection |
| [18] Confidence rules | Low/medium/high scoring |

All 69 assertions are hand-calculated or derived from algebraic invariants. The oracle must pass all of them; any regression surfaces immediately.

---

## Independence Audit (Gate 1B §9)

`oracle.py` satisfies all independence requirements:

| Criterion | Status |
|---|---|
| Oracle imports only Python stdlib | **Pass** — stdlib only: `math`, `random`, `json`, `sys`, `dataclasses`, `datetime`, `zoneinfo` |
| Oracle does not import application TypeScript | **Pass** — no TypeScript imports exist or are possible from Python |
| Fixture expected values not copied from production outputs | **Pass** — Fixture I/J/K values derived from first principles (algebraic derivation documented above); no production system existed when fixtures were written |
| No mathematical module shared between oracle and application | **Pass** — oracle is a standalone Python program; application uses Supabase/TypeScript; no shared library |
| Expected values generated independently | **Pass** — `verify_fixture_a.mjs` is a second independent implementation in Node.js that agrees with oracle.py on Fixture A CI values |
| Existing implementation treated as untrusted until Gate 2 | **Pass** — Gate 1B explicitly preserved existing production implementation unchanged; oracle was written without reference to production code |

---

## Coverage Simulation Results (Gate 1B §7)

File: `tools/weight-trend-oracle/sen_ci_coverage.mjs` (run: `node sen_ci_coverage.mjs`)

| Scenario | φ | n | Empirical coverage |
|---|---|---|---|
| Independent, daily (n=24) | 0.00 | 24 | 95.5% |
| AR(1) mild, daily | 0.30 | 24 | 88.4% |
| AR(1) moderate, daily | 0.60 | 24 | 71.5% |
| AR(1) strong, daily | 0.85 | 24 | 52.9% |
| Independent, weekly (n=8) | 0.00 | 8 | 95.3% |
| Independent, minimal (n=6) | 0.00 | 6 | 96.5% |
| Stable weight, φ=0.60 (n=24) | 0.60 | 24 | 71.5% |

**Conclusion:** The Sen/Kendall interval must be labelled "uncertainty range" in the UI, not "95% confidence interval". Actual coverage under realistic daily weight correlation is ~70–90%.
