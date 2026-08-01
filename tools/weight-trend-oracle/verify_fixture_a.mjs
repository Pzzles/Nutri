/**
 * Independent Fixture A verification — Node.js
 * Computes time-aware EWMA and Theil-Sen slope for the 24-day modelling dataset.
 * Run: node verify_fixture_a.mjs
 *
 * This script shares no code with the application implementation.
 * It is the Gate 1 independent reference calculation.
 */

// ── Fixture A: 24 official modelling days ────────────────────────────────────
// Fixed timestamps (SAST = UTC+2, morning weigh-in = 07:00 SAST = 05:00 UTC)
// Reference window: 2026-07-04 to 2026-07-31 (27 elapsed days, 28 inclusive dates)

const REPS = [
  { date: "2026-07-04", measured_at: "2026-07-04T05:00:00Z", w: 105.4 },
  { date: "2026-07-05", measured_at: "2026-07-05T05:30:00Z", w: 104.9 },
  { date: "2026-07-06", measured_at: "2026-07-06T06:00:00Z", w: 105.6 },
  // 2026-07-07 skipped
  { date: "2026-07-08", measured_at: "2026-07-08T05:00:00Z", w: 105.1 },
  { date: "2026-07-09", measured_at: "2026-07-09T05:15:00Z", w: 104.7 },
  { date: "2026-07-10", measured_at: "2026-07-10T04:45:00Z", w: 105.2 },
  { date: "2026-07-11", measured_at: "2026-07-11T05:00:00Z", w: 104.3 }, // official morning; 105.0 at 17:00Z non-official
  { date: "2026-07-12", measured_at: "2026-07-12T05:30:00Z", w: 104.8 },
  // 2026-07-13 skipped
  { date: "2026-07-14", measured_at: "2026-07-14T05:00:00Z", w: 104.2 },
  { date: "2026-07-15", measured_at: "2026-07-15T06:00:00Z", w: 104.6 },
  { date: "2026-07-16", measured_at: "2026-07-16T05:00:00Z", w: 103.9 },
  { date: "2026-07-17", measured_at: "2026-07-17T05:15:00Z", w: 104.4 },
  { date: "2026-07-18", measured_at: "2026-07-18T05:00:00Z", w: 103.7 },
  // 2026-07-19 skipped
  { date: "2026-07-20", measured_at: "2026-07-20T05:30:00Z", w: 104.1 },
  { date: "2026-07-21", measured_at: "2026-07-21T05:00:00Z", w: 103.5 },
  { date: "2026-07-22", measured_at: "2026-07-22T05:00:00Z", w: 103.3 }, // official morning; 103.8 at 18:00Z non-official
  { date: "2026-07-23", measured_at: "2026-07-23T06:00:00Z", w: 103.6 },
  { date: "2026-07-24", measured_at: "2026-07-24T05:00:00Z", w: 103.2 },
  { date: "2026-07-25", measured_at: "2026-07-25T05:00:00Z", w: 103.5 },
  { date: "2026-07-26", measured_at: "2026-07-26T05:15:00Z", w: 102.9 },
  { date: "2026-07-27", measured_at: "2026-07-27T06:00:00Z", w: 103.1 },
  // 2026-07-28 skipped
  { date: "2026-07-29", measured_at: "2026-07-29T05:00:00Z", w: 102.7 },
  { date: "2026-07-30", measured_at: "2026-07-30T05:30:00Z", w: 103.0 },
  { date: "2026-07-31", measured_at: "2026-07-31T05:00:00Z", w: 102.6 },
];

const HALF_LIFE_DAYS = 7.0;

// ── Time-aware EWMA ───────────────────────────────────────────────────────────

function timeAlpha(deltaDays) {
  return 1.0 - Math.pow(2.0, -deltaDays / HALF_LIFE_DAYS);
}

function computeEWMA(reps) {
  const results = [];
  let trend = reps[0].w; // init to first representative
  results.push({ ...reps[0], trend, alpha: null, delta_t: 0 });

  for (let i = 1; i < reps.length; i++) {
    const prevMs = new Date(reps[i - 1].measured_at).getTime();
    const currMs = new Date(reps[i].measured_at).getTime();
    const deltaDays = (currMs - prevMs) / 86_400_000;
    const alpha = timeAlpha(deltaDays);
    trend = alpha * reps[i].w + (1 - alpha) * trend;
    results.push({ ...reps[i], trend, alpha, delta_t: deltaDays });
  }
  return results;
}

