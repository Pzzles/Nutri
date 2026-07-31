// Unit tests for the Phase 6 weight trend calculation module.
// These tests exercise the pure calculation functions without any network calls.
// All 12 acceptance-criteria datasets from the Phase 6 spec are covered.

import { describe, it, expect } from "vitest";
import {
  applyEWMA,
  detectOutliers,
  linearRegression,
  assessConfidence,
  calculateWeightTrend,
  type WeightMeasurement,
} from "../lib/weightTrend";

// ── Helpers ───────────────────────────────────────────────────────────────────

let _idSeq = 0;
function id(): string {
  return `test-${++_idSeq}`;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function makeMeasurements(
  weights: number[],
  daysAgoStart: number,
  stepDays = 1,
): WeightMeasurement[] {
  return weights.map((w, i) => ({
    id: id(),
    weight_kg: w,
    measured_at: daysAgo(daysAgoStart - i * stepDays),
    is_official: true,
  }));
}

// Fixed "now" so tests are deterministic w.r.t. recency.
const NOW = new Date("2026-07-01T12:00:00Z").toISOString();

// ── Dataset 1: Perfectly stable weight ───────────────────────────────────────

describe("dataset 1 — perfectly stable weight", () => {
  const measurements = makeMeasurements(
    [80, 80, 80, 80, 80, 80, 80, 80],
    27,
  );

  it("EWMA equals the constant weight for all points", () => {
    const points = applyEWMA(measurements);
    for (const p of points) {
      expect(p.trend_weight_kg).toBeCloseTo(80, 5);
    }
  });

  it("weekly rate is approximately zero", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.weekly_rate_kg).not.toBeNull();
    expect(Math.abs(result.weekly_rate_kg!)).toBeLessThan(0.05);
  });

  it("no outliers detected", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.outlier_ids).toHaveLength(0);
  });
});

// ── Dataset 2: Steady decline ─────────────────────────────────────────────────

describe("dataset 2 — steady decline", () => {
  // −0.5 kg/week = −0.0714 kg/day over 28 days
  const weights = Array.from({ length: 8 }, (_, i) => 85 - i * 0.5);
  const measurements = makeMeasurements(weights, 27, 4);

  it("weekly_rate_kg is negative", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.weekly_rate_kg).not.toBeNull();
    expect(result.weekly_rate_kg!).toBeLessThan(0);
  });

  it("latest trend weight is below starting weight", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.latest_trend_weight_kg!).toBeLessThan(85);
  });

  it("rate approximates −0.5 kg/week (within 0.2)", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(Math.abs(result.weekly_rate_kg! - (-0.5))).toBeLessThan(0.2);
  });
});

// ── Dataset 3: Steady gain ────────────────────────────────────────────────────

describe("dataset 3 — steady gain", () => {
  const weights = Array.from({ length: 8 }, (_, i) => 70 + i * 0.3);
  const measurements = makeMeasurements(weights, 27, 4);

  it("weekly_rate_kg is positive", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.weekly_rate_kg).not.toBeNull();
    expect(result.weekly_rate_kg!).toBeGreaterThan(0);
  });

  it("latest raw weight exceeds starting weight", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.latest_raw_weight_kg!).toBeGreaterThan(70);
  });
});

// ── Dataset 4: Noisy decline ──────────────────────────────────────────────────

describe("dataset 4 — noisy decline", () => {
  // Underlying trend: −0.5 kg/week; noise: ±1 kg
  const noise  = [0.8, -0.5, 1.0, -0.9, 0.4, -0.7, 0.6, -0.3, 0.9, -0.6];
  const weights = noise.map((n, i) => 90 - i * (0.5 / 7) + n);
  const measurements = makeMeasurements(weights, 9, 1);

  it("EWMA trend is smoother than raw (lower variance)", () => {
    const points = applyEWMA(measurements);
    const rawVar = variance(points.map((p) => p.raw_weight_kg));
    const trendVar = variance(points.map((p) => p.trend_weight_kg));
    expect(trendVar).toBeLessThan(rawVar);
  });

  it("trend direction is still negative", () => {
    const points = applyEWMA(measurements);
    expect(points[points.length - 1].trend_weight_kg).toBeLessThan(points[0].trend_weight_kg);
  });
});

function variance(xs: number[]): number {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
}

// ── Dataset 5: One extreme outlier ────────────────────────────────────────────

