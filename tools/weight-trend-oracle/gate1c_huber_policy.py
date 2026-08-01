#!/usr/bin/env python3
"""
Gate 1C -- Huber Innovation Cap Re-evaluation and Policy Comparison
Independent implementation; does NOT import oracle.py.
Run: python gate1c_huber_policy.py

Analyses three policies across four baseline weights.
"""
import math

HALF_LIFE = 7.0


def time_alpha(delta_t_days):
    if delta_t_days <= 0:
        return 0.0
    return 1.0 - math.pow(2.0, -delta_t_days / HALF_LIFE)


# ── Policy definitions ────────────────────────────────────────────────────────

def cap_policy_a(trend):
    """Current Gate 1B: max(5% of trend, 5.0 kg)."""
    return max(trend * 0.05, 5.0)


def cap_policy_b(trend, fraction=0.05, min_kg=3.0, max_kg=6.0):
    """Bounded proportional: clamp(fraction*trend, min_kg, max_kg)."""
    return max(min_kg, min(trend * fraction, max_kg))


def apply_ewma_step(trend, new_weight, delta_t, cap_fn):
    """Apply one EWMA step with given cap function.  Returns (new_trend, capped)."""
    alpha = time_alpha(delta_t)
    innovation = new_weight - trend
    cap = cap_fn(trend)
    capped = abs(innovation) > cap
    if capped:
        innovation = math.copysign(cap, innovation)
    return trend + alpha * innovation, capped


# Policy C -- confirmation-dependent shift
# State: need to track the previous innovation direction for each call.
# We expose a stateful class for clarity.

class PolicyCEWMA:
    """
    Policy C: single large innovation gets limited alpha (fraction).
    If a second consecutive large innovation occurs in the same direction,
    treat as confirmed shift and apply full alpha from that point onward.

    Parameters:
      cap_fn         -- function(trend) -> cap_kg (same as Policy B)
      limited_frac   -- fraction of alpha applied when innovation > cap and unconfirmed
      confirm_count  -- number of consecutive same-direction large innovations needed
    """

    def __init__(self, cap_fn, limited_frac=0.35, confirm_count=2):
        self.cap_fn = cap_fn
        self.limited_frac = limited_frac
        self.confirm_count = confirm_count
        self._consecutive_large = 0
        self._last_direction = 0  # +1 or -1

    def step(self, trend, new_weight, delta_t):
        alpha = time_alpha(delta_t)
        innovation = new_weight - trend
        cap = self.cap_fn(trend)
        capped = abs(innovation) > cap

        if capped:
            direction = 1 if innovation > 0 else -1
            if direction == self._last_direction:
                self._consecutive_large += 1
            else:
                self._consecutive_large = 1
            self._last_direction = direction

            confirmed = self._consecutive_large >= self.confirm_count
            if confirmed:
                eff_innovation = innovation  # full innovation allowed
                capped = False
            else:
                eff_innovation = math.copysign(cap, innovation) * self.limited_frac
        else:
            self._consecutive_large = 0
            self._last_direction = 0
            eff_innovation = innovation

        return trend + alpha * eff_innovation, capped


# ── Exact Fixture J calculation ───────────────────────────────────────────────

