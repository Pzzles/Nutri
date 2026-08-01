"""
Phase 6 Gate 1 Oracle Fixtures
===============================
Frozen input datasets for oracle regression testing.
Expected outputs are computed by oracle.py and verified independently.

Fixtures A–H: original Gate 1 fixtures.
Fixtures I–L: Gate 1B additions.

All timestamps are in SAST (Africa/Johannesburg = UTC+2, no DST).
Morning weigh-in convention: 07:00 SAST = 05:00 UTC.
"""

# ── Fixture A ─────────────────────────────────────────────────────────────────
# 28-day daily decline: 24 official + 2 non-official entries.
# Tests the core pipeline: daily-cadence EWMA, Theil-Sen rate, Sen/Kendall CI.
# Expected: selected_rate_window_days=28, confidence=high, status=usable.

FIXTURE_A = {
    "now_iso": "2026-08-01T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        {"id": "a01", "measured_at": "2026-07-04T05:00:00Z", "weight_kg": 105.4, "is_official": True},
        {"id": "a02", "measured_at": "2026-07-05T05:30:00Z", "weight_kg": 104.9, "is_official": True},
        {"id": "a03", "measured_at": "2026-07-06T06:00:00Z", "weight_kg": 105.6, "is_official": True},
        # 2026-07-07 skipped
        {"id": "a04", "measured_at": "2026-07-08T05:00:00Z", "weight_kg": 105.1, "is_official": True},
        {"id": "a05", "measured_at": "2026-07-09T05:15:00Z", "weight_kg": 104.7, "is_official": True},
        {"id": "a06", "measured_at": "2026-07-10T04:45:00Z", "weight_kg": 105.2, "is_official": True},
        {"id": "a07", "measured_at": "2026-07-11T05:00:00Z", "weight_kg": 104.3, "is_official": True},   # official morning
        {"id": "a08", "measured_at": "2026-07-11T17:00:00Z", "weight_kg": 105.0, "is_official": False},  # evening non-official
        {"id": "a09", "measured_at": "2026-07-12T05:30:00Z", "weight_kg": 104.8, "is_official": True},
        # 2026-07-13 skipped
        {"id": "a10", "measured_at": "2026-07-14T05:00:00Z", "weight_kg": 104.2, "is_official": True},
        {"id": "a11", "measured_at": "2026-07-15T06:00:00Z", "weight_kg": 104.6, "is_official": True},
        {"id": "a12", "measured_at": "2026-07-16T05:00:00Z", "weight_kg": 103.9, "is_official": True},
        {"id": "a13", "measured_at": "2026-07-17T05:15:00Z", "weight_kg": 104.4, "is_official": True},
        {"id": "a14", "measured_at": "2026-07-18T05:00:00Z", "weight_kg": 103.7, "is_official": True},
        # 2026-07-19 skipped
        {"id": "a15", "measured_at": "2026-07-20T05:30:00Z", "weight_kg": 104.1, "is_official": True},
        {"id": "a16", "measured_at": "2026-07-21T05:00:00Z", "weight_kg": 103.5, "is_official": True},
        {"id": "a17", "measured_at": "2026-07-22T05:00:00Z", "weight_kg": 103.3, "is_official": True},   # official morning
        {"id": "a18", "measured_at": "2026-07-22T18:00:00Z", "weight_kg": 103.8, "is_official": False},  # evening non-official
        {"id": "a19", "measured_at": "2026-07-23T06:00:00Z", "weight_kg": 103.6, "is_official": True},
        {"id": "a20", "measured_at": "2026-07-24T05:00:00Z", "weight_kg": 103.2, "is_official": True},
        {"id": "a21", "measured_at": "2026-07-25T05:00:00Z", "weight_kg": 103.5, "is_official": True},
        {"id": "a22", "measured_at": "2026-07-26T05:15:00Z", "weight_kg": 102.9, "is_official": True},
        {"id": "a23", "measured_at": "2026-07-27T06:00:00Z", "weight_kg": 103.1, "is_official": True},
        # 2026-07-28 skipped
        {"id": "a24", "measured_at": "2026-07-29T05:00:00Z", "weight_kg": 102.7, "is_official": True},
        {"id": "a25", "measured_at": "2026-07-30T05:30:00Z", "weight_kg": 103.0, "is_official": True},
        {"id": "a26", "measured_at": "2026-07-31T05:00:00Z", "weight_kg": 102.6, "is_official": True},
    ],
}