// ── Theil-Sen slope ───────────────────────────────────────────────────────────

function theilSen(points /* {x, y}[] */) {
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      if (dx > 0) slopes.push(dy / dx);
    }
  }
  slopes.sort((a, b) => a - b);
  const n = slopes.length;
  const median = n % 2 === 1
    ? slopes[Math.floor(n / 2)]
    : (slopes[n / 2 - 1] + slopes[n / 2]) / 2;
  return { median_slope_per_day: median, n_pairs: n, slopes };
}

// ── OLS diagnostic ────────────────────────────────────────────────────────────

function ols(points) {
  const n = points.length;
  const sumX  = points.reduce((s, p) => s + p.x, 0);
  const sumY  = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return { slope, intercept, r_squared: r2 };
}

// ── Sen/Kendall deterministic CI ─────────────────────────────────────────────
// Authoritative v1 interval per Gate 1B §3.
// Formula: Gilbert (1987) "Statistical Methods for Environmental Pollution Monitoring"
//   N = n(n-1)/2 sorted pairwise slopes
//   c_alpha = z_{alpha/2} * sqrt(n*(n-1)*(2n+5)/18)
//   lo_idx = floor((N - c_alpha) / 2)        [0-indexed in sorted slopes]
//   hi_idx = ceil( (N + c_alpha) / 2)        [0-indexed in sorted slopes]
// Assumption: roughly i.i.d. observations. Serial correlation reduces actual coverage.
// Returns null when lo_idx <= 0 or hi_idx >= N (insufficient data for informative CI).

function senKendallCI(points, zAlpha2 = 1.959963985) {
  const n = points.length;
  const slopes = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      if (dx > 0) slopes.push(dy / dx);
    }
  }
  if (!slopes.length) return null;
  slopes.sort((a, b) => a - b);
  const N = slopes.length;
  const cAlpha = zAlpha2 * Math.sqrt(n * (n - 1) * (2 * n + 5) / 18);
  const loIdx = Math.floor((N - cAlpha) / 2);
  const hiIdx = Math.ceil((N + cAlpha) / 2);
  if (loIdx < 0 || hiIdx >= N) return null;
  return {
    lower_per_day: slopes[loIdx],
    upper_per_day: slopes[hiIdx],
    lo_idx: loIdx,
    hi_idx: hiIdx,
    n_pairs: N,
    c_alpha: cAlpha,
  };
}

// ── Bootstrap CI for Theil-Sen ────────────────────────────────────────────────

function seededRandom(seed) {
  // Simple LCG: same sequence on every run
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0xFFFFFFFF;
  };
}

function bootstrapCI(points, nBoot = 999, seed = 42, alpha = 0.05) {
  const rng = seededRandom(seed);
  const n = points.length;
  const bootSlopes = [];
  for (let b = 0; b < nBoot; b++) {
    const sample = Array.from({ length: n }, () => points[Math.floor(rng() * n)]);
    const { median_slope_per_day } = theilSen(sample);
    if (median_slope_per_day !== undefined) bootSlopes.push(median_slope_per_day);
  }
  bootSlopes.sort((a, b) => a - b);
  const lo = bootSlopes[Math.floor((alpha / 2) * bootSlopes.length)];
  const hi = bootSlopes[Math.floor((1 - alpha / 2) * bootSlopes.length)];
  return { lower_per_day: lo, upper_per_day: hi, n_boot: bootSlopes.length };
}

// ── Gap analysis ──────────────────────────────────────────────────────────────

function gapAnalysis(reps) {
  let maxGap = 0;
  for (let i = 1; i < reps.length; i++) {
    const prevMs = new Date(reps[i - 1].measured_at).getTime();
    const currMs = new Date(reps[i].measured_at).getTime();
    const gap = (currMs - prevMs) / 86_400_000;
    if (gap > maxGap) maxGap = gap;
  }
  const firstMs = new Date(reps[0].measured_at).getTime();
  const lastMs  = new Date(reps[reps.length - 1].measured_at).getTime();
  const elapsedDays = (lastMs - firstMs) / 86_400_000;
  return { max_gap_days: maxGap, elapsed_days: elapsedDays };
}

// ── Run ───────────────────────────────────────────────────────────────────────