def fixture_j_exact(baseline, spike_value, gap_days, policy_label, cap_fn_or_obj,
                    recovery_days=60):
    """
    Run the exact Fixture J scenario:
      - 14 days of stable measurements at `baseline`
      - `gap_days` gap (no measurements)
      - 1 spike measurement at `spike_value`
      - 1 return measurement at `baseline`
      - `recovery_days` of daily measurements at `baseline`

    Returns dict with all requested metrics.
    """
    # Phase 1: 14 days at baseline (daily, delta_t = 1.0 each)
    trend = baseline
    for i in range(1, 15):  # days 1..14
        if isinstance(cap_fn_or_obj, PolicyCEWMA):
            trend, _ = cap_fn_or_obj.step(trend, baseline, 1.0)
        else:
            trend, _ = apply_ewma_step(trend, baseline, 1.0, cap_fn_or_obj)

    trend_before_gap = trend

    # Phase 2: spike after gap
    alpha_gap = time_alpha(gap_days)
    innovation_raw = spike_value - trend_before_gap
    cap_val = cap_fn_or_obj.cap_fn(trend_before_gap) if isinstance(cap_fn_or_obj, PolicyCEWMA) \
              else cap_fn_or_obj(trend_before_gap)
    capped_spike = abs(innovation_raw) > cap_val

    if isinstance(cap_fn_or_obj, PolicyCEWMA):
        trend_after_spike, cap_used = cap_fn_or_obj.step(trend_before_gap, spike_value, gap_days)
    else:
        trend_after_spike, cap_used = apply_ewma_step(trend_before_gap, spike_value, gap_days, cap_fn_or_obj)

    spike_displacement = trend_after_spike - baseline

    # Phase 3: return measurement next day
    if isinstance(cap_fn_or_obj, PolicyCEWMA):
        trend_after_return, _ = cap_fn_or_obj.step(trend_after_spike, baseline, 1.0)
    else:
        trend_after_return, _ = apply_ewma_step(trend_after_spike, baseline, 1.0, cap_fn_or_obj)

    # Phase 4: daily recovery at baseline
    trend_history = [trend_after_return]
    current_trend = trend_after_return
    for _ in range(recovery_days - 1):
        if isinstance(cap_fn_or_obj, PolicyCEWMA):
            current_trend, _ = cap_fn_or_obj.step(current_trend, baseline, 1.0)
        else:
            current_trend, _ = apply_ewma_step(current_trend, baseline, 1.0, cap_fn_or_obj)
        trend_history.append(current_trend)

    # Recovery times (from day 1 after the return measurement, i.e. trend_history)
    def days_to_within(threshold):
        for i, t in enumerate(trend_history, start=1):
            if abs(t - baseline) < threshold:
                return i
        return None

    r1 = days_to_within(1.0)
    r05 = days_to_within(0.5)
    r02 = days_to_within(0.2)

    return {
        'baseline':            baseline,
        'spike_value':         spike_value,
        'gap_days':            gap_days,
        'policy':              policy_label,
        'trend_before_spike':  trend_before_gap,
        'alpha_gap':           alpha_gap,
        'raw_innovation':      innovation_raw,
        'cap_value':           cap_val,
        'capped':              capped_spike,
        'capped_innovation':   min(abs(innovation_raw), cap_val) * (1 if innovation_raw > 0 else -1),
        'trend_after_spike':   trend_after_spike,
        'spike_displacement':  spike_displacement,
        'trend_after_return':  trend_after_return,
        'days_within_1kg':     r1,
        'days_within_0_5kg':   r05,
        'days_within_0_2kg':   r02,
    }


# ── Policy comparison scenarios ───────────────────────────────────────────────

def ewma_sequence(measurements, policy_fn_or_obj, start_trend=None):
    """
    Run EWMA over (delta_t, weight) pairs.
    Returns list of trend values.
    """
    trends = []
    trend = start_trend
    for dt, w in measurements:
        if trend is None:
            trend = w
            trends.append(trend)
            continue
        if isinstance(policy_fn_or_obj, PolicyCEWMA):
            trend, _ = policy_fn_or_obj.step(trend, w, dt)
        else:
            trend, _ = apply_ewma_step(trend, w, dt, policy_fn_or_obj)
        trends.append(trend)
    return trends


def genuine_shift_response(baseline, new_level, n_shift_days, policy_label, cap_fn,
                           start_stable_days=14):
    """Measure how quickly trend follows a genuine sustained shift."""
    # Stabilise trend at baseline
    trend = baseline
    for _ in range(start_stable_days):
        trend, _ = apply_ewma_step(trend, baseline, 1.0, cap_fn)

    # Start logging at new_level daily
    day_first_within_95pct = None
    day_first_within_99pct = None
    target_95 = baseline + 0.95 * (new_level - baseline)
    target_99 = baseline + 0.99 * (new_level - baseline)

    shift = new_level - baseline
    days_history = []
    for i in range(1, n_shift_days + 1):
        trend, _ = apply_ewma_step(trend, new_level, 1.0, cap_fn)
        days_history.append((i, trend))
        if day_first_within_95pct is None and (
                (shift > 0 and trend >= target_95) or
                (shift < 0 and trend <= target_95)):
            day_first_within_95pct = i
        if day_first_within_99pct is None and (
                (shift > 0 and trend >= target_99) or
                (shift < 0 and trend <= target_99)):
            day_first_within_99pct = i

    return {
        'days_to_95pct_of_shift': day_first_within_95pct,
        'days_to_99pct_of_shift': day_first_within_99pct,
        'trend_at_day_7':  days_history[6][1] if len(days_history) >= 7 else None,
        'trend_at_day_14': days_history[13][1] if len(days_history) >= 14 else None,
        'trend_at_day_28': days_history[27][1] if len(days_history) >= 28 else None,
    }