# ── Fixture B ─────────────────────────────────────────────────────────────────
# Weekly cadence: 8 measurements over 7 weeks (49 days).
# 28-day window has 4 days < 6 → adaptive fallback to 56-day window (8 days ≥ 6).
# Tests: selected_rate_window_days = 56.

FIXTURE_B = {
    "now_iso": "2026-08-28T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        {"id": "b01", "measured_at": "2026-07-10T05:00:00Z", "weight_kg": 105.0, "is_official": True},
        {"id": "b02", "measured_at": "2026-07-17T05:00:00Z", "weight_kg": 104.5, "is_official": True},
        {"id": "b03", "measured_at": "2026-07-24T05:00:00Z", "weight_kg": 104.2, "is_official": True},
        {"id": "b04", "measured_at": "2026-07-31T05:00:00Z", "weight_kg": 103.8, "is_official": True},
        {"id": "b05", "measured_at": "2026-08-07T05:00:00Z", "weight_kg": 103.5, "is_official": True},
        {"id": "b06", "measured_at": "2026-08-14T05:00:00Z", "weight_kg": 103.1, "is_official": True},
        {"id": "b07", "measured_at": "2026-08-21T05:00:00Z", "weight_kg": 102.9, "is_official": True},
        {"id": "b08", "measured_at": "2026-08-28T05:00:00Z", "weight_kg": 102.6, "is_official": True},
    ],
}

# ── Fixture C ─────────────────────────────────────────────────────────────────
# Sporadic cadence with multiple entries per day (tests Cases A, B, C, D).
# Day 2026-07-01: Case C — 3 entries, no official → median
# Day 2026-07-02: Case B — official + non-official → official wins
# Day 2026-07-03: Case D — 2 official → latest + warning
# Day 2026-07-04: Case A — 1 entry (non-official)

FIXTURE_C = {
    "now_iso": "2026-07-10T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        # 2026-07-01: no official (Case C — 3 entries)
        {"id": "c01", "measured_at": "2026-07-01T05:00:00Z", "weight_kg": 102.0, "is_official": False},
        {"id": "c02", "measured_at": "2026-07-01T09:00:00Z", "weight_kg": 104.0, "is_official": False},
        {"id": "c03", "measured_at": "2026-07-01T18:00:00Z", "weight_kg": 100.0, "is_official": False},
        # 2026-07-02: one official (Case B)
        {"id": "c04", "measured_at": "2026-07-02T05:00:00Z", "weight_kg": 103.0, "is_official": True},
        {"id": "c05", "measured_at": "2026-07-02T18:00:00Z", "weight_kg": 110.0, "is_official": False},
        # 2026-07-03: two official (Case D)
        {"id": "c06", "measured_at": "2026-07-03T05:00:00Z", "weight_kg": 102.0, "is_official": True},
        {"id": "c07", "measured_at": "2026-07-03T07:00:00Z", "weight_kg": 104.0, "is_official": True},
        # 2026-07-04: one non-official only (Case A)
        {"id": "c08", "measured_at": "2026-07-04T09:00:00Z", "weight_kg": 103.0, "is_official": False},
    ],
}

# ── Fixture D ─────────────────────────────────────────────────────────────────
# Stable weight: 14 consecutive daily measurements at 80.0 kg.
# Expected: Theil-Sen slope ≈ 0.0, EWMA converges to 80.0.

FIXTURE_D = {
    "now_iso": "2026-07-15T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        {"id": f"d{i:02d}", "measured_at": f"2026-07-{i:02d}T05:00:00Z", "weight_kg": 80.0, "is_official": True}
        for i in range(1, 15)
    ],
}

# ── Fixture E ─────────────────────────────────────────────────────────────────
# Outlier: 13 days at 80.0 kg, one entry at 90.0 kg on day 7.
# Expected: Theil-Sen rate small (robust to outlier); OLS rate noticeably affected.

