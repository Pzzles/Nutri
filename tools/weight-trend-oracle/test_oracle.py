"""
Oracle micro-tests — hand-calculated reference values.
Run: python test_oracle.py
     python -m pytest test_oracle.py -v   (optional, no pytest required)

Gate 1B: all tests updated for weight_time_ewma_v2 (Huber + full-history),
weight_rate_interval_sen_v1 (deterministic Sen/Kendall CI), adaptive window,
and frozen median-timestamp rule for Case C.
"""

from __future__ import annotations
import math
import sys
from oracle import (
    RawEntry, DailyRep,
    time_alpha, compute_ewma, theil_sen, ols_diagnostic, bootstrap_ci,
    sen_kendall_ci, build_daily_representatives, gap_analysis, assess_confidence,
    select_rate_window, calculate, filter_valid, HUBER_FRACTION, HUBER_MIN_KG,
)

# ── Helper ────────────────────────────────────────────────────────────────────

_passed = 0
_failed = 0


def check(name: str, actual, expected, tol: float = 1e-6):
    global _passed, _failed
    if isinstance(expected, float):
        ok = abs(actual - expected) <= tol
    else:
        ok = (actual == expected)
    if ok:
        _passed += 1
        print(f"  PASS  {name}")
    else:
        _failed += 1
        print(f"  FAIL  {name}")
        print(f"        expected={expected!r}  actual={actual!r}")


# ══════════════════════════════════════════════════════════════════════════════
# [1] time_alpha
# ══════════════════════════════════════════════════════════════════════════════

print("\n[1] time_alpha(delta_t, half_life=7)")

check("alpha(0) = 0",        time_alpha(0.0),    0.0)
check("alpha(7) = 0.5",      time_alpha(7.0),    0.5,   tol=1e-10)
check("alpha(14) = 0.75",    time_alpha(14.0),   0.75,  tol=1e-10)
check("alpha(1000) → 1",     time_alpha(1000.0), 1.0,   tol=1e-6)
check("alpha(1) ≈ 0.094276", time_alpha(1.0),    1.0 - math.pow(2, -1/7), tol=1e-10)


# ══════════════════════════════════════════════════════════════════════════════
# [2] Two-point time-aware EWMA (no Huber cap; innovation is small)
# ══════════════════════════════════════════════════════════════════════════════

print("\n[2] Two-point EWMA — delta_t=7 days (alpha=0.5)")

reps_2pt = [
    DailyRep("2026-01-01", "2026-01-01T05:00:00Z", 100.0, "official"),
    DailyRep("2026-01-08", "2026-01-08T05:00:00Z",  98.0, "official"),
]
ewma_2pt = compute_ewma(reps_2pt)

check("2pt init trend = 100.0",    ewma_2pt[0].trend_weight_kg, 100.0)
check("2pt init alpha is None",    ewma_2pt[0].alpha,            None)
check("2pt second alpha = 0.5",    ewma_2pt[1].alpha,            0.5,  tol=1e-6)
check("2pt second trend = 99.0",   ewma_2pt[1].trend_weight_kg,  99.0, tol=1e-8)
# innovation = 98 - 100 = -2; cap = max(100*0.05, 5) = 5; |-2| ≤ 5 → not capped
check("2pt not Huber-capped",      ewma_2pt[1].huber_capped,    False)


# ══════════════════════════════════════════════════════════════════════════════
# [3] Stable-weight EWMA — convergence to 80.0 kg
# ══════════════════════════════════════════════════════════════════════════════

print("\n[3] Stable EWMA — weekly at 80.0 kg stays 80.0")

reps_stable = [
    DailyRep(f"2026-01-{i:02d}", f"2026-01-{i:02d}T05:00:00Z", 80.0, "official")
    for i in range(1, 29, 7)
]
ewma_stable = compute_ewma(reps_stable)
for i, pt in enumerate(ewma_stable):
    check(f"stable trend at step {i}", pt.trend_weight_kg, 80.0, tol=1e-8)
    check(f"not Huber-capped at step {i}", pt.huber_capped, False)