const ewmaPoints = computeEWMA(REPS);
const lastPoint  = ewmaPoints[ewmaPoints.length - 1];

const t0Ms = new Date(REPS[0].measured_at).getTime();
const modPoints = REPS.map(r => ({
  x: (new Date(r.measured_at).getTime() - t0Ms) / 86_400_000,
  y: r.w,
}));

const ts      = theilSen(modPoints);
const olsr    = ols(modPoints);
const ci      = bootstrapCI(modPoints);
const senCi   = senKendallCI(modPoints);
const gaps    = gapAnalysis(REPS);

console.log("=== Fixture A — Independent Verification ===\n");
console.log(`Modelling days:          ${REPS.length}`);
console.log(`Raw rows:                26 (24 official + 2 non-official, excluded from modelling)`);
console.log(`Elapsed days (first→last): ${gaps.elapsed_days.toFixed(6)}`);
console.log(`Inclusive calendar days: 28`);
console.log(`Largest gap (days):      ${gaps.max_gap_days.toFixed(6)}`);
console.log();
console.log("--- Time-aware EWMA (half_life=7) ---");
console.log("Step-by-step EWMA:");
ewmaPoints.forEach(p => {
  const alphaStr = p.alpha === null ? "init" : p.alpha.toFixed(8);
  const dtStr    = p.alpha === null ? "—   " : p.delta_t.toFixed(4);
  console.log(`  ${p.date}  w=${p.w.toFixed(1)}  delta_t=${dtStr}  alpha=${alphaStr}  trend=${p.trend.toFixed(8)}`);
});
console.log();
console.log(`Latest raw weight:       ${REPS[REPS.length - 1].w.toFixed(6)} kg`);
console.log(`Latest trend (EWMA):     ${lastPoint.trend.toFixed(8)} kg`);
console.log();
console.log("--- Theil-Sen Rate ---");
console.log(`Pairs computed:          ${ts.n_pairs}`);
console.log(`Median slope (per day):  ${ts.median_slope_per_day.toFixed(8)} kg/day`);
console.log(`Weekly rate (×7):        ${(ts.median_slope_per_day * 7).toFixed(8)} kg/week`);
console.log();
console.log("--- Sen/Kendall CI (95%, deterministic) — AUTHORITATIVE v1 ---");
if (senCi) {
  console.log(`n_pairs (N):             ${senCi.n_pairs}`);
  console.log(`c_alpha:                 ${senCi.c_alpha.toFixed(6)}`);
  console.log(`lo_idx (0-based):        ${senCi.lo_idx}`);
  console.log(`hi_idx (0-based):        ${senCi.hi_idx}`);
  console.log(`Lower (per day):         ${senCi.lower_per_day.toFixed(8)} kg/day`);
  console.log(`Upper (per day):         ${senCi.upper_per_day.toFixed(8)} kg/day`);
  console.log(`Weekly CI:               [${(senCi.lower_per_day * 7).toFixed(6)}, ${(senCi.upper_per_day * 7).toFixed(6)}] kg/week`);
} else {
  console.log("  (insufficient data for Sen/Kendall CI)");
}
console.log();
console.log("--- Bootstrap CI (95%, seed=42, n=999) — RESEARCH REFERENCE ONLY ---");
console.log(`Lower (per day):         ${ci.lower_per_day.toFixed(8)} kg/day`);
console.log(`Upper (per day):         ${ci.upper_per_day.toFixed(8)} kg/day`);
console.log(`Weekly CI:               [${(ci.lower_per_day * 7).toFixed(4)}, ${(ci.upper_per_day * 7).toFixed(4)}] kg/week`);
console.log();
console.log("--- OLS Diagnostic ---");
console.log(`Slope (per day):         ${olsr.slope.toFixed(8)} kg/day`);
console.log(`Weekly rate (×7):        ${(olsr.slope * 7).toFixed(8)} kg/week`);
console.log(`R²:                      ${olsr.r_squared.toFixed(6)}`);
console.log();
console.log("--- Comparison with provisional values ---");
console.log(`Provisional EWMA:        103.542168  |  computed: ${lastPoint.trend.toFixed(6)}`);
console.log(`Provisional TS:          -0.700000   |  computed: ${(ts.median_slope_per_day * 7).toFixed(6)}`);
console.log(`Provisional OLS:         -0.719560   |  computed: ${(olsr.slope * 7).toFixed(6)}`);