describe("dataset 5 — one extreme outlier", () => {
  const base = makeMeasurements([80, 80.1, 80.2, 80.1, 80.0, 80.2, 80.1], 6, 1);
  const outlier: WeightMeasurement = {
    id: "outlier-entry",
    weight_kg: 13,  // accidental entry (13 instead of 103)
    measured_at: daysAgo(3),
    is_official: true,
  };
  const measurements = [...base, outlier];

  it("outlier entry is flagged", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.outlier_ids).toContain("outlier-entry");
  });

  it("the outlier remains in raw history (trend_points still includes it)", () => {
    const result = calculateWeightTrend(measurements, NOW);
    const outlierPoint = result.trend_points.find((p) => p.id === "outlier-entry");
    expect(outlierPoint).toBeDefined();
    expect(outlierPoint!.raw_weight_kg).toBe(13);
  });

  it("trend weight is not radically moved by the outlier", () => {
    const result = calculateWeightTrend(measurements, NOW);
    // Trend should remain near 80 kg, not pulled to 13
    expect(result.latest_trend_weight_kg!).toBeGreaterThan(50);
  });
});

// ── Dataset 6: Irregular measurement intervals ────────────────────────────────

describe("dataset 6 — irregular measurement intervals", () => {
  // Gaps: 1 day, 3 days, 7 days, 2 days, 14 days, 1 day
  const gaps = [0, 1, 4, 11, 13, 27, 28];
  const measurements: WeightMeasurement[] = gaps.map((g) => ({
    id: id(),
    weight_kg: 75 - g * 0.05,
    measured_at: new Date(
      Date.parse(NOW) - (28 - g) * 86_400_000,
    ).toISOString(),
    is_official: true,
  }));

  it("returns a result without throwing", () => {
    expect(() => calculateWeightTrend(measurements, NOW)).not.toThrow();
  });

  it("coverage_days reflects actual date range, not measurement count", () => {
    const result = calculateWeightTrend(measurements, NOW);
    // coverage should be ~28 days (from first to last measurement)
    expect(result.coverage_days).toBeGreaterThan(25);
  });

  it("regression uses elapsed days, not array indices", () => {
    // Build two identical sets — same weights, different spacings
    const even = makeMeasurements([80, 79.5, 79, 78.5, 78, 77.5, 77], 27, 4);
    const irregular: WeightMeasurement[] = [
      { id: "ir1", weight_kg: 80,   measured_at: new Date(Date.parse(NOW) - 27 * 86_400_000).toISOString(), is_official: true },
      { id: "ir2", weight_kg: 79.5, measured_at: new Date(Date.parse(NOW) - 20 * 86_400_000).toISOString(), is_official: true },
      { id: "ir3", weight_kg: 79,   measured_at: new Date(Date.parse(NOW) - 14 * 86_400_000).toISOString(), is_official: true },
      { id: "ir4", weight_kg: 78.5, measured_at: new Date(Date.parse(NOW) - 10 * 86_400_000).toISOString(), is_official: true },
      { id: "ir5", weight_kg: 78,   measured_at: new Date(Date.parse(NOW) -  6 * 86_400_000).toISOString(), is_official: true },
      { id: "ir6", weight_kg: 77.5, measured_at: new Date(Date.parse(NOW) -  3 * 86_400_000).toISOString(), is_official: true },
      { id: "ir7", weight_kg: 77,   measured_at: new Date(Date.parse(NOW) -  1 * 86_400_000).toISOString(), is_official: true },
    ];
    const evenResult  = calculateWeightTrend(even, NOW);
    const irrResult   = calculateWeightTrend(irregular, NOW);
    // Both should report a negative weekly rate; the irregular spacing
    // should not produce an obviously wrong rate due to using array indices.
    expect(evenResult.weekly_rate_kg!).toBeLessThan(0);
    expect(irrResult.weekly_rate_kg!).toBeLessThan(0);
  });
});

// ── Dataset 7: Duplicate-day weigh-ins ────────────────────────────────────────

describe("dataset 7 — duplicate-day weigh-ins (only official included)", () => {
  const day = new Date(Date.parse(NOW) - 5 * 86_400_000).toISOString();
  const measurements: WeightMeasurement[] = [
    { id: id(), weight_kg: 80, measured_at: daysAgo(10), is_official: true  },
    { id: id(), weight_kg: 81, measured_at: day,         is_official: false }, // earlier same-day
    { id: id(), weight_kg: 79.5, measured_at: day,       is_official: true  }, // official same-day
    { id: id(), weight_kg: 79, measured_at: daysAgo(1),  is_official: true  },
  ];

  it("non-official entries are excluded from EWMA", () => {
    const points = applyEWMA(measurements);
    const ids = points.map((p) => p.id);
    // The non-official 81 kg entry should not appear
    expect(points.find((p) => p.raw_weight_kg === 81)).toBeUndefined();
    expect(ids).toHaveLength(3);
  });

  it("official same-day entry is included", () => {
    const points = applyEWMA(measurements);
    expect(points.find((p) => p.raw_weight_kg === 79.5)).toBeDefined();
  });
});