FIXTURE_E = {
    "now_iso": "2026-07-15T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        {"id": "e01", "measured_at": "2026-07-01T05:00:00Z", "weight_kg": 80.0, "is_official": True},
        {"id": "e02", "measured_at": "2026-07-02T05:00:00Z", "weight_kg": 80.1, "is_official": True},
        {"id": "e03", "measured_at": "2026-07-03T05:00:00Z", "weight_kg": 79.9, "is_official": True},
        {"id": "e04", "measured_at": "2026-07-04T05:00:00Z", "weight_kg": 80.2, "is_official": True},
        {"id": "e05", "measured_at": "2026-07-05T05:00:00Z", "weight_kg": 79.8, "is_official": True},
        {"id": "e06", "measured_at": "2026-07-06T05:00:00Z", "weight_kg": 80.0, "is_official": True},
        {"id": "e07", "measured_at": "2026-07-07T05:00:00Z", "weight_kg": 90.0, "is_official": True},  # outlier
        {"id": "e08", "measured_at": "2026-07-08T05:00:00Z", "weight_kg": 80.1, "is_official": True},
        {"id": "e09", "measured_at": "2026-07-09T05:00:00Z", "weight_kg": 79.9, "is_official": True},
        {"id": "e10", "measured_at": "2026-07-10T05:00:00Z", "weight_kg": 80.0, "is_official": True},
        {"id": "e11", "measured_at": "2026-07-11T05:00:00Z", "weight_kg": 80.2, "is_official": True},
        {"id": "e12", "measured_at": "2026-07-12T05:00:00Z", "weight_kg": 79.8, "is_official": True},
        {"id": "e13", "measured_at": "2026-07-13T05:00:00Z", "weight_kg": 80.0, "is_official": True},
        {"id": "e14", "measured_at": "2026-07-14T05:00:00Z", "weight_kg": 80.1, "is_official": True},
    ],
}

# ── Fixture F ─────────────────────────────────────────────────────────────────
# Multi-phase history: decline → plateau → slight regain, over ~10 weeks.
# Tests that the 28-day rate reflects only the most recent phase.

FIXTURE_F = {
    "now_iso": "2026-08-15T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        # Phase 1: declining (2026-06-06 to 2026-06-27)
        {"id": "f01", "measured_at": "2026-06-06T05:00:00Z", "weight_kg": 105.0, "is_official": True},
        {"id": "f02", "measured_at": "2026-06-13T05:00:00Z", "weight_kg": 104.3, "is_official": True},
        {"id": "f03", "measured_at": "2026-06-20T05:00:00Z", "weight_kg": 103.6, "is_official": True},
        {"id": "f04", "measured_at": "2026-06-27T05:00:00Z", "weight_kg": 103.0, "is_official": True},
        # Phase 2: plateau (2026-07-04 to 2026-07-25)
        {"id": "f05", "measured_at": "2026-07-04T05:00:00Z", "weight_kg": 103.1, "is_official": True},
        {"id": "f06", "measured_at": "2026-07-11T05:00:00Z", "weight_kg": 102.9, "is_official": True},
        {"id": "f07", "measured_at": "2026-07-18T05:00:00Z", "weight_kg": 103.0, "is_official": True},
        {"id": "f08", "measured_at": "2026-07-25T05:00:00Z", "weight_kg": 103.1, "is_official": True},
        # Phase 3: slight regain (2026-08-01 to 2026-08-15)
        {"id": "f09", "measured_at": "2026-08-01T05:00:00Z", "weight_kg": 103.5, "is_official": True},
        {"id": "f10", "measured_at": "2026-08-08T05:00:00Z", "weight_kg": 103.9, "is_official": True},
        {"id": "f11", "measured_at": "2026-08-15T05:00:00Z", "weight_kg": 104.2, "is_official": True},
    ],
}

# ── Fixture G ─────────────────────────────────────────────────────────────────
# SAST timezone boundary: entries near UTC 22:00.
# Expected local SAST dates verified per §timezone-grouping spec.

