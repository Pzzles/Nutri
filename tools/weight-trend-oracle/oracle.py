"""
Weight Trend Oracle — Phase 6 Gate 1B Reference Implementation
=============================================================
Independent Python oracle for verifying application trend calculations.
Shares NO code with the TypeScript application.

Algorithm versions implemented:
  weight_daily_representative_v1  (median timestamp: lower-middle entry for Case C even count)
  weight_time_ewma_v2             (full-history stateful; Huber-capped innovations)
  weight_rate_theil_sen_v1
  weight_rate_interval_sen_v1    (Sen/Kendall deterministic ordered-slope CI — authoritative)
  weight_rate_interval_bootstrap_v1  (percentile bootstrap — research reference only)
  weight_trend_confidence_v1

Independence audit:
  This file imports: math, random, json, sys, dataclasses, datetime, zoneinfo — all stdlib.
  No TypeScript, no application modules, no shared fixtures.

Usage:
  python oracle.py --fixture A
  python oracle.py --fixture I
  python oracle.py --fixture J
  etc.
"""

from __future__ import annotations

import json
import math
import random
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo


# ── Constants ─────────────────────────────────────────────────────────────────

SAST = ZoneInfo("Africa/Johannesburg")

DAILY_REP_VERSION   = "weight_daily_representative_v1"
SMOOTHING_VERSION   = "weight_time_ewma_v2"
RATE_VERSION        = "weight_rate_theil_sen_v1"
INTERVAL_VERSION    = "weight_rate_interval_sen_v1"
CONFIDENCE_VERSION  = "weight_trend_confidence_v1"

HALF_LIFE_DAYS          = 7.0
DISPLAY_WINDOW_DAYS     = 28

# Huber-capped EWMA parameters (product configuration; not clinically derived)
# Innovations exceeding max(trend*HUBER_FRACTION, HUBER_MIN_KG) are clamped.
HUBER_FRACTION          = 0.05      # 5% of current trend weight
HUBER_MIN_KG            = 5.0       # minimum cap in kg (protects lighter users)

# Sen/Kendall deterministic CI
SEN_CI_Z                = 1.959963985   # z_{0.025} for 95% two-sided CI

# Bootstrap CI (research reference; not authoritative v1 interval)
BOOTSTRAP_ITERATIONS    = 999
BOOTSTRAP_SEED          = 42
BOOTSTRAP_CI_ALPHA      = 0.05

# Adaptive rate window: tries candidates in order, picks smallest with >= MIN_MODELLING_DAYS_CI days
RATE_WINDOW_CANDIDATES  = [28, 56, 84]

# Minimum modelling days
MIN_MODELLING_DAYS_RATE = 4    # < this: no rate, status = insufficient_measurements
MIN_MODELLING_DAYS_CI   = 6    # < this: no Sen/Kendall CI

# Status thresholds
MIN_COVERAGE_DAYS_PROVISIONAL  = 7
MIN_COVERAGE_DAYS_USABLE       = 14
STALE_RECENCY_DAYS             = 14

# Confidence thresholds
CONF_HIGH_MIN_DAYS            = 10
CONF_HIGH_MIN_COVERAGE        = 21
CONF_HIGH_MAX_RECENCY         = 7
CONF_HIGH_MAX_GAP             = 7
CONF_HIGH_MAX_CI_WIDTH_WEEKLY = 0.50
CONF_MEDIUM_MIN_DAYS          = 6
CONF_MEDIUM_MIN_COVERAGE      = 14
CONF_MEDIUM_MAX_RECENCY       = 14


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class RawEntry:
    id: str
    measured_at: str   # ISO-8601 with tz offset or Z
    weight_kg: float
    is_official: bool
    notes: Optional[str] = None

    def parsed_dt(self) -> datetime:
        s = self.measured_at.replace("Z", "+00:00")
        return datetime.fromisoformat(s)

    def sast_date(self) -> str:
        return self.parsed_dt().astimezone(SAST).date().isoformat()

    def is_valid(self) -> bool:
        return math.isfinite(self.weight_kg) and self.weight_kg > 0