# ══════════════════════════════════════════════════════════════════════════════
# [4] Huber capping — extreme innovation is clamped
# ══════════════════════════════════════════════════════════════════════════════

print("\n[4] Huber capping — 30 kg spike from 100 kg trend")

reps_spike = [
    DailyRep("2026-01-01", "2026-01-01T05:00:00Z", 100.0, "official"),  # trend = 100
    DailyRep("2026-01-22", "2026-01-22T05:00:00Z", 130.0, "official"),  # 21-day gap, spike
]
ewma_spike = compute_ewma(reps_spike)
# trend = 100 (init), cap = max(100*0.05, 5.0) = 5.0, innovation=30 > 5 → capped
# delta_t = 21 days, alpha(21) = 1 - 2^(-21/7) = 1 - 2^(-3) = 0.875
alpha_21   = 1.0 - math.pow(2.0, -21 / 7)
expected_trend = 100.0 + alpha_21 * 5.0   # 100 + 0.875 * 5 = 104.375
check("spike: Huber-capped = True",    ewma_spike[1].huber_capped,    True)
check("spike: trend << 130",          ewma_spike[1].trend_weight_kg < 115, True)
check("spike: trend = 100 + 0.875*5", ewma_spike[1].trend_weight_kg, expected_trend, tol=1e-6)


# ══════════════════════════════════════════════════════════════════════════════
# [5] Huber NOT triggered for genuine 5 kg shift (innovation ≤ cap boundary)
# ══════════════════════════════════════════════════════════════════════════════

print("\n[5] Huber boundary — innovation = 5.0, cap = 5.0, NOT capped")

reps_shift = [
    DailyRep("2026-01-01", "2026-01-01T05:00:00Z", 100.0, "official"),  # trend = 100
    DailyRep("2026-01-02", "2026-01-02T05:00:00Z", 105.0, "official"),  # innovation = 5.0
]
ewma_shift = compute_ewma(reps_shift)
# cap = max(100 * 0.05, 5.0) = 5.0; |5.0| > 5.0 is False → not capped
alpha_1 = 1.0 - math.pow(2.0, -1 / 7)
expected_shift = 100.0 + alpha_1 * 5.0
check("genuine shift: NOT Huber-capped",      ewma_shift[1].huber_capped,    False)
check("genuine shift: normal EWMA applied",   ewma_shift[1].trend_weight_kg, expected_shift, tol=1e-8)


# ══════════════════════════════════════════════════════════════════════════════
# [6] Daily representative — Case C (no official, median weight + median timestamp)
# ══════════════════════════════════════════════════════════════════════════════

print("\n[6] Case C — 3 entries, no official → median weight, middle timestamp")

entries_c3 = [
    RawEntry("r1", "2026-03-01T05:00:00Z", 102.0, False),
    RawEntry("r2", "2026-03-01T09:00:00Z", 104.0, False),
    RawEntry("r3", "2026-03-01T18:00:00Z", 100.0, False),
]
reps_c3, _ = build_daily_representatives(entries_c3)
# sorted weights: [100, 102, 104] → median = 102
# sorted timestamps: r1 05:00, r2 09:00, r3 18:00 → middle = r2 09:00
check("Case C-3: median weight = 102",        reps_c3[0].weight_kg,   102.0)
check("Case C-3: source = median",            reps_c3[0].source,       "median")
check("Case C-3: timestamp = middle entry",   reps_c3[0].measured_at, "2026-03-01T09:00:00Z")
check("Case C-3: all 3 IDs in source_ids",   len(reps_c3[0].source_measurement_ids), 3)

print("\n[6b] Case C — 2 entries (even count) → lower-middle timestamp")