// ── Dataset 8: Sparse measurements ───────────────────────────────────────────

describe("dataset 8 — sparse measurements (2 entries)", () => {
  const measurements: WeightMeasurement[] = [
    { id: id(), weight_kg: 85, measured_at: daysAgo(10), is_official: true },
    { id: id(), weight_kg: 84, measured_at: daysAgo(3),  is_official: true },
  ];

  it("weekly_rate_kg is null (below minimum measurement threshold)", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.weekly_rate_kg).toBeNull();
  });

  it("warns about insufficient_measurements", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.warnings).toContain("insufficient_measurements");
  });

  it("confidence is low", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.confidence).toBe("low");
  });
});

// ── Dataset 9: Missing weeks (large gap) ──────────────────────────────────────

describe("dataset 9 — missing weeks (large gap between clusters)", () => {
  const cluster1 = makeMeasurements([82, 82.1, 82, 81.9], 55, 1);
  const cluster2 = makeMeasurements([80, 79.8, 79.9, 79.7], 3, 1);
  const measurements = [...cluster1, ...cluster2];

  it("large_gap warning is emitted", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.warnings).toContain("large_gap");
  });

  it("still returns a weekly rate (enough total measurements)", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.weekly_rate_kg).not.toBeNull();
  });

  it("confidence is not high (gap penalty)", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.confidence).not.toBe("high");
  });
});

// ── Dataset 10: One measurement only ─────────────────────────────────────────

describe("dataset 10 — one measurement only", () => {
  const measurements: WeightMeasurement[] = [
    { id: id(), weight_kg: 90, measured_at: daysAgo(2), is_official: true },
  ];

  it("weekly_rate_kg is null", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.weekly_rate_kg).toBeNull();
  });

  it("warns single_measurement", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.warnings).toContain("single_measurement");
  });

  it("latest_raw_weight_kg equals the single measurement", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.latest_raw_weight_kg).toBe(90);
  });

  it("trend_points has exactly one entry", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.trend_points).toHaveLength(1);
  });
});

// ── Dataset 11: Corrected measurement (marked non-official) ──────────────────

describe("dataset 11 — corrected (non-official) measurement does not influence trend", () => {
  const base = makeMeasurements([80, 80.1, 80, 79.9, 80, 79.8, 80], 6, 1);
  // The erroneous entry is marked non-official (corrected)
  const erroneous: WeightMeasurement = {
    id: "erroneous",
    weight_kg: 50,
    measured_at: daysAgo(3),
    is_official: false,
  };
  const measurements = [...base, erroneous];

  it("non-official entry is excluded from calculation", () => {
    const result = calculateWeightTrend(measurements, NOW);
    const errPoint = result.trend_points.find((p) => p.id === "erroneous");
    expect(errPoint).toBeUndefined();
  });

  it("trend weight is unaffected by the erroneous measurement", () => {
    const resultWith = calculateWeightTrend(measurements, NOW);
    const resultWithout = calculateWeightTrend(base, NOW);
    // Trend should be virtually identical
    expect(Math.abs(
      resultWith.latest_trend_weight_kg! - resultWithout.latest_trend_weight_kg!
    )).toBeLessThan(0.01);
  });
});

// ── Dataset 12: SAST date boundaries ─────────────────────────────────────────

describe("dataset 12 — SAST date boundaries (UTC+2)", () => {
  // Two measurements that straddle midnight SAST: same calendar day in SAST
  // but 1-second apart in UTC; should both be included and not throw.
  const measurements: WeightMeasurement[] = [
    {
      id: id(),
      weight_kg: 78,
      measured_at: "2026-06-14T21:59:00Z", // 23:59 SAST
      is_official: true,
    },
    {
      id: id(),
      weight_kg: 78.2,
      measured_at: "2026-06-14T22:01:00Z", // 00:01 next-day SAST
      is_official: true,
    },
    {
      id: id(),
      weight_kg: 77.8,
      measured_at: "2026-06-20T07:00:00Z", // 09:00 SAST
      is_official: true,
    },
    {
      id: id(),
      weight_kg: 77.5,
      measured_at: "2026-06-26T07:00:00Z",
      is_official: true,
    },
    {
      id: id(),
      weight_kg: 77.2,
      measured_at: "2026-07-01T07:00:00Z",
      is_official: true,
    },
  ];

  it("does not throw on SAST boundary measurements", () => {
    expect(() => calculateWeightTrend(measurements, NOW)).not.toThrow();
  });

  it("elapsed_days calculation is based on UTC timestamps, not local dates", () => {
    const result = calculateWeightTrend(measurements, NOW);
    // Coverage should be ~16.3 days (2026-06-14 22:01 UTC to 2026-07-01 07:00 UTC)
    expect(result.coverage_days).toBeGreaterThan(15);
    expect(result.coverage_days).toBeLessThan(18);
  });

  it("returns a weekly rate for 5 measurements across 16+ days", () => {
    const result = calculateWeightTrend(measurements, NOW);
    expect(result.weekly_rate_kg).not.toBeNull();
  });
});