FIXTURE_G = {
    "now_iso": "2026-03-12T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        # 21:59 UTC = 23:59 SAST → 2026-03-10
        {"id": "g01", "measured_at": "2026-03-10T21:59:00Z", "weight_kg": 80.0, "is_official": True},
        # 22:00 UTC = 00:00 SAST → 2026-03-11
        {"id": "g02", "measured_at": "2026-03-10T22:00:00Z", "weight_kg": 80.2, "is_official": True},
        # 23:59 UTC = 01:59 SAST → 2026-03-11 (same day as g02 → Case A: the only official for that date)
        # Actually g02 and g03 share 2026-03-11, making it Case D (two official)
        {"id": "g03", "measured_at": "2026-03-10T23:59:00Z", "weight_kg": 80.1, "is_official": True},
        # Explicit +02:00: 00:00 SAST = 2026-03-11
        {"id": "g04", "measured_at": "2026-03-11T00:00:00+02:00", "weight_kg": 80.3, "is_official": True},
    ],
}

# ── Fixture H ─────────────────────────────────────────────────────────────────
# Multiple official entries on the same SAST date (Case D).
# Expected: latest official wins; multiple_official_entries warning emitted.

FIXTURE_H = {
    "now_iso": "2026-07-05T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        {"id": "h01", "measured_at": "2026-07-04T05:00:00Z", "weight_kg": 102.0, "is_official": True},
        {"id": "h02", "measured_at": "2026-07-04T07:00:00Z", "weight_kg": 104.0, "is_official": True},  # later official
    ],
}

# ── Fixture I ─────────────────────────────────────────────────────────────────
# Full-history EWMA stability proof.
# Part A: 29 daily measurements at 110.0 kg (2026-07-01 to 2026-07-29)
# Part B: 29 daily measurements at 105.0 kg (2026-07-30 to 2026-08-27)
# now_iso: 2026-08-28T05:00:00Z
# Display window (28 days): 2026-07-31 onwards.
#
# With full-history EWMA (v2): first displayed trend point (2026-07-31) should reflect
# prior 110-kg period — trend ≈ 109.1 kg (NOT 105.0 as window-reset EWMA would give).
# Rate window: 28 days, 28 modelling days ≥ 6 → selected_rate_window_days = 28.

_part_a = [
    {"id": f"i{i:02d}a", "measured_at": f"2026-07-{i:02d}T05:00:00Z", "weight_kg": 110.0, "is_official": True}
    for i in range(1, 30)
]
_part_b_dates = [
    ("2026-07-30", "i30b"), ("2026-07-31", "i31b"),
    ("2026-08-01", "i01b"), ("2026-08-02", "i02b"), ("2026-08-03", "i03b"),
    ("2026-08-04", "i04b"), ("2026-08-05", "i05b"), ("2026-08-06", "i06b"),
    ("2026-08-07", "i07b"), ("2026-08-08", "i08b"), ("2026-08-09", "i09b"),
    ("2026-08-10", "i10b"), ("2026-08-11", "i11b"), ("2026-08-12", "i12b"),
    ("2026-08-13", "i13b"), ("2026-08-14", "i14b"), ("2026-08-15", "i15b"),
    ("2026-08-16", "i16b"), ("2026-08-17", "i17b"), ("2026-08-18", "i18b"),
    ("2026-08-19", "i19b"), ("2026-08-20", "i20b"), ("2026-08-21", "i21b"),
    ("2026-08-22", "i22b"), ("2026-08-23", "i23b"), ("2026-08-24", "i24b"),
    ("2026-08-25", "i25b"), ("2026-08-26", "i26b"), ("2026-08-27", "i27b"),
]
_part_b = [
    {"id": pid, "measured_at": f"{d}T05:00:00Z", "weight_kg": 105.0, "is_official": True}
    for d, pid in _part_b_dates
]

FIXTURE_I = {
    "now_iso": "2026-08-28T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": _part_a + _part_b,
}

# ── Fixture J ─────────────────────────────────────────────────────────────────
# Extreme outlier with Huber protection.
# Setup: 14 stable days at 100.0 kg, 22-day gap, then one spike at 130.0 kg.
# Immediately followed by a return to 100.0 kg.
#
# Frozen expected values (hand-calculated):
#   alpha(22 days) = 1 - 2^(-22/7) = 1 - 1/8.832716 = 0.886787
#   cap = max(100.0 * 0.05, 5.0) = 5.0
#   innovation (130 - 100) = 30 > cap → clamped to 5.0
#   trend after spike = 100.0 + 0.886787 * 5.0 = 104.433935 kg
#   trend should be << 130 (Huber protection working).

