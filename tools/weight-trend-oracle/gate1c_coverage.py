#!/usr/bin/env python3
"""
Gate 1C -- Sen/Kendall CI Empirical Coverage Analysis
Independent implementation; does NOT import oracle.py.
Run: python gate1c_coverage.py
"""
import math
import random
import statistics
import sys

M = 3000        # replicates per scenario
Z_95 = 1.959963985
SEED_BASE = 20260802


# ── Independent Theil-Sen estimator ─────────────────────────────────────────

def theil_sen(pts):
    """pts: list of (x_days, y_kg). Returns median pairwise slope (kg/day)."""
    slopes = []
    n = len(pts)
    for i in range(n):
        for j in range(i + 1, n):
            dx = pts[j][0] - pts[i][0]
            if dx > 0:
                slopes.append((pts[j][1] - pts[i][1]) / dx)
    if not slopes:
        return None
    slopes.sort()
    m = len(slopes)
    if m % 2 == 1:
        return slopes[m // 2]
    return (slopes[m // 2 - 1] + slopes[m // 2]) / 2.0


# ── Independent Sen/Kendall CI ───────────────────────────────────────────────

def sen_kendall_ci(pts, z=Z_95):
    """Gilbert (1987) ordered-slope interval.  Returns (lower, upper) or None."""
    slopes = []
    n = len(pts)
    for i in range(n):
        for j in range(i + 1, n):
            dx = pts[j][0] - pts[i][0]
            if dx > 0:
                slopes.append((pts[j][1] - pts[i][1]) / dx)
    if not slopes:
        return None
    slopes.sort()
    N = len(slopes)
    c_alpha = z * math.sqrt(n * (n - 1) * (2 * n + 5) / 18)
    lo = int(math.floor((N - c_alpha) / 2))
    hi = int(math.ceil((N + c_alpha) / 2))
    if lo < 0 or hi >= N:
        return None
    return slopes[lo], slopes[hi]


# ── AR(1) noise generator ────────────────────────────────────────────────────

def ar1_noise(n, sigma, phi, rng):
    """Generate n AR(1) errors with marginal std=sigma, autocorr=phi."""
    innov_sd = sigma * math.sqrt(max(1.0 - phi * phi, 1e-12))
    eps = []
    prev = 0.0
    for _ in range(n):
        # Box-Muller
        while True:
            u1 = rng.random()
            u2 = rng.random()
            if u1 > 1e-15:
                break
        z = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        e = phi * prev + innov_sd * z
        eps.append(e)
        prev = e
    return eps


# ── Generate sporadic spacing ────────────────────────────────────────────────

def sporadic_spacing(n_measurements, total_days, rng):
    """Return n_measurements x-values spread unevenly across total_days."""
    # Random uniform x in [0, total_days], sorted
    pts = sorted(rng.uniform(0, total_days) for _ in range(n_measurements))
    return pts


# ── Single scenario runner ───────────────────────────────────────────────────

def run_scenario(true_slope_per_day, spacing, n, sigma, phi, rng,
                 outlier_idx=None, outlier_sigma_mult=5.0,
                 sporadic=False, total_days=None):
    """
    Run M replicates.
    Returns dict: coverage, median_width_per_week, bias_per_week,
                  mae_per_week, n_valid.
    """
    covered = 0
    total_valid = 0
    widths = []
    biases = []
    maes = []

    for _ in range(M):
        errors = ar1_noise(n, sigma, phi, rng)

        if sporadic and total_days is not None:
            # Random positions within total_days window
            xs = sorted(rng.uniform(0, total_days) for _ in range(n))
        else:
            xs = [i * spacing for i in range(n)]

        pts = [(xs[i], true_slope_per_day * xs[i] + errors[i]) for i in range(n)]

        # Inject outlier
        if outlier_idx is not None and 0 <= outlier_idx < n:
            x_out = xs[outlier_idx]
            y_clean = true_slope_per_day * x_out
            pts[outlier_idx] = (x_out, y_clean + outlier_sigma_mult * sigma)

        est = theil_sen(pts)
        ci = sen_kendall_ci(pts)

        if est is None or ci is None:
            continue

        total_valid += 1

        # Convert to per-week units for reporting
        est_wk = est * 7.0
        true_wk = true_slope_per_day * 7.0
        ci_wk = (ci[0] * 7.0, ci[1] * 7.0)
        true_per_day = true_slope_per_day

        if ci[0] <= true_per_day <= ci[1]:
            covered += 1

        widths.append(ci_wk[1] - ci_wk[0])
        biases.append(est_wk - true_wk)
        maes.append(abs(est_wk - true_wk))

    if total_valid == 0:
        return None

    return {
        'coverage':      covered / total_valid * 100.0,
        'median_width':  statistics.median(widths),
        'bias':          statistics.mean(biases),
        'mae':           statistics.mean(maes),
        'n_valid':       total_valid,
    }


# ── Scenario definitions ─────────────────────────────────────────────────────

SCENARIOS = [
    # label, true_slope_per_week, spacing_days, n, sigma, phi, extra_kwargs
    {
        'label':     '1. Stable, independent, daily n=24',
        'slope_wk':  0.0,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.0,
        'kwargs':    {},
        'notes':     'Nominal level: 95%. Baseline independence case.',
    },
    {
        'label':     '2. Declining -0.7 kg/wk, independent, daily n=24',
        'slope_wk':  -0.7,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.0,
        'kwargs':    {},
        'notes':     'Non-zero true slope; checks estimator bias.',
    },
    {
        'label':     '3. Stable, AR(1) phi=0.30, daily n=24',
        'slope_wk':  0.0,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.30,
        'kwargs':    {},
        'notes':     'Mild serial correlation; typical for careful daily logging.',
    },
    {
        'label':     '4. Declining -0.7 kg/wk, AR(1) phi=0.30, daily n=24',
        'slope_wk':  -0.7,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.30,
        'kwargs':    {},
        'notes':     'Most realistic scenario for a dieting user.',
    },
    {
        'label':     '5. Stable, AR(1) phi=0.60, daily n=24',
        'slope_wk':  0.0,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.60,
        'kwargs':    {},
        'notes':     'Moderate serial correlation; user has consistent daily habits.',
    },
    {
        'label':     '6. Declining -0.7 kg/wk, AR(1) phi=0.60, daily n=24',
        'slope_wk':  -0.7,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.60,
        'kwargs':    {},
        'notes':     'Moderate correlation + non-zero slope.',
    },
    {
        'label':     '7. Stable, AR(1) phi=0.85, daily n=24',
        'slope_wk':  0.0,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.85,
        'kwargs':    {},
        'notes':     'Strong serial correlation upper bound.',
    },
    {
        'label':     '8. Weekly sampling, independent, n=8 (56-day window)',
        'slope_wk':  -0.7,
        'spacing':   7, 'n': 8, 'sigma': 0.5, 'phi': 0.0,
        'kwargs':    {},
        'notes':     'Weekly user, 56-day adaptive window.',
    },
    {
        'label':     '9. Weekly sampling, AR(1) phi=0.30, n=8',
        'slope_wk':  -0.7,
        'spacing':   7, 'n': 8, 'sigma': 0.5, 'phi': 0.30,
        'kwargs':    {},
        'notes':     'Weekly user with mild correlation (low between-measurement corr).',
    },
    {
        'label':     '10. Sporadic, independent, n=10 over 56 days',
        'slope_wk':  -0.7,
        'spacing':   None, 'n': 10, 'sigma': 0.5, 'phi': 0.0,
        'kwargs':    {'sporadic': True, 'total_days': 56},
        'notes':     'Irregular gaps; tests robustness to non-uniform spacing.',
    },
    {
        'label':     '11. Sporadic, AR(1) phi=0.30, n=10 over 56 days',
        'slope_wk':  -0.7,
        'spacing':   None, 'n': 10, 'sigma': 0.5, 'phi': 0.30,
        'kwargs':    {'sporadic': True, 'total_days': 56},
        'notes':     'Sporadic + mild correlation.',
    },
    {
        'label':     '12. Isolated outlier (+5 sigma at midpoint), daily n=24',
        'slope_wk':  -0.7,
        'spacing':   1, 'n': 24, 'sigma': 0.5, 'phi': 0.0,
        'kwargs':    {'outlier_idx': 12, 'outlier_sigma_mult': 5.0},
        'notes':     'One +2.5 kg spike at midpoint; tests Theil-Sen robustness.',
    },
    {
        'label':     '13. Minimal sample, independent, n=6',
        'slope_wk':  -0.7,
        'spacing':   5, 'n': 6, 'sigma': 0.5, 'phi': 0.0,
        'kwargs':    {},
        'notes':     'Minimum qualifying sample for CI; expect wider interval.',
    },
    {
        'label':     '14. Dense daily, high noise, AR(1) phi=0.45, n=28',
        'slope_wk':  -1.0,
        'spacing':   1, 'n': 28, 'sigma': 1.0, 'phi': 0.45,
        'kwargs':    {},
        'notes':     'High noise + moderate corr; aggressive dieter, salty diet.',
    },
]


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=== Gate 1C -- Sen/Kendall CI Empirical Coverage ===")
    print(f"Replicates per scenario: {M}   Nominal level: 95%")
    print(f"RNG: Python random, seeded per-scenario from base {SEED_BASE}")
    print()
    print(f"{'Scenario':<56} {'phi':>5} {'n':>4} {'cov%':>6} {'wid':>6} "
          f"{'bias':>7} {'mae':>6} {'valid':>6}")
    print("-" * 98)

    results = []
    for i, sc in enumerate(SCENARIOS):
        rng = random.Random(SEED_BASE + i * 31337)
        slope_per_day = sc['slope_wk'] / 7.0

        kwargs = dict(sc['kwargs'])
        spacing = sc.get('spacing') or 1  # fallback for sporadic

        r = run_scenario(
            true_slope_per_day=slope_per_day,
            spacing=spacing,
            n=sc['n'],
            sigma=sc['sigma'],
            phi=sc['phi'],
            rng=rng,
            **kwargs,
        )
        if r is None:
            print(f"{sc['label']:<56}  -- no valid CIs")
            continue

        flag = ""
        cov = r['coverage']
        if cov < 85.0:
            flag = " <<< BELOW 85"
        elif cov < 90.0:
            flag = " << BELOW 90"
        elif cov < 93.0:
            flag = " < BELOW 93"

        print(
            f"{sc['label']:<56} {sc['phi']:>5.2f} {sc['n']:>4d} "
            f"{cov:>6.1f} {r['median_width']:>6.3f} "
            f"{r['bias']:>+7.4f} {r['mae']:>6.4f} "
            f"{r['n_valid']:>6d}{flag}"
        )
        results.append({'label': sc['label'], **r, 'phi': sc['phi'], 'notes': sc['notes']})

    print()
    print("Columns: phi=AR coefficient, n=measurements, cov%=coverage, "
          "wid=median CI width (kg/wk), bias=mean(est-true) kg/wk, mae=MAE kg/wk")
    print()
    print("=== Interpretation ===")
    below_90 = [r for r in results if r['coverage'] < 90.0]
    below_93 = [r for r in results if 90.0 <= r['coverage'] < 93.0]
    above_93 = [r for r in results if r['coverage'] >= 93.0]

    print(f"Scenarios with coverage >= 93%: {len(above_93)}")
    print(f"Scenarios with coverage 90-93%: {len(below_93)}")
    print(f"Scenarios with coverage < 90%:  {len(below_90)}")
    print()

    if below_90:
        print("Scenarios below 90%:")
        for r in below_90:
            print(f"  {r['label']}: {r['coverage']:.1f}%")
        print()
        print("CONCLUSION: Coverage drops materially below 95% under realistic serial")
        print("  dependence. The Sen/Kendall interval makes an i.i.d. assumption that")
        print("  is not satisfied by daily weight data.")
        print()
        print("REQUIRED UI TERMINOLOGY: 'estimated uncertainty range'")
        print("  Rationale: 'assumption-dependent slope interval' is technically precise")
        print("  but likely confusing to users.  'estimated uncertainty range' correctly")
        print("  avoids promising 95% coverage while remaining interpretable.")
        print()
        print("  Do NOT use: '95% confidence interval'")
        print("  Do NOT use: '95% CI'")
        print("  USE:        'estimated uncertainty range'")
    else:
        print("Coverage >= 90% across all scenarios tested.")
        print("Coverage under independent noise: nominally 95%.")
        print("Recommended UI label: 'uncertainty range'")


if __name__ == "__main__":
    main()
