"""
Weight Trend Oracle — Phase 6 Gate 1 Reference Implementation
=============================================================
Independent Python oracle for verifying application trend calculations.
Shares no code with the TypeScript application.

Algorithm versions implemented:
  weight_daily_representative_v1
  weight_time_ewma_v1
  weight_rate_theil_sen_v1
  weight_trend_confidence_v1

Usage:
  python oracle.py fixtures.json
  python oracle.py --fixture A   # run a named built-in fixture
"""

from __future__ import annotations

import json
import math
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

# ── Constants ─────────────────────────────────────────────────────────────────

SAST = ZoneInfo("Africa/Johannesburg")

DAILY_REP_VERSION   = "weight_daily_representative_v1"
SMOOTHING_VERSION   = "weight_time_ewma_v1"
RATE_VERSION        = "weight_rate_theil_sen_v1"
CONFIDENCE_VERSION  = "weight_trend_confidence_v1"

HALF_LIFE_DAYS          = 7.0
ROLLING_WINDOW_DAYS     = 28
BOOTSTRAP_ITERATIONS    = 999
BOOTSTRAP_SEED          = 42
BOOTSTRAP_CI_ALPHA      = 0.05

# Minimum-data thresholds
MIN_MODELLING_DAYS_RATE        = 4   # below this: no rate, status=insufficient_measurements
MIN_MODELLING_DAYS_CI          = 6   # below this: no CI
MIN_COVERAGE_DAYS_PROVISIONAL  = 7   # below this: insufficient_coverage
MIN_COVERAGE_DAYS_USABLE       = 14  # below this: provisional
STALE_RECENCY_DAYS             = 14  # beyond this: stale

# Confidence thresholds
CONF_HIGH_MIN_DAYS            = 10
CONF_HIGH_MIN_COVERAGE        = 21
CONF_HIGH_MAX_RECENCY         = 7
CONF_HIGH_MAX_GAP             = 7
CONF_HIGH_MAX_CI_WIDTH_WEEKLY = 0.50   # kg/week — wide CI caps at medium
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
        s = self.measured_at
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)

    def sast_date(self) -> str:
        return self.parsed_dt().astimezone(SAST).date().isoformat()

    def is_valid(self) -> bool:
        return math.isfinite(self.weight_kg) and self.weight_kg > 0


@dataclass
class DailyRep:
    local_date: str          # YYYY-MM-DD in SAST
    measured_at: str         # representative timestamp (ISO)
    weight_kg: float
    source: str              # "official" | "median" | "latest_official_of_multiple"
    warnings: list[str] = field(default_factory=list)

    def elapsed_days_from(self, anchor_dt: datetime) -> float:
        s = self.measured_at
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return (dt - anchor_dt).total_seconds() / 86_400.0


@dataclass
class EWMAPoint:
    local_date: str
    measured_at: str
    raw_weight_kg: float
    trend_weight_kg: float
    alpha: Optional[float]
    delta_t_days: Optional[float]


# ── Step 1: Filter valid entries ──────────────────────────────────────────────

def filter_valid(entries: list[RawEntry]) -> tuple[list[RawEntry], list[str]]:
    valid, excluded = [], []
    for e in entries:
        if e.is_valid():
            valid.append(e)
        else:
            excluded.append(e.id)
    return valid, excluded


# ── Step 2: Apply rolling window ──────────────────────────────────────────────

def apply_window(entries: list[RawEntry], window_days: int, now_iso: str) -> list[RawEntry]:
    """Keep entries whose measured_at is within the rolling window."""
    now_dt = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
    cutoff  = now_dt.timestamp() - window_days * 86_400.0
    return [e for e in entries if e.parsed_dt().timestamp() >= cutoff]


# ── Step 3: Group by SAST date and select daily representative ─────────────────

