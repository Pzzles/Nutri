"""
Oracle micro-tests — hand-calculated reference values.
Run: python -m pytest test_oracle.py -v
     python test_oracle.py           (no pytest required)
"""

from __future__ import annotations
import math
import sys
from oracle import (
    RawEntry, DailyRep,
    time_alpha, compute_ewma, theil_sen, ols_diagnostic, bootstrap_ci,
    build_daily_representatives, gap_analysis, assess_confidence,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

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


# ── 1. time_alpha ─────────────────────────────────────────────────────────────

print("\n[1] time_alpha(delta_t, half_life=7)")

# alpha(0) = 0  (no elapsed time → no update)
check("alpha(0) = 0",      time_alpha(0.0),  0.0)
# alpha(7) = 0.5  (one half-life → 50% weight to new measurement)
check("alpha(7) = 0.5",    time_alpha(7.0),  0.5, tol=1e-10)
# alpha(14) = 0.75  (two half-lives)
check("alpha(14) = 0.75",  time_alpha(14.0), 0.75, tol=1e-10)
# alpha(∞) → 1  (infinite gap → full replacement)
check("alpha(1000) → 1",   time_alpha(1000.0), 1.0, tol=1e-6)
# alpha(1) ≈ 0.094252...
check("alpha(1) ≈ 0.094252", time_alpha(1.0), 1.0 - math.pow(2, -1/7), tol=1e-10)


# ── 2. Two-point EWMA ─────────────────────────────────────────────────────────

print("\n[2] Two-point time-aware EWMA")

reps_2pt = [
    DailyRep("2026-01-01", "2026-01-01T05:00:00Z", 100.0, "official"),
    DailyRep("2026-01-08", "2026-01-08T05:00:00Z", 98.0,  "official"),  # exactly 7 days
]
ewma_2pt = compute_ewma(reps_2pt)

# First point: trend = 100.0 (init)
check("2pt init trend",        ewma_2pt[0].trend_weight_kg, 100.0)
check("2pt init alpha is None", ewma_2pt[0].alpha, None)

# Second point: delta_t=7, alpha=0.5
# trend = 0.5*98 + 0.5*100 = 99.0
check("2pt second alpha = 0.5", ewma_2pt[1].alpha, 0.5, tol=1e-6)
check("2pt second trend = 99.0", ewma_2pt[1].trend_weight_kg, 99.0, tol=1e-8)

print("\n[3] Fixed seven-day gap EWMA (stable weight)")

# Stable weight = 80.0, daily representative at weekly intervals
# After enough steps trend should converge toward 80.0
reps_stable = [
    DailyRep(f"2026-01-{i:02d}", f"2026-01-{i:02d}T05:00:00Z", 80.0, "official")
    for i in range(1, 29, 7)   # days 1, 8, 15, 22
]
ewma_stable = compute_ewma(reps_stable)
# All weights are 80.0 so trend must remain 80.0 throughout
for i, pt in enumerate(ewma_stable):
    check(f"stable w=80 trend at step {i}", pt.trend_weight_kg, 80.0, tol=1e-8)


# ── 4. Same-day median ────────────────────────────────────────────────────────

print("\n[4] Daily representative — same-day median (Case C)")

entries_c = [
    RawEntry("r1", "2026-03-01T05:00:00Z", 102.0, False),
    RawEntry("r2", "2026-03-01T09:00:00Z", 104.0, False),
    RawEntry("r3", "2026-03-01T18:00:00Z", 100.0, False),
]
reps_c, _ = build_daily_representatives(entries_c)
check("Case C: median of [100,102,104] = 102", reps_c[0].weight_kg, 102.0)
check("Case C source = median", reps_c[0].source, "median")


# ── 5. Official-reading preference (Cases A, B) ───────────────────────────────

print("\n[5] Daily representative — official preference (Case B)")

entries_b = [
    RawEntry("r1", "2026-03-02T05:00:00Z", 103.0, True),   # official morning
    RawEntry("r2", "2026-03-02T18:00:00Z", 110.0, False),  # non-official evening
]
reps_b, _ = build_daily_representatives(entries_b)
check("Case B: uses official weight 103",   reps_b[0].weight_kg, 103.0)
check("Case B: source = official",          reps_b[0].source, "official")


# ── 6. Multiple official entries (Case D) ─────────────────────────────────────

print("\n[6] Daily representative — multiple official (Case D)")

entries_d = [
    RawEntry("r1", "2026-03-03T05:00:00Z", 102.0, True),
    RawEntry("r2", "2026-03-03T07:00:00Z", 104.0, True),   # later official
]
reps_d, warnings_d = build_daily_representatives(entries_d)
check("Case D: uses latest official (104)",  reps_d[0].weight_kg, 104.0)
check("Case D: emits multiple_official_entries warning",
      "2026-03-03: multiple_official_entries" in warnings_d, True)


# ── 7. Exact linear Theil-Sen slope ──────────────────────────────────────────

print("\n[7] Theil-Sen — exact linear dataset (slope should be exact)")

# Perfect linear: y = 2x + 1 for x = 0,1,2,3,4
linear_pts = [(float(i), 2*i + 1.0) for i in range(5)]
ts_slope = theil_sen(linear_pts)
check("Theil-Sen exact slope=2.0", ts_slope, 2.0, tol=1e-9)

# Two-point: slope = (y1-y0)/(x1-x0)
two_pts = [(0.0, 100.0), (7.0, 99.3)]
ts_two = theil_sen(two_pts)
check("Theil-Sen two-point slope", ts_two, (99.3 - 100.0) / 7.0, tol=1e-10)


# ── 8. Stable-weight Theil-Sen → slope ≈ 0 ───────────────────────────────────

print("\n[8] Theil-Sen — stable weight → slope ≈ 0")

flat_pts = [(float(i), 80.0) for i in range(10)]
ts_flat = theil_sen(flat_pts)
check("Theil-Sen stable weight → slope=0", ts_flat, 0.0, tol=1e-10)


# ── 9. SAST date rollover ─────────────────────────────────────────────────────

print("\n[9] SAST date rollover")

# 21:59 UTC = 23:59 SAST → still 2026-03-10
e_2159 = RawEntry("r1", "2026-03-10T21:59:00Z", 80.0, True)
check("21:59 UTC → SAST 2026-03-10", e_2159.sast_date(), "2026-03-10")

# 22:00 UTC = 00:00 SAST → 2026-03-11
e_2200 = RawEntry("r2", "2026-03-10T22:00:00Z", 80.0, True)
check("22:00 UTC → SAST 2026-03-11", e_2200.sast_date(), "2026-03-11")

# 23:59 UTC = 01:59 SAST → 2026-03-11
e_2359 = RawEntry("r3", "2026-03-10T23:59:00Z", 80.0, True)
check("23:59 UTC → SAST 2026-03-11", e_2359.sast_date(), "2026-03-11")

# Explicit SAST offset: 2026-03-11T00:00:00+02:00 = 2026-03-10T22:00:00Z → SAST 2026-03-11
e_offset = RawEntry("r4", "2026-03-11T00:00:00+02:00", 80.0, True)
check("00:00+02:00 → SAST 2026-03-11", e_offset.sast_date(), "2026-03-11")


# ── 10. Gap analysis ──────────────────────────────────────────────────────────

print("\n[10] Gap analysis — largest gap detection")

reps_gap = [
    DailyRep("2026-01-01", "2026-01-01T05:00:00Z", 80.0, "official"),
    DailyRep("2026-01-02", "2026-01-02T05:00:00Z", 80.0, "official"),
    DailyRep("2026-01-10", "2026-01-10T05:00:00Z", 80.0, "official"),  # 8-day gap
    DailyRep("2026-01-11", "2026-01-11T05:00:00Z", 80.0, "official"),
]
gaps = gap_analysis(reps_gap)
check("largest gap = 8 days", gaps["max_gap_days"], 8.0, tol=0.001)


# ── 11. Confidence rules ──────────────────────────────────────────────────────

print("\n[11] Confidence rules")

# Not enough days → low
check("low: 3 days",
      assess_confidence(3, 20, 2, 3, 0.2), "low")
# Not enough coverage → low
check("low: 5 days, 10 coverage",
      assess_confidence(5, 10, 2, 3, 0.2), "low")
# Recent but not enough for high → medium
check("medium: 7 days, 20 coverage",
      assess_confidence(7, 20, 2, 5, 0.3), "medium")
# All high thresholds met
check("high: 12 days, 25 coverage, gap=5, ci=0.3",
      assess_confidence(12, 25, 3, 5, 0.3), "high")
# Wide CI caps at low even with good coverage
check("low: wide CI > 1.0",
      assess_confidence(15, 30, 2, 5, 1.1), "low")


# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n{'='*50}")
print(f"  {_passed} passed   {_failed} failed")
print(f"{'='*50}")
if _failed > 0:
    sys.exit(1)