entries_c2 = [
    RawEntry("r1", "2026-03-02T05:00:00Z", 102.0, False),
    RawEntry("r2", "2026-03-02T09:00:00Z", 104.0, False),
]
reps_c2, _ = build_daily_representatives(entries_c2)
# sorted weights: [102, 104] → average = 103.0
# sorted timestamps: r1 05:00, r2 09:00; even n=2: lower-middle = index 0 = r1 05:00
check("Case C-2: avg weight = 103.0",         reps_c2[0].weight_kg,   103.0)
check("Case C-2: source = median",            reps_c2[0].source,       "median")
check("Case C-2: timestamp = lower entry",    reps_c2[0].measured_at, "2026-03-02T05:00:00Z")


# ══════════════════════════════════════════════════════════════════════════════
# [7] Daily representative — Case B (official preference)
# ══════════════════════════════════════════════════════════════════════════════

print("\n[7] Case B — official + non-official → official wins")

entries_b = [
    RawEntry("r1", "2026-03-03T05:00:00Z", 103.0, True),
    RawEntry("r2", "2026-03-03T18:00:00Z", 110.0, False),
]
reps_b, _ = build_daily_representatives(entries_b)
check("Case B: weight = 103",    reps_b[0].weight_kg,  103.0)
check("Case B: source=official", reps_b[0].source,     "official")


# ══════════════════════════════════════════════════════════════════════════════
# [8] Daily representative — Case D (multiple official)
# ══════════════════════════════════════════════════════════════════════════════

print("\n[8] Case D — multiple official → latest wins + warning")

entries_d = [
    RawEntry("r1", "2026-03-04T05:00:00Z", 102.0, True),
    RawEntry("r2", "2026-03-04T07:00:00Z", 104.0, True),
]
reps_d, warnings_d = build_daily_representatives(entries_d)
check("Case D: uses latest = 104",                  reps_d[0].weight_kg,  104.0)
check("Case D: warning emitted",
      "2026-03-04: multiple_official_entries" in warnings_d, True)
check("Case D: source=latest_official_of_multiple", reps_d[0].source,
      "latest_official_of_multiple")


# ══════════════════════════════════════════════════════════════════════════════
# [9] Theil-Sen slope
# ══════════════════════════════════════════════════════════════════════════════

print("\n[9] Theil-Sen slope correctness")

linear_pts = [(float(i), 2*i + 1.0) for i in range(5)]
check("exact linear slope=2.0",      theil_sen(linear_pts),    2.0,  tol=1e-9)

two_pts = [(0.0, 100.0), (7.0, 99.3)]
check("two-point slope",             theil_sen(two_pts),        (99.3 - 100.0) / 7.0, tol=1e-10)

flat_pts = [(float(i), 80.0) for i in range(10)]
check("stable → slope=0",            theil_sen(flat_pts),       0.0, tol=1e-10)


# ══════════════════════════════════════════════════════════════════════════════
# [10] Sen/Kendall CI correctness
# ══════════════════════════════════════════════════════════════════════════════

print("\n[10] Sen/Kendall CI — Fixture A values (hand-verified)")

# Fixture A: 24 points, 276 pairwise slopes, c_alpha ≈ 79.017
# lo_idx = 98, hi_idx = 178 (0-based in sorted slopes array)
# Verified independently by verify_fixture_a.mjs (Node.js oracle)
# lower_per_day = -0.11666667 kg/day → weekly = -0.816667 kg/week
# upper_per_day = -0.08750000 kg/day → weekly = -0.612500 kg/week

from fixtures import FIXTURE_A
entries_a = [RawEntry(**e) for e in FIXTURE_A["raw_entries"]]
valid_a, _ = filter_valid(entries_a)
from oracle import build_daily_representatives as bdr, select_rate_window as srw
reps_a, _ = bdr(valid_a)
window_days, rate_reps_a = srw(reps_a, FIXTURE_A["now_iso"])
from datetime import datetime
anchor_a = datetime.fromisoformat(rate_reps_a[0].measured_at.replace("Z", "+00:00"))
xy_a = [(r.elapsed_days_from(anchor_a), r.weight_kg) for r in rate_reps_a]