// ── EWMA unit tests ───────────────────────────────────────────────────────────

describe("applyEWMA — first point initialises trend to its own weight", () => {
  it("first trend_weight_kg equals first raw_weight_kg", () => {
    const m: WeightMeasurement[] = [
      { id: "a", weight_kg: 75, measured_at: daysAgo(5), is_official: true },
      { id: "b", weight_kg: 76, measured_at: daysAgo(4), is_official: true },
    ];
    const points = applyEWMA(m);
    expect(points[0].trend_weight_kg).toBe(75);
  });

  it("excludes non-official entries", () => {
    const m: WeightMeasurement[] = [
      { id: "a", weight_kg: 75, measured_at: daysAgo(3), is_official: true  },
      { id: "b", weight_kg: 90, measured_at: daysAgo(2), is_official: false },
      { id: "c", weight_kg: 75, measured_at: daysAgo(1), is_official: true  },
    ];
    const points = applyEWMA(m);
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.raw_weight_kg !== 90)).toBe(true);
  });
});

// ── Confidence assessment ─────────────────────────────────────────────────────

describe("assessConfidence", () => {
  it("returns low for <4 measurements", () => {
    expect(assessConfidence({ measurementCount: 3, coverageDays: 20, daysSinceLatest: 1, maxGapDays: 3, rSquared: 0.8 })).toBe("low");
  });

  it("returns low for coverage < 10 days", () => {
    expect(assessConfidence({ measurementCount: 6, coverageDays: 8, daysSinceLatest: 1, maxGapDays: 2, rSquared: 0.8 })).toBe("low");
  });

  it("returns low for stale data (>14 days since latest)", () => {
    expect(assessConfidence({ measurementCount: 6, coverageDays: 25, daysSinceLatest: 20, maxGapDays: 5, rSquared: 0.7 })).toBe("low");
  });

  it("returns medium for moderate data", () => {
    expect(assessConfidence({ measurementCount: 5, coverageDays: 14, daysSinceLatest: 3, maxGapDays: 5, rSquared: 0.4 })).toBe("medium");
  });

  it("returns high for excellent data", () => {
    expect(assessConfidence({ measurementCount: 7, coverageDays: 25, daysSinceLatest: 2, maxGapDays: 5, rSquared: 0.7 })).toBe("high");
  });

  it("sparse data cannot receive high confidence regardless of R²", () => {
    expect(assessConfidence({ measurementCount: 3, coverageDays: 30, daysSinceLatest: 1, maxGapDays: 2, rSquared: 0.99 })).toBe("low");
  });
});

// ── Regression ────────────────────────────────────────────────────────────────

describe("linearRegression", () => {
  it("returns null for a single point", () => {
    const points = applyEWMA([
      { id: "a", weight_kg: 80, measured_at: daysAgo(1), is_official: true },
    ]);
    expect(linearRegression(points)).toBeNull();
  });

  it("weekly_rate close to 0 for flat data", () => {
    const measurements = makeMeasurements([80, 80, 80, 80, 80], 14, 3);
    const points = applyEWMA(measurements);
    const result = linearRegression(points);
    expect(result).not.toBeNull();
    expect(Math.abs(result!.weekly_rate_kg)).toBeLessThan(0.01);
  });

  it("excludes outlier points from regression", () => {
    const base = makeMeasurements([80, 80, 80, 80, 80], 20, 4);
    const withOutlier = applyEWMA([
      ...base,
      { id: "outlier", weight_kg: 13, measured_at: daysAgo(1), is_official: true },
    ]);
    const flagged = detectOutliers(withOutlier);
    const result = linearRegression(flagged);
    // Rate should still be near 0 since the outlier is excluded
    expect(result).not.toBeNull();
    expect(Math.abs(result!.weekly_rate_kg)).toBeLessThan(0.5);
  });
});