@dataclass
class DailyRep:
    local_date: str          # YYYY-MM-DD in SAST
    measured_at: str         # representative timestamp (ISO-8601)
    weight_kg: float
    source: str              # "official" | "median" | "latest_official_of_multiple"
    warnings: list[str] = field(default_factory=list)
    source_measurement_ids: list[str] = field(default_factory=list)

    def elapsed_days_from(self, anchor_dt: datetime) -> float:
        s = self.measured_at.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return (dt - anchor_dt).total_seconds() / 86_400.0

    def ts(self) -> float:
        """Unix timestamp float for window filtering."""
        return datetime.fromisoformat(self.measured_at.replace("Z", "+00:00")).timestamp()


@dataclass
class EWMAPoint:
    local_date: str
    measured_at: str
    raw_weight_kg: float
    trend_weight_kg: float
    alpha: Optional[float]
    delta_t_days: Optional[float]
    huber_capped: bool = False


# ── Step 1: Filter valid entries ──────────────────────────────────────────────

def filter_valid(entries: list[RawEntry]) -> tuple[list[RawEntry], list[str]]:
    valid, excluded = [], []
    for e in entries:
        if e.is_valid():
            valid.append(e)
        else:
            excluded.append(e.id)
    return valid, excluded


# ── Step 2: Group by SAST date; select daily representative ───────────────────