ci_a = sen_kendall_ci(xy_a)
check("Fixture A: Sen/Kendall CI is not None",      ci_a is not None,      True)
check("Fixture A: lower weekly ≈ -0.816667",        ci_a[0] * 7, -0.816667, tol=1e-5)
check("Fixture A: upper weekly ≈ -0.612500",        ci_a[1] * 7, -0.612500, tol=1e-5)
check("Fixture A: rate_window = 28",                window_days,           28)

# CI returns None for n < 6
check("Sen/Kendall CI None for n=5", sen_kendall_ci([(float(i), float(i)) for i in range(5)]), None)


# ══════════════════════════════════════════════════════════════════════════════
# [11] Adaptive rate window selection
# ══════════════════════════════════════════════════════════════════════════════

print("\n[11] Adaptive rate window — fallback to 56 days")

# 8 weekly reps spanning 49 days; only 4 fall in 28-day window
from fixtures import FIXTURE_B
entries_b2 = [RawEntry(**e) for e in FIXTURE_B["raw_entries"]]
valid_b2, _ = filter_valid(entries_b2)
reps_b2, _ = bdr(valid_b2)
win_b, rate_b = srw(reps_b2, FIXTURE_B["now_iso"])
check("weekly cadence: selected_rate_window = 56", win_b, 56)
check("weekly cadence: 8 reps in 56-day window",   len(rate_b), 8)


# ══════════════════════════════════════════════════════════════════════════════
# [12] Full-history EWMA — first display point reflects prior history
# ══════════════════════════════════════════════════════════════════════════════

print("\n[12] Full-history EWMA — Fixture I")

from fixtures import FIXTURE_I
result_i = calculate(
    [RawEntry(**e) for e in FIXTURE_I["raw_entries"]],
    FIXTURE_I["now_iso"],
)
# Display window starts 2026-07-31 (28 days before 2026-08-28)
# Full-history EWMA: trend at 2026-07-31 reflects 29 days at 110 kg
# → should be ≈ 109.10 kg, NOT 105.0 (window-reset would give 105)
first_display_trend = result_i["trend_points"][0]["trend_weight_kg"]
check("Fixture I: first display trend ≠ 105 (not reset)", first_display_trend != 105.0, True)
check("Fixture I: first display trend > 108 (carries history)", first_display_trend > 108.0, True)
check("Fixture I: first display trend ≈ 109.102", first_display_trend, 109.10167678, tol=1e-4)


# ══════════════════════════════════════════════════════════════════════════════
# [13] Huber protection — spike does not move trend close to outlier
# ══════════════════════════════════════════════════════════════════════════════

print("\n[13] Huber outlier protection — Fixture J")

from fixtures import FIXTURE_J
result_j = calculate(
    [RawEntry(**e) for e in FIXTURE_J["raw_entries"]],
    FIXTURE_J["now_iso"],
)
tp_j = result_j["trend_points"]
# Find the spike point (130 kg, 2026-08-05)
spike_pts = [p for p in tp_j if p["raw_weight_kg"] == 130.0]
check("Fixture J: spike point found",           len(spike_pts) == 1,       True)
check("Fixture J: spike is Huber-capped",       spike_pts[0]["huber_capped"], True)
check("Fixture J: trend << 130 after spike",    spike_pts[0]["trend_weight_kg"] < 110.0, True)
# Exact: 100 + alpha(22) * 5.0 = 100 + (1 - 2^(-22/7)) * 5.0
alpha_22 = 1.0 - math.pow(2.0, -22 / 7)
expected_j_spike = 100.0 + alpha_22 * 5.0
check("Fixture J: spike trend exact",           spike_pts[0]["trend_weight_kg"],
      expected_j_spike, tol=1e-4)


# ══════════════════════════════════════════════════════════════════════════════
# [14] Huber NOT triggered — genuine sustained shift converges
# ══════════════════════════════════════════════════════════════════════════════

print("\n[14] Genuine sustained shift — Fixture K")

