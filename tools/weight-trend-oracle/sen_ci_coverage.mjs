/**
 * Sen/Kendall CI empirical coverage simulation — Gate 1B §7
 *
 * Tests actual CI coverage against 7 synthetic noise models.
 * Nominal level: 95%.
 * Seeded LCG for reproducibility (seed=20260801).
 *
 * Run: node sen_ci_coverage.mjs
 */

const M = 2000;        // simulation replicates per scenario
const Z = 1.959963985; // z_{0.025}

// ── Seeded LCG RNG ─────────────────────────────────────────────────────────

function makeLCG(seed) {
  let state = seed >>> 0;
  return function () {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Box-Muller normal with correlated AR(1) errors
function arNoise(n, sigma, phi, rng) {
  const eps = [];
  const innovation_sd = sigma * Math.sqrt(1 - phi * phi);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    // Box-Muller
    const u1 = rng();
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2);
    const e = phi * prev + innovation_sd * z;
    eps.push(e);
    prev = e;
  }
  return eps;
}

// ── Core algorithms (independent of oracle.py) ────────────────────────────

function senKendallCI(points) {
  const n = points.length;
  const slopes = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = points[j][0] - points[i][0];
      const dy = points[j][1] - points[i][1];
      if (dx > 0) slopes.push(dy / dx);
    }
  }
  if (!slopes.length) return null;
  slopes.sort((a, b) => a - b);
  const N = slopes.length;
  const cAlpha = Z * Math.sqrt(n * (n - 1) * (2 * n + 5) / 18);
  const loIdx = Math.floor((N - cAlpha) / 2);
  const hiIdx = Math.ceil((N + cAlpha) / 2);
  if (loIdx < 0 || hiIdx >= N) return null;
  return [slopes[loIdx], slopes[hiIdx]];
}

// ── Simulation ────────────────────────────────────────────────────────────

function runScenario({ label, n, spacing, trueSlope, sigma, phi }) {
  const rng = makeLCG(20260801);
  let covered = 0;
  let total   = 0;

  for (let rep = 0; rep < M; rep++) {
    const errors = arNoise(n, sigma, phi, rng);
    const pts = errors.map((e, i) => {
      const x = i * spacing;
      const y = trueSlope * x + e;
      return [x, y];
    });
    const ci = senKendallCI(pts);
    if (ci === null) continue;
    total++;
    if (ci[0] <= trueSlope && trueSlope <= ci[1]) covered++;
  }

  const coverage = total > 0 ? (covered / total * 100).toFixed(1) : "N/A";
  return { label, n, phi, coverage: `${coverage}%`, covered, total };
}

// ── Scenarios ─────────────────────────────────────────────────────────────

const scenarios = [
  {
    label: "1. Independent (φ=0), n=24, daily",
    n: 24, spacing: 1, trueSlope: -0.1, sigma: 0.5, phi: 0.0,
  },
  {
    label: "2. AR(1) φ=0.30, n=24, daily",
    n: 24, spacing: 1, trueSlope: -0.1, sigma: 0.5, phi: 0.30,
  },
  {
    label: "3. AR(1) φ=0.60, n=24, daily",
    n: 24, spacing: 1, trueSlope: -0.1, sigma: 0.5, phi: 0.60,
  },
  {
    label: "4. AR(1) φ=0.85, n=24, daily (strong correlation)",
    n: 24, spacing: 1, trueSlope: -0.1, sigma: 0.5, phi: 0.85,
  },
  {
    label: "5. Independent, sparse weekly (n=8, spacing=7)",
    n: 8, spacing: 7, trueSlope: -0.014286, sigma: 0.5, phi: 0.0,
  },
  {
    label: "6. Independent, minimal sample (n=6)",
    n: 6, spacing: 1, trueSlope: -0.1, sigma: 0.5, phi: 0.0,
  },
  {
    label: "7. Stable weight (slope=0, φ=0.60, n=24)",
    n: 24, spacing: 1, trueSlope: 0.0, sigma: 0.5, phi: 0.60,
  },
];

console.log("=== Sen/Kendall CI Empirical Coverage (Gate 1B §7) ===");
console.log(`Replicates: ${M} per scenario   Nominal level: 95%`);
console.log(`RNG: LCG seed=20260801\n`);
console.log("Scenario".padEnd(50) + " φ    n   Coverage  Valid");
console.log("-".repeat(72));

let anyPoor = false;
for (const s of scenarios) {
  const r = runScenario(s);
  const pct = parseFloat(r.coverage);
  const flag = pct < 90 ? " ← BELOW 90%" : pct < 93 ? " ← below 93%" : "";
  if (pct < 90) anyPoor = true;
  console.log(
    s.label.padEnd(50) +
    String(s.phi).padStart(5) +
    String(s.n).padStart(5) +
    String(r.coverage).padStart(10) +
    String(r.total).padStart(7) +
    flag
  );
}

console.log("\n--- Interpretation ---");
if (anyPoor) {
  console.log("Coverage drops below 90% under correlated noise.");
  console.log("RECOMMENDATION: label the interval 'uncertainty range' in UI, not '95% confidence interval'.");
  console.log("Spec note: weight_rate_interval_sen_v1 assumes i.i.d. observations.");
} else {
  console.log("Coverage stays ≥ 90% across all scenarios tested.");
  console.log("RECOMMENDATION: label as 'estimated slope range' with note that it assumes independent measurements.");
}