def build_daily_representatives(
    entries: list[RawEntry],
) -> tuple[list[DailyRep], list[str]]:
    """
    Groups valid entries by SAST local date and selects one representative.

    Case A: exactly one entry, official       → use it
    Case B: multiple entries, exactly one official → use the official
    Case C: multiple entries, none official   → median of valid weights
    Case D: multiple entries, >1 official     → latest official, emit warning
    """
    from collections import defaultdict
    by_date: dict[str, list[RawEntry]] = defaultdict(list)
    for e in entries:
        by_date[e.sast_date()].append(e)

    reps: list[DailyRep] = []
    all_warnings: list[str] = []

    for date in sorted(by_date.keys()):
        day_entries = by_date[date]
        official = [e for e in day_entries if e.is_official]
        warnings: list[str] = []

        if len(official) == 0:
            # Case C: median of valid weights
            weights = sorted(e.weight_kg for e in day_entries)
            n = len(weights)
            med = weights[n // 2] if n % 2 == 1 else (weights[n//2-1] + weights[n//2]) / 2.0
            rep_ts = max(day_entries, key=lambda e: e.measured_at).measured_at
            src = "median"
            w = med

        elif len(official) == 1:
            # Cases A / B
            o = official[0]
            rep_ts = o.measured_at
            src = "official"
            w = o.weight_kg

        else:
            # Case D: multiple official entries
            warnings.append("multiple_official_entries")
            all_warnings.append(f"{date}: multiple_official_entries")
            latest = max(official, key=lambda e: e.measured_at)
            rep_ts = latest.measured_at
            src = "latest_official_of_multiple"
            w = latest.weight_kg

        reps.append(DailyRep(
            local_date=date,
            measured_at=rep_ts,
            weight_kg=w,
            source=src,
            warnings=warnings,
        ))

    return reps, all_warnings


# ── Step 4: Time-aware EWMA ───────────────────────────────────────────────────

def time_alpha(delta_days: float, half_life: float = HALF_LIFE_DAYS) -> float:
    """alpha(delta_t) = 1 - 2^(-delta_t / half_life_days)"""
    return 1.0 - math.pow(2.0, -delta_days / half_life)


def compute_ewma(reps: list[DailyRep]) -> list[EWMAPoint]:
    """
    Applies time-aware EWMA to sorted daily representatives.
    First point initialises trend to its own weight.
    """
    if not reps:
        return []

    reps = sorted(reps, key=lambda r: r.measured_at)
    results: list[EWMAPoint] = []
    trend = reps[0].weight_kg

    results.append(EWMAPoint(
        local_date=reps[0].local_date,
        measured_at=reps[0].measured_at,
        raw_weight_kg=reps[0].weight_kg,
        trend_weight_kg=trend,
        alpha=None,
        delta_t_days=None,
    ))

    for i in range(1, len(reps)):
        prev_s = reps[i-1].measured_at.replace("Z", "+00:00")
        curr_s = reps[i].measured_at.replace("Z", "+00:00")
        prev_dt = datetime.fromisoformat(prev_s)
        curr_dt = datetime.fromisoformat(curr_s)
        delta_t = (curr_dt - prev_dt).total_seconds() / 86_400.0
        alpha   = time_alpha(delta_t)
        trend   = alpha * reps[i].weight_kg + (1.0 - alpha) * trend

        results.append(EWMAPoint(
            local_date=reps[i].local_date,
            measured_at=reps[i].measured_at,
            raw_weight_kg=reps[i].weight_kg,
            trend_weight_kg=trend,
            alpha=alpha,
            delta_t_days=delta_t,
        ))

    return results


# ── Step 5: Theil-Sen slope ───────────────────────────────────────────────────

def theil_sen(points: list[tuple[float, float]]) -> Optional[float]:
    """
    Compute the Theil-Sen slope: median of all pairwise slopes (x_j-x_i, y_j-y_i) for j>i.
    Returns slope per day, or None if fewer than 2 points.
    """
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
    return slopes[n // 2] if n % 2 == 1 else (slopes[n//2-1] + slopes[n//2]) / 2.0


def ols_diagnostic(points: list[tuple[float, float]]) -> Optional[dict]:
    """OLS slope for diagnostic comparison only. Not the authoritative estimator."""
    n = len(points)
    if n < 2:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    sx  = sum(xs);  sy  = sum(ys)
    sxy = sum(x*y for x,y in zip(xs,ys))
    sx2 = sum(x*x for x in xs)
    denom = n*sx2 - sx*sx
    if denom == 0:
        return None
    slope = (n*sxy - sx*sy) / denom
    intercept = (sy - slope*sx) / n
    mean_y = sy / n
    ss_tot = sum((y-mean_y)**2 for y in ys)
    ss_res = sum((y-(intercept+slope*x))**2 for x,y in zip(xs,ys))
    r2 = 1 - ss_res/ss_tot if ss_tot > 0 else 1.0
    return {"slope_per_day": slope, "weekly_rate_kg": slope*7, "r_squared": r2}


# ── Step 6: Bootstrap CI ──────────────────────────────────────────────────────

def bootstrap_ci(
    points: list[tuple[float, float]],
    n_boot: int = BOOTSTRAP_ITERATIONS,
    seed: int   = BOOTSTRAP_SEED,
    alpha: float = BOOTSTRAP_CI_ALPHA,
) -> Optional[tuple[float, float]]:
    """
    Percentile bootstrap CI for the Theil-Sen slope.
    Uses a fixed seed for deterministic output.
    Returns (lower_per_day, upper_per_day) or None if too few points.
    """
    n = len(points)
    if n < MIN_MODELLING_DAYS_CI:
        return None
    rng = random.Random(seed)
    boot: list[float] = []
    for _ in range(n_boot):
        sample = [points[rng.randint(0, n-1)] for _ in range(n)]
        s = theil_sen(sample)
        if s is not None:
            boot.append(s)
    if not boot:
        return None
    boot.sort()
    lo = boot[int(alpha/2 * len(boot))]
    hi = boot[int((1-alpha/2) * len(boot))]
    return lo, hi


# ── Step 7: Gap analysis ──────────────────────────────────────────────────────

def gap_analysis(reps: list[DailyRep]) -> dict:
    max_gap = 0.0
    for i in range(1, len(reps)):
        ps = reps[i-1].measured_at.replace("Z", "+00:00")
        cs = reps[i].measured_at.replace("Z", "+00:00")
        gap = (datetime.fromisoformat(cs) - datetime.fromisoformat(ps)).total_seconds() / 86_400.0
        if gap > max_gap:
            max_gap = gap
    return {"max_gap_days": max_gap}


# ── Step 8: Confidence ────────────────────────────────────────────────────────

def assess_confidence(
    distinct_days: int,
    coverage_days: float,
    days_since_latest: float,
    max_gap_days: float,
    ci_width_weekly: Optional[float],
) -> str:
    """
    weight_trend_confidence_v1 scoring rules.
    Returns "low" | "medium" | "high"
    """
    # Any failing low condition → low
    if (distinct_days < CONF_MEDIUM_MIN_DAYS
            or coverage_days < CONF_MEDIUM_MIN_COVERAGE
            or days_since_latest > CONF_MEDIUM_MAX_RECENCY):
        return "low"

    # CI width cap: very wide CI → cap at low
    if ci_width_weekly is not None and ci_width_weekly > 1.0:
        return "low"

    # CI width cap: wide CI → cap at medium
    if ci_width_weekly is not None and ci_width_weekly > CONF_HIGH_MAX_CI_WIDTH_WEEKLY:
        return "medium"

    # High requirements
    if (distinct_days >= CONF_HIGH_MIN_DAYS
            and coverage_days >= CONF_HIGH_MIN_COVERAGE
            and days_since_latest <= CONF_HIGH_MAX_RECENCY
            and max_gap_days <= CONF_HIGH_MAX_GAP):
        return "high"

    return "medium"


# ── Step 9: Data quality status ───────────────────────────────────────────────

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
    window_days: int = ROLLING_WINDOW_DAYS,
) -> dict:
    global SAST
    SAST = ZoneInfo(timezone_name)

    # 1. Filter valid
    valid, excluded_ids = filter_valid(raw_entries)

    # 2. Apply rolling window
    windowed = apply_window(valid, window_days, now_iso)

    # 3. Daily representatives
    reps, rep_warnings = build_daily_representatives(windowed)

    if not reps:
        return {
            "status": "insufficient_measurements",
            "algorithm_versions": _versions(),
            "timezone": timezone_name,
            "window": {"start": None, "end": None, "elapsed_days": 0, "inclusive_calendar_days": 0},
            "measurements": {
                "raw_count": len(raw_entries), "valid_count": len(valid),
                "distinct_modelling_days": 0, "excluded_count": len(excluded_ids),
                "latest_measured_at": None, "largest_gap_days": 0,
            },
            "latest_raw_weight_kg": None,
            "latest_trend_weight_kg": None,
            "weekly_rate": None,
            "confidence": "low",
            "warnings": ["insufficient_measurements"],
            "daily_representatives": [],
            "trend_points": [],
            "flagged_measurements": [],
            "ols_diagnostic": None,
        }

    # 4. EWMA
    ewma_points = compute_ewma(reps)

    # 5. Rate from daily reps (not EWMA points)
    now_dt   = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
    anchor   = datetime.fromisoformat(reps[0].measured_at.replace("Z", "+00:00"))
    xy_pairs = [(r.elapsed_days_from(anchor), r.weight_kg) for r in reps]

    ts_slope = theil_sen(xy_pairs)
    ols_diag = ols_diagnostic(xy_pairs)
    ci       = bootstrap_ci(xy_pairs) if len(xy_pairs) >= MIN_MODELLING_DAYS_CI else None

    # 6. Window metadata
    first_dt = datetime.fromisoformat(reps[0].measured_at.replace("Z", "+00:00"))
    last_dt  = datetime.fromisoformat(reps[-1].measured_at.replace("Z", "+00:00"))
    elapsed  = (last_dt - first_dt).total_seconds() / 86_400.0

    # Inclusive calendar days
    from datetime import date as date_type
    first_local = first_dt.astimezone(SAST).date()
    last_local  = last_dt.astimezone(SAST).date()
    inclusive   = (last_local - first_local).days + 1

    gaps       = gap_analysis(reps)
    max_gap    = gaps["max_gap_days"]
    recency    = (now_dt - last_dt).total_seconds() / 86_400.0
    distinct   = len(reps)

    ci_width_weekly = ((ci[1] - ci[0]) * 7) if ci else None
    status    = determine_status(distinct, elapsed, recency)
    confidence = assess_confidence(distinct, elapsed, recency, max_gap, ci_width_weekly)

    latest_raw   = reps[-1].weight_kg
    latest_trend = ewma_points[-1].trend_weight_kg if ewma_points else None

    warnings = list(set(rep_warnings))
    if status in ("insufficient_measurements", "insufficient_coverage"):
        warnings.append(status)
    if recency > STALE_RECENCY_DAYS:
        warnings.append("stale_data")
    if max_gap > 21:
        warnings.append("large_gap")

    return {
        "status": status,
        "algorithm_versions": _versions(),
        "timezone": timezone_name,
        "window": {
            "start": reps[0].measured_at,
            "end": reps[-1].measured_at,
            "elapsed_days": round(elapsed, 6),
            "inclusive_calendar_days": inclusive,
        },
        "measurements": {
            "raw_count": len(raw_entries),
            "valid_count": len(valid),
            "distinct_modelling_days": distinct,
            "excluded_count": len(excluded_ids),
            "latest_measured_at": reps[-1].measured_at,
            "largest_gap_days": round(max_gap, 6),
        },
        "latest_raw_weight_kg": latest_raw,
        "latest_trend_weight_kg": round(latest_trend, 6) if latest_trend is not None else None,
        "weekly_rate": {
            "estimate_kg": round(ts_slope * 7, 6) if ts_slope is not None else None,
            "lower_kg":    round(ci[0] * 7, 6) if ci else None,
            "upper_kg":    round(ci[1] * 7, 6) if ci else None,
        } if ts_slope is not None else None,
        "confidence": confidence,
        "warnings": sorted(warnings),
        "daily_representatives": [
            {
                "local_date":   r.local_date,
                "measured_at":  r.measured_at,
                "weight_kg":    r.weight_kg,
                "source":       r.source,
                "warnings":     r.warnings,
            }
            for r in reps
        ],
        "trend_points": [
            {
                "local_date":       p.local_date,
                "measured_at":      p.measured_at,
                "raw_weight_kg":    p.raw_weight_kg,
                "trend_weight_kg":  round(p.trend_weight_kg, 8),
                "alpha":            round(p.alpha, 8) if p.alpha is not None else None,
                "delta_t_days":     round(p.delta_t_days, 6) if p.delta_t_days is not None else None,
            }
            for p in ewma_points
        ],
        "flagged_measurements": excluded_ids,
        "ols_diagnostic": {
            "slope_per_day":  round(ols_diag["slope_per_day"], 8),
            "weekly_rate_kg": round(ols_diag["weekly_rate_kg"], 8),
            "r_squared":      round(ols_diag["r_squared"], 6),
        } if ols_diag else None,
    }


def _versions() -> dict:
    return {
        "daily_representative": DAILY_REP_VERSION,
        "smoothing":            SMOOTHING_VERSION,
        "rate":                 RATE_VERSION,
        "confidence":           CONFIDENCE_VERSION,
    }


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import importlib.util, os
    spec_path = os.path.join(os.path.dirname(__file__), "fixtures.py")
    spec_mod  = importlib.util.spec_from_file_location("fixtures", spec_path)
    fixtures_mod = importlib.util.module_from_spec(spec_mod)
    spec_mod.loader.exec_module(fixtures_mod)

    fixture_map = {
        "A": fixtures_mod.FIXTURE_A,
        "B": fixtures_mod.FIXTURE_B,
        "C": fixtures_mod.FIXTURE_C,
        "E": fixtures_mod.FIXTURE_E,
        "G": fixtures_mod.FIXTURE_G,
        "H": fixtures_mod.FIXTURE_H,
    }

    target = sys.argv[2] if len(sys.argv) > 2 else "A"
    if target not in fixture_map:
        print(f"Unknown fixture '{target}'. Available: {list(fixture_map.keys())}", file=sys.stderr)
        sys.exit(1)

    fx = fixture_map[target]
    entries = [RawEntry(**e) for e in fx["raw_entries"]]
    result  = calculate(entries, fx["now_iso"], fx.get("timezone", "Africa/Johannesburg"))
    print(json.dumps(result, indent=2))