from fixtures import FIXTURE_K
result_k = calculate(
    [RawEntry(**e) for e in FIXTURE_K["raw_entries"]],
    FIXTURE_K["now_iso"],
)
tp_k = result_k["trend_points"]
capped_k = [p for p in tp_k if p.get("huber_capped")]
check("Fixture K: 0 Huber-capped points",    len(capped_k), 0)
check("Fixture K: final trend > 103 (converging toward 105)",
      result_k["latest_trend_weight_kg"] > 103.0, True)
check("Fixture K: final trend < 105 (not fully converged yet)",
      result_k["latest_trend_weight_kg"] < 105.0, True)


# ══════════════════════════════════════════════════════════════════════════════
# [15] Weekly usability — 56-day window selected (Fixture L)
# ══════════════════════════════════════════════════════════════════════════════

print("\n[15] Weekly usability — Fixture L, 56-day rate window")

from fixtures import FIXTURE_L
result_l = calculate(
    [RawEntry(**e) for e in FIXTURE_L["raw_entries"]],
    FIXTURE_L["now_iso"],
)
check("Fixture L: selected_rate_window_days = 56",
      result_l["measurements"]["selected_rate_window_days"], 56)
check("Fixture L: status = usable",        result_l["status"], "usable")
check("Fixture L: weekly_rate is not None", result_l["weekly_rate"] is not None, True)


# ══════════════════════════════════════════════════════════════════════════════
# [16] SAST date rollover at UTC 22:00
# ══════════════════════════════════════════════════════════════════════════════

print("\n[16] SAST date rollover")

check("21:59 UTC → SAST 2026-03-10",
      RawEntry("r1", "2026-03-10T21:59:00Z", 80.0, True).sast_date(), "2026-03-10")
check("22:00 UTC → SAST 2026-03-11",
      RawEntry("r2", "2026-03-10T22:00:00Z", 80.0, True).sast_date(), "2026-03-11")
check("23:59 UTC → SAST 2026-03-11",
      RawEntry("r3", "2026-03-10T23:59:00Z", 80.0, True).sast_date(), "2026-03-11")
check("+02:00 offset → SAST 2026-03-11",
      RawEntry("r4", "2026-03-11T00:00:00+02:00", 80.0, True).sast_date(), "2026-03-11")


# ══════════════════════════════════════════════════════════════════════════════
# [17] Gap analysis
# ══════════════════════════════════════════════════════════════════════════════

print("\n[17] Gap analysis — 8-day gap detection")

reps_gap = [
    DailyRep("2026-01-01", "2026-01-01T05:00:00Z", 80.0, "official"),
    DailyRep("2026-01-02", "2026-01-02T05:00:00Z", 80.0, "official"),
    DailyRep("2026-01-10", "2026-01-10T05:00:00Z", 80.0, "official"),
    DailyRep("2026-01-11", "2026-01-11T05:00:00Z", 80.0, "official"),
]
gaps = gap_analysis(reps_gap)
check("largest gap = 8 days", gaps["max_gap_days"], 8.0, tol=0.001)


# ══════════════════════════════════════════════════════════════════════════════
# [18] Confidence scoring rules
# ══════════════════════════════════════════════════════════════════════════════

print("\n[18] Confidence rules")

check("low: 3 modelling days",              assess_confidence(3,  20, 2, 3, 0.2), "low")
check("low: 5 days, 10 coverage",           assess_confidence(5,  10, 2, 3, 0.2), "low")
check("medium: 7 days, 20 coverage",        assess_confidence(7,  20, 2, 5, 0.3), "medium")
check("high: 12 days, 25 cov, gap=5",       assess_confidence(12, 25, 3, 5, 0.3), "high")
check("low: wide CI > 1.0",                 assess_confidence(15, 30, 2, 5, 1.1), "low")
check("medium: CI 0.51 > 0.50 threshold",   assess_confidence(15, 30, 2, 5, 0.51), "medium")


# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════

print(f"\n{'='*55}")
print(f"  {_passed} passed   {_failed} failed")
print(f"{'='*55}")
if _failed > 0:
    sys.exit(1)