def build_daily_representatives(
    entries: list[RawEntry],
) -> tuple[list[DailyRep], list[str]]:
    """
    Case A: exactly one entry (any is_official)     → use it as-is
    Case B: multiple entries, exactly one official  → use the official
    Case C: multiple entries, none official         → median weight (avg of 2 central for even n)
                                                      lower-middle entry by measured_at for timestamp
    Case D: multiple entries, multiple official     → latest official by measured_at + warning
    """
    by_date: dict[str, list[RawEntry]] = defaultdict(list)
    for e in entries:
        by_date[e.sast_date()].append(e)

    reps: list[DailyRep] = []
    all_warnings: list[str] = []

    for date in sorted(by_date.keys()):
        day_entries = sorted(by_date[date], key=lambda e: e.measured_at)
        official = [e for e in day_entries if e.is_official]
        day_warnings: list[str] = []

        if len(official) == 0:
            # Case C
            weights_sorted = sorted(e.weight_kg for e in day_entries)
            n_w = len(weights_sorted)
            if n_w % 2 == 1:
                med_w = weights_sorted[n_w // 2]
            else:
                med_w = (weights_sorted[n_w // 2 - 1] + weights_sorted[n_w // 2]) / 2.0

            # Timestamp: lower-middle entry (sorted by measured_at)
            n_e = len(day_entries)
            med_ts_entry = day_entries[n_e // 2 if n_e % 2 == 1 else n_e // 2 - 1]

            rep_ts  = med_ts_entry.measured_at
            src     = "median"
            w       = med_w
            src_ids = [e.id for e in day_entries]

        elif len(official) == 1:
            # Cases A / B
            o = official[0]
            rep_ts  = o.measured_at
            src     = "official"
            w       = o.weight_kg
            src_ids = [o.id]

        else:
            # Case D
            day_warnings.append("multiple_official_entries")
            all_warnings.append(f"{date}: multiple_official_entries")
            latest  = max(official, key=lambda e: e.measured_at)
            rep_ts  = latest.measured_at
            src     = "latest_official_of_multiple"
            w       = latest.weight_kg
            src_ids = [latest.id]

        reps.append(DailyRep(
            local_date=date,
            measured_at=rep_ts,
            weight_kg=w,
            source=src,
            warnings=day_warnings,
            source_measurement_ids=src_ids,
        ))

    return reps, all_warnings


# ── Step 3: Adaptive rate window ──────────────────────────────────────────────

def select_rate_window(
    all_reps: list[DailyRep],
    now_iso: str,
) -> tuple[Optional[int], list[DailyRep]]:
    """
    Tries 28, 56, 84-day windows. Returns the smallest that gives
    >= MIN_MODELLING_DAYS_CI distinct modelling days (for a meaningful CI).
    Returns (None, []) if no candidate qualifies.
    """
    now_ts = datetime.fromisoformat(now_iso.replace("Z", "+00:00")).timestamp()
    for candidate in RATE_WINDOW_CANDIDATES:
        cutoff = now_ts - candidate * 86_400.0
        in_window = [r for r in all_reps if r.ts() >= cutoff]
        if len(in_window) >= MIN_MODELLING_DAYS_CI:
            return candidate, in_window
    return None, []


# ── Step 4: Time-aware EWMA with Huber-capped innovations ─────────────────────

def time_alpha(delta_days: float, half_life: float = HALF_LIFE_DAYS) -> float:
    """alpha(delta_t) = 1 - 2^(-delta_t / half_life_days)"""
    return 1.0 - math.pow(2.0, -delta_days / half_life)


def compute_ewma(reps: list[DailyRep]) -> list[EWMAPoint]:
    """
    Full-history time-aware EWMA (weight_time_ewma_v2).

    - Processes ALL reps in chronological order; does NOT reset at any rolling window boundary.
    - Huber protection: cap = max(trend * HUBER_FRACTION, HUBER_MIN_KG).
      If |innovation| > cap, innovation is clamped to ±cap before applying alpha.
      Protects against extreme single readings (e.g. 27 kg above trend after long gap)
      without blocking genuine sustained shifts (whose per-step innovations stay < cap).
    - First rep initialises trend; no alpha applied (huber_capped=False, alpha=None).
    """
    if not reps:
        return []

    reps_sorted = sorted(reps, key=lambda r: r.measured_at)
    results: list[EWMAPoint] = []
    trend = reps_sorted[0].weight_kg

    results.append(EWMAPoint(
        local_date=reps_sorted[0].local_date,
        measured_at=reps_sorted[0].measured_at,
        raw_weight_kg=reps_sorted[0].weight_kg,
        trend_weight_kg=trend,
        alpha=None,
        delta_t_days=None,
        huber_capped=False,
    ))

    for i in range(1, len(reps_sorted)):
        prev_dt = datetime.fromisoformat(reps_sorted[i-1].measured_at.replace("Z", "+00:00"))
        curr_dt = datetime.fromisoformat(reps_sorted[i].measured_at.replace("Z", "+00:00"))
        delta_t  = (curr_dt - prev_dt).total_seconds() / 86_400.0
        alpha    = time_alpha(delta_t)

        innovation = reps_sorted[i].weight_kg - trend
        cap        = max(trend * HUBER_FRACTION, HUBER_MIN_KG)
        capped     = abs(innovation) > cap
        if capped:
            innovation = math.copysign(cap, innovation)

        trend = trend + alpha * innovation

        results.append(EWMAPoint(
            local_date=reps_sorted[i].local_date,
            measured_at=reps_sorted[i].measured_at,
            raw_weight_kg=reps_sorted[i].weight_kg,
            trend_weight_kg=trend,
            alpha=alpha,
            delta_t_days=delta_t,
            huber_capped=capped,
        ))

    return results


# ── Step 5: Theil-Sen slope ───────────────────────────────────────────────────

def theil_sen(points: list[tuple[float, float]]) -> Optional[float]:
    """Median of all pairwise slopes (x_j-x_i>0)."""
    if len(points) < 2:
        return None
    slopes: list[float] = []
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            dx = points[j][0] - points[i][0]
            dy = points[j][1] - points[i][1]
            if dx > 0.0:
                slopes.append(dy / dx)
    if not slopes:
        return None
    slopes.sort()
    n = len(slopes)
    return slopes[n // 2] if n % 2 == 1 else (slopes[n // 2 - 1] + slopes[n // 2]) / 2.0


def ols_diagnostic(points: list[tuple[float, float]]) -> Optional[dict]:
    """OLS slope for diagnostic comparison only; not the authoritative estimator."""
    n = len(points)
    if n < 2:
        return None
    xs  = [p[0] for p in points]
    ys  = [p[1] for p in points]
    sx  = sum(xs); sy = sum(ys)
    sxy = sum(x * y for x, y in zip(xs, ys))
    sx2 = sum(x * x for x in xs)
    denom = n * sx2 - sx * sx
    if denom == 0:
        return None
    slope     = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    mean_y    = sy / n
    ss_tot    = sum((y - mean_y) ** 2 for y in ys)
    ss_res    = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    r2        = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
    return {"slope_per_day": slope, "weekly_rate_kg": slope * 7, "r_squared": r2}


# ── Step 6: Sen/Kendall deterministic CI (authoritative v1) ───────────────────

def sen_kendall_ci(
    points: list[tuple[float, float]],
    z: float = SEN_CI_Z,
) -> Optional[tuple[float, float]]:
    """
    Deterministic 95% CI for the Theil-Sen slope (weight_rate_interval_sen_v1).

    Method: Gilbert (1987) "Statistical Methods for Environmental Pollution Monitoring"
    Section 17.4 — ordered-slope interval derived from Kendall's distribution.

    Given n data points with N = n(n-1)/2 sorted pairwise slopes S_(1) <= ... <= S_(N):
      c_alpha = z * sqrt(n * (n-1) * (2n+5) / 18)
      lo_idx  = floor((N - c_alpha) / 2)    [0-indexed into sorted slopes]
      hi_idx  = ceil( (N + c_alpha) / 2)    [0-indexed into sorted slopes]
      CI      = (slopes[lo_idx], slopes[hi_idx])

    Returns None when:
      - n < MIN_MODELLING_DAYS_CI (insufficient data)
      - lo_idx < 0 or hi_idx >= N (interval spans full range → uninformative)

    Serial-correlation assumption: this interval assumes roughly i.i.d. observations.
    Daily weight measurements exhibit positive AR(1)-style correlation. Under correlated
    noise, actual coverage is < nominal 95%. This is documented in the spec and reflected
    in the UI label ("uncertainty range", not "95% confidence interval").
    """
    n = len(points)
    if n < MIN_MODELLING_DAYS_CI:
        return None

    slopes: list[float] = []
    for i in range(n):
        for j in range(i + 1, n):
            dx = points[j][0] - points[i][0]
            dy = points[j][1] - points[i][1]
            if dx > 0.0:
                slopes.append(dy / dx)
    if not slopes:
        return None

    slopes.sort()
    N       = len(slopes)
    c_alpha = z * math.sqrt(n * (n - 1) * (2 * n + 5) / 18)
    lo_idx  = int(math.floor((N - c_alpha) / 2))
    hi_idx  = int(math.ceil((N + c_alpha) / 2))

    if lo_idx < 0 or hi_idx >= N:
        return None

    return slopes[lo_idx], slopes[hi_idx]


# ── Step 7: Bootstrap CI (research reference only) ────────────────────────────

def bootstrap_ci(
    points: list[tuple[float, float]],
    n_boot: int  = BOOTSTRAP_ITERATIONS,
    seed: int    = BOOTSTRAP_SEED,
    alpha: float = BOOTSTRAP_CI_ALPHA,
) -> Optional[tuple[float, float]]:
    """
    Percentile bootstrap CI (weight_rate_interval_bootstrap_v1).
    Research reference only — NOT the authoritative v1 interval.
    Retained for comparison against Sen/Kendall in empirical coverage tests.
    Uses a fixed seed for determinism within this oracle.
    """
    n = len(points)
    if n < MIN_MODELLING_DAYS_CI:
        return None
    rng = random.Random(seed)
    boot: list[float] = []
    for _ in range(n_boot):
        sample = [points[rng.randint(0, n - 1)] for _ in range(n)]
        s = theil_sen(sample)
        if s is not None:
            boot.append(s)
    if not boot:
        return None
    boot.sort()
    lo = boot[int(alpha / 2 * len(boot))]
    hi = boot[int((1 - alpha / 2) * len(boot))]
    return lo, hi


# ── Step 8: Gap analysis ──────────────────────────────────────────────────────

def gap_analysis(reps: list[DailyRep]) -> dict:
    max_gap = 0.0
    for i in range(1, len(reps)):
        ps  = reps[i-1].measured_at.replace("Z", "+00:00")
        cs  = reps[i].measured_at.replace("Z", "+00:00")
        gap = (datetime.fromisoformat(cs) - datetime.fromisoformat(ps)).total_seconds() / 86_400.0
        if gap > max_gap:
            max_gap = gap
    return {"max_gap_days": max_gap}


# ── Step 9: Confidence scoring ────────────────────────────────────────────────

def assess_confidence(
    distinct_days: int,
    coverage_days: float,
    days_since_latest: float,
    max_gap_days: float,
    ci_width_weekly: Optional[float],
) -> str:
    """weight_trend_confidence_v1 scoring. Returns 'low' | 'medium' | 'high'."""
    if (distinct_days < CONF_MEDIUM_MIN_DAYS
            or coverage_days < CONF_MEDIUM_MIN_COVERAGE
            or days_since_latest > CONF_MEDIUM_MAX_RECENCY):
        return "low"
    if ci_width_weekly is not None and ci_width_weekly > 1.0:
        return "low"
    if ci_width_weekly is not None and ci_width_weekly > CONF_HIGH_MAX_CI_WIDTH_WEEKLY:
        return "medium"
    if (distinct_days >= CONF_HIGH_MIN_DAYS
            and coverage_days >= CONF_HIGH_MIN_COVERAGE
            and days_since_latest <= CONF_HIGH_MAX_RECENCY
            and max_gap_days <= CONF_HIGH_MAX_GAP):
        return "high"
    return "medium"


# ── Step 10: Data quality status ──────────────────────────────────────────────

def determine_status(
    distinct_days: int,
    coverage_days: float,
    days_since_latest: float,
) -> str:
    if distinct_days < MIN_MODELLING_DAYS_RATE:
        return "insufficient_measurements"
    if coverage_days < MIN_COVERAGE_DAYS_PROVISIONAL:
        return "insufficient_coverage"
    if days_since_latest > STALE_RECENCY_DAYS:
        return "stale"
    if coverage_days < MIN_COVERAGE_DAYS_USABLE:
        return "provisional"
    return "usable"


# ── Main pipeline ─────────────────────────────────────────────────────────────

def calculate(
    raw_entries: list[RawEntry],
    now_iso: str,
    timezone_name: str = "Africa/Johannesburg",
    display_window_days: int = DISPLAY_WINDOW_DAYS,
) -> dict:
    """
    Full trend pipeline (weight_time_ewma_v2).

    Data flow:
      raw_entries  →  filter_valid          →  all_valid
      all_valid    →  daily_representatives →  all_reps  (full history)
      all_reps     →  compute_ewma          →  all_ewma  (full history, Huber-capped)
      all_reps     →  select_rate_window    →  rate_reps (28 / 56 / 84 days)
      rate_reps    →  theil_sen + ci        →  weekly_rate
      all_ewma (filtered to display window) →  trend_points in output
    """
    global SAST
    SAST = ZoneInfo(timezone_name)

    now_dt = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))

    # 1. Validity filter (full history)
    valid, excluded_ids = filter_valid(raw_entries)

    # 2. Daily representatives from full history
    all_reps, rep_warnings = build_daily_representatives(valid)

    if not all_reps:
        return _empty_result(raw_entries, valid, excluded_ids, timezone_name)

    # 3. Full-history EWMA with Huber protection
    all_ewma = compute_ewma(all_reps)

    # 4. Adaptive rate window
    rate_window_days, rate_reps = select_rate_window(all_reps, now_iso)

    # 5. Rate from rate window
    if rate_reps:
        anchor   = datetime.fromisoformat(rate_reps[0].measured_at.replace("Z", "+00:00"))
        xy_pairs = [(r.elapsed_days_from(anchor), r.weight_kg) for r in rate_reps]
        ts_slope = theil_sen(xy_pairs)
        ols_diag = ols_diagnostic(xy_pairs)
        s_ci     = sen_kendall_ci(xy_pairs) if len(xy_pairs) >= MIN_MODELLING_DAYS_CI else None
        b_ci     = bootstrap_ci(xy_pairs)   if len(xy_pairs) >= MIN_MODELLING_DAYS_CI else None
    else:
        ts_slope = ols_diag = s_ci = b_ci = None

    # 6. Display window: filter EWMA points to last display_window_days
    display_cutoff = now_dt.timestamp() - display_window_days * 86_400.0
    display_ewma   = [
        p for p in all_ewma
        if datetime.fromisoformat(p.measured_at.replace("Z", "+00:00")).timestamp() >= display_cutoff
    ]

    # 7. Window metadata (spans the display window)
    if display_ewma:
        first_dt    = datetime.fromisoformat(display_ewma[0].measured_at.replace("Z", "+00:00"))
        last_dt     = datetime.fromisoformat(display_ewma[-1].measured_at.replace("Z", "+00:00"))
        elapsed     = (last_dt - first_dt).total_seconds() / 86_400.0
        first_local = first_dt.astimezone(SAST).date()
        last_local  = last_dt.astimezone(SAST).date()
        inclusive   = (last_local - first_local).days + 1
        win_start   = display_ewma[0].measured_at
        win_end     = display_ewma[-1].measured_at
    else:
        elapsed = 0.0; inclusive = 0
        win_start = win_end = None

    # 8. Measurements metadata (from rate window for stats; all_reps for recency)
    meta_reps = rate_reps if rate_reps else all_reps
    gaps      = gap_analysis(meta_reps)
    max_gap   = gaps["max_gap_days"]

    last_rep_dt  = datetime.fromisoformat(all_reps[-1].measured_at.replace("Z", "+00:00"))
    recency      = (now_dt - last_rep_dt).total_seconds() / 86_400.0
    distinct     = len(rate_reps) if rate_reps else 0

    if rate_reps:
        rate_first = datetime.fromisoformat(rate_reps[0].measured_at.replace("Z", "+00:00"))
        rate_last  = datetime.fromisoformat(rate_reps[-1].measured_at.replace("Z", "+00:00"))
        rate_elapsed = (rate_last - rate_first).total_seconds() / 86_400.0
    else:
        rate_elapsed = 0.0

    # 9. Confidence and status (based on rate window data quality)
    ci_width_weekly = ((s_ci[1] - s_ci[0]) * 7) if s_ci else None
    status          = determine_status(distinct, rate_elapsed, recency)
    confidence      = assess_confidence(distinct, rate_elapsed, recency, max_gap, ci_width_weekly)

    latest_raw   = all_reps[-1].weight_kg
    latest_trend = all_ewma[-1].trend_weight_kg if all_ewma else None

    # 10. Warnings
    warnings = list(dict.fromkeys(rep_warnings))
    if status in ("insufficient_measurements", "insufficient_coverage"):
        warnings.append(status)
    if recency > STALE_RECENCY_DAYS:
        warnings.append("stale_data")
    if max_gap > 21:
        warnings.append("large_gap")

    return {
        "status":             status,
        "algorithm_versions": _versions(),
        "timezone":           timezone_name,
        "window": {
            "start":                   win_start,
            "end":                     win_end,
            "elapsed_days":            round(elapsed, 6),
            "inclusive_calendar_days": inclusive,
        },
        "measurements": {
            "raw_count":                len(raw_entries),
            "valid_count":              len(valid),
            "distinct_modelling_days":  distinct,
            "excluded_count":           len(excluded_ids),
            "latest_measured_at":       all_reps[-1].measured_at,
            "largest_gap_days":         round(max_gap, 6),
            "selected_rate_window_days": rate_window_days,
        },
        "latest_raw_weight_kg":   latest_raw,
        "latest_trend_weight_kg": round(latest_trend, 6) if latest_trend is not None else None,
        "weekly_rate": {
            "estimate_kg":        round(ts_slope * 7, 6) if ts_slope is not None else None,
            "lower_kg":           round(s_ci[0] * 7, 6) if s_ci else None,
            "upper_kg":           round(s_ci[1] * 7, 6) if s_ci else None,
            "bootstrap_lower_kg": round(b_ci[0] * 7, 6) if b_ci else None,
            "bootstrap_upper_kg": round(b_ci[1] * 7, 6) if b_ci else None,
        } if ts_slope is not None else None,
        "confidence":  confidence,
        "warnings":    sorted(warnings),
        "daily_representatives": [
            {
                "local_date":             r.local_date,
                "measured_at":            r.measured_at,
                "weight_kg":              r.weight_kg,
                "source":                 r.source,
                "warnings":               r.warnings,
                "source_measurement_ids": r.source_measurement_ids,
            }
            for r in all_reps
        ],
        "trend_points": [
            {
                "local_date":       p.local_date,
                "measured_at":      p.measured_at,
                "raw_weight_kg":    p.raw_weight_kg,
                "trend_weight_kg":  round(p.trend_weight_kg, 8),
                "alpha":            round(p.alpha, 8) if p.alpha is not None else None,
                "delta_t_days":     round(p.delta_t_days, 6) if p.delta_t_days is not None else None,
                "huber_capped":     p.huber_capped,
            }
            for p in display_ewma
        ],
        "flagged_measurements": excluded_ids,
        "ols_diagnostic": {
            "slope_per_day":  round(ols_diag["slope_per_day"], 8),
            "weekly_rate_kg": round(ols_diag["weekly_rate_kg"], 8),
            "r_squared":      round(ols_diag["r_squared"], 6),
        } if ols_diag else None,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _versions() -> dict:
    return {
        "daily_representative": DAILY_REP_VERSION,
        "smoothing":            SMOOTHING_VERSION,
        "rate":                 RATE_VERSION,
        "interval":             INTERVAL_VERSION,
        "confidence":           CONFIDENCE_VERSION,
    }


def _empty_result(raw_entries, valid, excluded_ids, timezone_name) -> dict:
    return {
        "status": "insufficient_measurements",
        "algorithm_versions": _versions(),
        "timezone": timezone_name,
        "window": {"start": None, "end": None, "elapsed_days": 0, "inclusive_calendar_days": 0},
        "measurements": {
            "raw_count":                len(raw_entries),
            "valid_count":              len(valid),
            "distinct_modelling_days":  0,
            "excluded_count":           len(excluded_ids),
            "latest_measured_at":       None,
            "largest_gap_days":         0,
            "selected_rate_window_days": None,
        },
        "latest_raw_weight_kg":   None,
        "latest_trend_weight_kg": None,
        "weekly_rate":            None,
        "confidence":             "low",
        "warnings":               ["insufficient_measurements"],
        "daily_representatives":  [],
        "trend_points":           [],
        "flagged_measurements":   excluded_ids,
        "ols_diagnostic":         None,
    }


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import importlib.util
    import os

    spec_path    = os.path.join(os.path.dirname(__file__), "fixtures.py")
    spec_mod     = importlib.util.spec_from_file_location("fixtures", spec_path)
    fixtures_mod = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(fixtures_mod)

    key_map = {
        k.replace("FIXTURE_", ""): v
        for k, v in vars(fixtures_mod).items()
        if k.startswith("FIXTURE_")
    }

    target = sys.argv[2] if len(sys.argv) > 2 else "A"
    if target not in key_map:
        print(f"Unknown fixture '{target}'. Available: {sorted(key_map)}", file=sys.stderr)
        sys.exit(1)

    fx      = key_map[target]
    entries = [RawEntry(**e) for e in fx["raw_entries"]]
    result  = calculate(entries, fx["now_iso"], fx.get("timezone", "Africa/Johannesburg"))
    print(json.dumps(result, indent=2))