def gradual_trend_bias(true_slope_per_day, n_days, baseline, policy_label, cap_fn):
    """Measure bias of EWMA trend vs. true value during a gradual trend."""
    trend = baseline
    errors = []
    for i in range(1, n_days + 1):
        true_w = baseline + true_slope_per_day * i
        trend, _ = apply_ewma_step(trend, true_w, 1.0, cap_fn)
        errors.append(trend - true_w)
    # steady-state bias: mean of last half
    half = n_days // 2
    return sum(errors[half:]) / len(errors[half:])


# ── Main ─────────────────────────────────────────────────────────────────────

def fmt(v, dp=3):
    if v is None:
        return 'N/A'
    return f'{v:.{dp}f}'


def main():
    # Policy cap functions
    policy_a = cap_policy_a
    policy_b = lambda t: cap_policy_b(t, fraction=0.05, min_kg=3.0, max_kg=6.0)
    policy_c_maker = lambda: PolicyCEWMA(
        cap_fn=lambda t: cap_policy_b(t, fraction=0.05, min_kg=3.0, max_kg=6.0),
        limited_frac=0.35,
        confirm_count=2,
    )

    policy_b_params_str = "clamp(5% × trend, 3.0, 6.0)"
    policy_c_params_str = "clamp(5%×trend,3.0,6.0) cap; limited_frac=0.35; confirm=2"

    # ── Section 1: Cap values by weight ──────────────────────────────────────
    print("=" * 80)
    print("§1  CAP VALUES BY WEIGHT")
    print("=" * 80)
    print(f"{'Baseline':>10}  {'Policy A':>10}  {'Policy B':>10}  notes")
    print("-" * 50)
    for w in [50, 60, 80, 100, 120, 150, 175, 200, 250]:
        ca = cap_policy_a(w)
        cb = policy_b(w)
        note = ""
        if abs(ca - cb) < 0.001:
            note = "(same)"
        elif ca > cb:
            note = f"A larger by {ca-cb:.2f} kg"
        else:
            note = f"B larger by {cb-ca:.2f} kg"
        print(f"{w:>10.0f}  {ca:>10.2f}  {cb:>10.2f}  {note}")
    print()

    # ── Section 2: Fixture J exact calculations ───────────────────────────────
    print("=" * 80)
    print("§2  EXACT FIXTURE J CALCULATIONS — 22-day gap, spike = baseline + 30 kg")
    print("    (Replicates Fixture J pattern for each baseline weight)")
    print("=" * 80)

    baselines = [60, 100, 150, 200]
    spike_delta = 30.0

    header = (f"{'Baseline':>8} {'Policy':>8} {'Cap':>6} {'Alpha':>7} "
              f"{'RawInno':>8} {'CappedInno':>11} {'PostSpike':>10} "
              f"{'Disp':>6} {'<1kg':>5} {'<0.5':>5} {'<0.2':>5}")
    print(header)
    print("-" * len(header))

    for baseline in baselines:
        spike = baseline + spike_delta
        for pol_label, cap_fn in [('A', policy_a), ('B', policy_b)]:
            r = fixture_j_exact(baseline, spike, gap_days=22,
                                policy_label=pol_label, cap_fn_or_obj=cap_fn)
            print(
                f"{baseline:>8.0f} {pol_label:>8} {r['cap_value']:>6.3f} "
                f"{r['alpha_gap']:>7.5f} {r['raw_innovation']:>8.3f} "
                f"{r['capped_innovation']:>11.3f} {r['trend_after_spike']:>10.4f} "
                f"{r['spike_displacement']:>6.3f} "
                f"{fmt(r['days_within_1kg'],0):>5} "
                f"{fmt(r['days_within_0_5kg'],0):>5} "
                f"{fmt(r['days_within_0_2kg'],0):>5}"
            )

    print()
    print("Policy C shares the same cap as Policy B for unconfirmed spikes.")
    print("For Policy C, a single unconfirmed spike applies only 35% of normal alpha.")
    print()

    # Policy C at each baseline (spike not confirmed -- only one spike measurement)
    print("Policy C (unconfirmed spike, limited_frac=0.35):")
    print(f"{'Baseline':>8} {'PostSpike':>10} {'Disp':>6} {'<1kg':>5} {'<0.5':>5} {'<0.2':>5}")
    print("-" * 44)
    for baseline in baselines:
        spike = baseline + spike_delta
        pc = policy_c_maker()
        r = fixture_j_exact(baseline, spike, gap_days=22,
                             policy_label='C', cap_fn_or_obj=pc)
        print(
            f"{baseline:>8.0f} {r['trend_after_spike']:>10.4f} "
            f"{r['spike_displacement']:>6.3f} "
            f"{fmt(r['days_within_1kg'],0):>5} "
            f"{fmt(r['days_within_0_5kg'],0):>5} "
            f"{fmt(r['days_within_0_2kg'],0):>5}"
        )

    print()

    # ── Section 3: Genuine sustained shift response ───────────────────────────
    print("=" * 80)
    print("§3  GENUINE SUSTAINED +5 KG SHIFT — daily measurements, 100 kg baseline")
    print("    Days for trend to reach 95% and 99% of new level")
    print("=" * 80)

    baseline_100 = 100.0
    new_level_105 = 105.0
    shift_days = 60

    for pol_label, cap_fn in [('A', policy_a), ('B', policy_b)]:
        r = genuine_shift_response(baseline_100, new_level_105, shift_days,
                                   pol_label, cap_fn)
        print(f"Policy {pol_label}: 95% at day {fmt(r['days_to_95pct_of_shift'],0)}, "
              f"99% at day {fmt(r['days_to_99pct_of_shift'],0)}")
        print(f"  Trend at day 7: {fmt(r['trend_at_day_7'])}, "
              f"day 14: {fmt(r['trend_at_day_14'])}, "
              f"day 28: {fmt(r['trend_at_day_28'])}")

    print()

    # Sustained 5 kg DECREASE
    new_level_95 = 95.0
    print("  -- Genuine sustained -5 kg shift --")
    for pol_label, cap_fn in [('A', policy_a), ('B', policy_b)]:
        r = genuine_shift_response(baseline_100, new_level_95, shift_days,
                                   pol_label, cap_fn)
        print(f"Policy {pol_label}: 95% at day {fmt(r['days_to_95pct_of_shift'],0)}, "
              f"99% at day {fmt(r['days_to_99pct_of_shift'],0)}")
        print(f"  Trend at day 7: {fmt(r['trend_at_day_7'])}, "
              f"day 14: {fmt(r['trend_at_day_14'])}, "
              f"day 28: {fmt(r['trend_at_day_28'])}")

    print()

    # ── Section 4: Gradual trend bias ────────────────────────────────────────
    print("=" * 80)
    print("§4  GRADUAL TREND BIAS — 0.5 kg/week decline, 100 kg baseline, 56 days")
    print("=" * 80)

    slope = -0.5 / 7.0  # kg/day
    for pol_label, cap_fn in [('A', policy_a), ('B', policy_b)]:
        bias = gradual_trend_bias(slope, 56, baseline_100, pol_label, cap_fn)
        print(f"Policy {pol_label}: steady-state lag bias = {bias:+.4f} kg "
              f"(trend is this far behind true value at steady state)")

    print()

    # ── Section 5: Weekly user response ──────────────────────────────────────
    print("=" * 80)
    print("§5  WEEKLY USER — spike at week 4 (28-day gap from last meas), 100 kg")
    print("=" * 80)

    spike = 130.0
    for pol_label, cap_fn in [('A', policy_a), ('B', policy_b)]:
        r = fixture_j_exact(100.0, spike, gap_days=7,
                            policy_label=pol_label, cap_fn_or_obj=cap_fn,
                            recovery_days=30)
        print(f"Policy {pol_label}: cap={r['cap_value']:.2f}, "
              f"post-spike trend={r['trend_after_spike']:.3f} kg, "
              f"disp={r['spike_displacement']:.3f} kg, "
              f"<1kg in {fmt(r['days_within_1kg'],0)} days")

    print()

    # ── Section 6: Policy comparison summary table ────────────────────────────
    print("=" * 80)
    print("§6  POLICY COMPARISON SUMMARY")
    print("=" * 80)

    scenarios_summary = [
        ('Isolated spike +30 kg, 1-day gap, 100 kg', 100.0, 130.0, 1,  30),
        ('Isolated spike +30 kg, 21-day gap, 100 kg', 100.0, 130.0, 21, 30),
        ('Isolated spike +30 kg, 21-day gap, 60 kg',  60.0, 90.0, 21, 30),
        ('Isolated spike +30 kg, 21-day gap, 150 kg', 150.0, 180.0, 21, 30),
        ('Isolated spike +30 kg, 21-day gap, 200 kg', 200.0, 230.0, 21, 30),
    ]

    print(f"\n{'Scenario':<45} {'Policy':>7} {'Cap':>6} {'Disp':>6} {'<1kg':>5} {'<0.5':>5}")
    print("-" * 75)
    for (desc, baseline, spike, gap, _) in scenarios_summary:
        for pol_label, cap_fn in [('A', policy_a), ('B', policy_b)]:
            r = fixture_j_exact(baseline, spike, gap_days=gap,
                                policy_label=pol_label, cap_fn_or_obj=cap_fn,
                                recovery_days=60)
            print(
                f"{desc:<45} {pol_label:>7} {r['cap_value']:>6.2f} "
                f"{r['spike_displacement']:>6.3f} "
                f"{fmt(r['days_within_1kg'],0):>5} "
                f"{fmt(r['days_within_0_5kg'],0):>5}"
            )
        print()

    # ── Section 7: Policy A justification check ───────────────────────────────
    print("=" * 80)
    print("§7  CAN POLICY A'S HIGH-WEIGHT DISPLACEMENT BE JUSTIFIED?")
    print("=" * 80)
    print()
    a_200 = fixture_j_exact(200.0, 230.0, 22, 'A', policy_a)
    b_200 = fixture_j_exact(200.0, 230.0, 22, 'B', policy_b)
    print(f"Policy A at 200 kg: cap=10.0 kg, displacement={a_200['spike_displacement']:.2f} kg, "
          f"recovery <1kg: {a_200['days_within_1kg']} days")
    print(f"Policy B at 200 kg: cap= 6.0 kg, displacement={b_200['spike_displacement']:.2f} kg, "
          f"recovery <1kg: {b_200['days_within_1kg']} days")
    print()
    print("Bathroom scale random noise is approximately 0.5-1.0 kg regardless of user weight.")
    print("Measurement error (e.g. weighing with clothes) is typically 2-4 kg.")
    print("A 10 kg one-observation trend displacement at 200 kg is not justified by")
    print("measurement error characteristics.  Policy B's 5.25 kg maximum is still large")
    print("but meaningfully better.  Policy A's 5% proportional cap was appropriate at")
    print("~100 kg but becomes excessive at higher weights.")
    print()
    print("RECOMMENDATION: Policy B with fraction=0.05, min_kg=3.0, max_kg=6.0")
    print(f"  Version: weight_time_ewma_v3")
    print(f"  At 100 kg: cap=5.0 (identical to v2; existing fixtures unchanged)")
    print(f"  At 60 kg:  cap=3.0 (reduced from v2's 5.0; protects light users)")
    print(f"  At 200 kg: cap=6.0 (reduced from v2's 10.0; protects heavy users)")


if __name__ == "__main__":
    main()