FIXTURE_J = {
    "now_iso": "2026-08-07T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        *[
            {"id": f"j{i:02d}", "measured_at": f"2026-07-{i:02d}T05:00:00Z", "weight_kg": 100.0, "is_official": True}
            for i in range(1, 15)
        ],
        # 22-day gap from July 14 to August 5
        {"id": "j15", "measured_at": "2026-08-05T05:00:00Z", "weight_kg": 130.0, "is_official": True},  # spike
        {"id": "j16", "measured_at": "2026-08-06T05:00:00Z", "weight_kg": 100.0, "is_official": True},  # recovery
    ],
}

# ── Fixture K ─────────────────────────────────────────────────────────────────
# Genuine sustained shift (Huber must NOT block convergence).
# Setup: 14 days at 100.0 kg, then 14 days at 105.0 kg.
# Innovation on shift day = 5.0. Cap = max(100 * 0.05, 5.0) = 5.0.
# 5.0 is NOT strictly greater than 5.0 → Huber does NOT trigger.
# EWMA must converge noticeably toward 105.0 after 14 days.

FIXTURE_K = {
    "now_iso": "2026-07-29T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        *[
            {"id": f"k{i:02d}a", "measured_at": f"2026-07-{i:02d}T05:00:00Z", "weight_kg": 100.0, "is_official": True}
            for i in range(1, 15)
        ],
        *[
            {"id": f"k{i:02d}b", "measured_at": f"2026-07-{i:02d}T05:00:00Z", "weight_kg": 105.0, "is_official": True}
            for i in range(15, 29)
        ],
    ],
}

# ── Fixture L ─────────────────────────────────────────────────────────────────
# Weekly cadence usability proof (56-day rate window).
# 12 weekly measurements over 11 weeks (2026-07-10 to 2026-09-18).
# now_iso: 2026-09-25T05:00:00Z
#
# 28-day window (2026-08-28 to 2026-09-25): 4 measurements < 6 → try 56
# 56-day window (2026-07-31 to 2026-09-25): 9 measurements ≥ 6 → use 56
# Expected: selected_rate_window_days = 56, status = usable (or provisional).

FIXTURE_L = {
    "now_iso": "2026-09-25T05:00:00Z",
    "timezone": "Africa/Johannesburg",
    "raw_entries": [
        {"id": "l01", "measured_at": "2026-07-10T05:00:00Z", "weight_kg": 105.0, "is_official": True},
        {"id": "l02", "measured_at": "2026-07-17T05:00:00Z", "weight_kg": 104.6, "is_official": True},
        {"id": "l03", "measured_at": "2026-07-24T05:00:00Z", "weight_kg": 104.3, "is_official": True},
        {"id": "l04", "measured_at": "2026-07-31T05:00:00Z", "weight_kg": 104.0, "is_official": True},
        {"id": "l05", "measured_at": "2026-08-07T05:00:00Z", "weight_kg": 103.7, "is_official": True},
        {"id": "l06", "measured_at": "2026-08-14T05:00:00Z", "weight_kg": 103.4, "is_official": True},
        {"id": "l07", "measured_at": "2026-08-21T05:00:00Z", "weight_kg": 103.1, "is_official": True},
        {"id": "l08", "measured_at": "2026-08-28T05:00:00Z", "weight_kg": 102.8, "is_official": True},
        {"id": "l09", "measured_at": "2026-09-04T05:00:00Z", "weight_kg": 102.5, "is_official": True},
        {"id": "l10", "measured_at": "2026-09-11T05:00:00Z", "weight_kg": 102.3, "is_official": True},
        {"id": "l11", "measured_at": "2026-09-18T05:00:00Z", "weight_kg": 102.1, "is_official": True},
        {"id": "l12", "measured_at": "2026-09-25T05:00:00Z", "weight_kg": 101.9, "is_official": True},
    ],
}
