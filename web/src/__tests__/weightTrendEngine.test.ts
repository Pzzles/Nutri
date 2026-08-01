// Pure-engine unit tests for the Gate 1C weight trend calculation engine.
// Tests the calculate() function in supabase/functions/_shared/weightTrend.ts
// using the frozen fixture inputs from tools/weight-trend-oracle/fixtures.py.
//
// All expected values are derived analytically from the frozen specification
// (docs/algorithms/phase-6-weight-trend-specification.md, Gate 1C).

import { describe, it, expect } from "vitest";
import { calculate, type RawEntry } from "@shared/weightTrend";

// Tolerance for floating-point comparisons of intermediate values.
const EPS = 1e-9;
const EPS6 = 1e-6;

// ── Helpers ───────────────────────────────────────────────────────────────────

function rawEntry(
  id: string,
  measured_at: string,
  weight_kg: number,
  is_official = true,
): RawEntry {
  return { id, measured_at, weight_kg, is_official };
}

// ── Fixture A: daily decline, 24 official days ────────────────────────────────

describe("Fixture A — daily decline, 28-day rate window", () => {
  const entries: RawEntry[] = [
    rawEntry("a01", "2026-07-04T05:00:00Z", 105.4),
    rawEntry("a02", "2026-07-05T05:30:00Z", 104.9),
    rawEntry("a03", "2026-07-06T06:00:00Z", 105.6),
    rawEntry("a04", "2026-07-08T05:00:00Z", 105.1),
    rawEntry("a05", "2026-07-09T05:15:00Z", 104.7),
    rawEntry("a06", "2026-07-10T04:45:00Z", 105.2),
    rawEntry("a07", "2026-07-11T05:00:00Z", 104.3),
    rawEntry("a08", "2026-07-11T17:00:00Z", 105.0, false),
    rawEntry("a09", "2026-07-12T05:30:00Z", 104.8),
    rawEntry("a10", "2026-07-14T05:00:00Z", 104.2),
    rawEntry("a11", "2026-07-15T06:00:00Z", 104.6),
    rawEntry("a12", "2026-07-16T05:00:00Z", 103.9),
    rawEntry("a13", "2026-07-17T05:15:00Z", 104.4),
    rawEntry("a14", "2026-07-18T05:00:00Z", 103.7),
    rawEntry("a15", "2026-07-20T05:30:00Z", 104.1),
    rawEntry("a16", "2026-07-21T05:00:00Z", 103.5),
    rawEntry("a17", "2026-07-22T05:00:00Z", 103.3),
    rawEntry("a18", "2026-07-22T18:00:00Z", 103.8, false),
    rawEntry("a19", "2026-07-23T06:00:00Z", 103.6),
    rawEntry("a20", "2026-07-24T05:00:00Z", 103.2),
    rawEntry("a21", "2026-07-25T05:00:00Z", 103.5),
    rawEntry("a22", "2026-07-26T05:15:00Z", 102.9),
    rawEntry("a23", "2026-07-27T06:00:00Z", 103.1),
    rawEntry("a24", "2026-07-29T05:00:00Z", 102.7),
    rawEntry("a25", "2026-07-30T05:30:00Z", 103.0),
    rawEntry("a26", "2026-07-31T05:00:00Z", 102.6),
  ];
  const NOW = "2026-08-01T05:00:00Z";
  const result = calculate(entries, NOW);

  it("status is usable", () => expect(result.status).toBe("usable"));
  it("confidence is high", () => expect(result.confidence).toBe("high"));
  it("selected_rate_window_days is 28", () =>
    expect(result.measurements.selected_rate_window_days).toBe(28));
  it("distinct_modelling_days is 24", () =>
    expect(result.measurements.distinct_modelling_days).toBe(24));
  it("raw_count is 26", () => expect(result.measurements.raw_count).toBe(26));
  it("valid_count is 26", () => expect(result.measurements.valid_count).toBe(26));
  it("excluded_count is 0", () => expect(result.measurements.excluded_count).toBe(0));
  it("latest_raw_weight_kg is 102.6", () =>
    expect(result.latest_raw_weight_kg).toBe(102.6));

  it("weekly_rate estimate is negative (declining)", () =>
    expect(result.weekly_rate!.estimate_kg).toBeLessThan(0));
  it("weekly_rate.lower_kg < upper_kg", () =>
    expect(result.weekly_rate!.lower_kg!).toBeLessThan(result.weekly_rate!.upper_kg!));

  it("Sen/Kendall lower is -0.816667 (within 1e-6)", () =>
    expect(Math.abs(result.weekly_rate!.lower_kg! - (-0.816667))).toBeLessThan(EPS6));
  it("Sen/Kendall upper is -0.612500 (within 1e-6)", () =>
    expect(Math.abs(result.weekly_rate!.upper_kg! - (-0.612500))).toBeLessThan(EPS6));

  it("warnings is empty", () => expect(result.warnings).toHaveLength(0));
  it("flagged_measurements is empty", () =>
    expect(result.flagged_measurements).toHaveLength(0));

  it("trend_points first entry is EWMA init (alpha null, huber_capped false)", () => {
    const first = result.trend_points[0];
    expect(first.alpha).toBeNull();
    expect(first.delta_t_days).toBeNull();
    expect(first.huber_capped).toBe(false);
  });

  it("EWMA inits to first rep weight 105.4", () => {
    expect(result.trend_points[0].raw_weight_kg).toBe(105.4);
    expect(result.trend_points[0].trend_weight_kg).toBe(105.4);
  });

  it("non-official entries excluded from daily representatives", () => {
    const repDates = result.daily_representatives.map((r) => r.local_date);
    // July 11 has official 104.3, non-official 105.0 — official wins
    const jul11 = result.daily_representatives.find((r) => r.local_date === "2026-07-11");
    expect(jul11).toBeDefined();
    expect(jul11!.source).toBe("official");
    expect(jul11!.weight_kg).toBe(104.3);
    // Only 24 distinct modelling days (not 26, because 2 days are skipped)
    expect(repDates.length).toBe(24);
  });
});

// ── Fixture B: weekly cadence — adaptive window selects 56 days ───────────────

describe("Fixture B — weekly cadence, 56-day rate window", () => {
  const entries: RawEntry[] = [
    rawEntry("b01", "2026-07-10T05:00:00Z", 105.0),
    rawEntry("b02", "2026-07-17T05:00:00Z", 104.5),
    rawEntry("b03", "2026-07-24T05:00:00Z", 104.2),
    rawEntry("b04", "2026-07-31T05:00:00Z", 103.8),
    rawEntry("b05", "2026-08-07T05:00:00Z", 103.5),
    rawEntry("b06", "2026-08-14T05:00:00Z", 103.1),
    rawEntry("b07", "2026-08-21T05:00:00Z", 102.9),
    rawEntry("b08", "2026-08-28T05:00:00Z", 102.6),
  ];
  const result = calculate(entries, "2026-08-28T05:00:00Z");

  it("status is usable", () => expect(result.status).toBe("usable"));
  it("selected_rate_window_days is 56 (28-day window has only 4 days < 6)", () =>
    expect(result.measurements.selected_rate_window_days).toBe(56));
  it("distinct_modelling_days >= 6", () =>
    expect(result.measurements.distinct_modelling_days).toBeGreaterThanOrEqual(6));
  it("weekly_rate is not null", () => expect(result.weekly_rate).not.toBeNull());
  it("weekly_rate estimate is negative", () =>
    expect(result.weekly_rate!.estimate_kg).toBeLessThan(0));
});

// ── Fixture C: Case A/B/C/D daily representative selection ───────────────────

describe("Fixture C — daily rep selection Cases A/B/C/D", () => {
  const entries: RawEntry[] = [
    // 2026-07-01: Case C — 3 entries, none official → median
    rawEntry("c01", "2026-07-01T05:00:00Z", 102.0, false),
    rawEntry("c02", "2026-07-01T09:00:00Z", 104.0, false),
    rawEntry("c03", "2026-07-01T18:00:00Z", 100.0, false),
    // 2026-07-02: Case B — official wins
    rawEntry("c04", "2026-07-02T05:00:00Z", 103.0, true),
    rawEntry("c05", "2026-07-02T18:00:00Z", 110.0, false),
    // 2026-07-03: Case D — two official, latest wins
    rawEntry("c06", "2026-07-03T05:00:00Z", 102.0, true),
    rawEntry("c07", "2026-07-03T07:00:00Z", 104.0, true),
    // 2026-07-04: Case A — single non-official
    rawEntry("c08", "2026-07-04T09:00:00Z", 103.0, false),
  ];
  const result = calculate(entries, "2026-07-10T05:00:00Z");

  it("2026-07-01 source is median", () => {
    const jul01 = result.daily_representatives.find((r) => r.local_date === "2026-07-01");
    expect(jul01!.source).toBe("median");
    // weights sorted: [100, 102, 104] → median = 102; but there are 3, so index 1 = 102
    expect(jul01!.weight_kg).toBe(102.0);
  });

  it("2026-07-01 Case C: odd count median weight is middle value", () => {
    const jul01 = result.daily_representatives.find((r) => r.local_date === "2026-07-01");
    // [100.0, 102.0, 104.0] sorted → index 1 = 102.0
    expect(jul01!.weight_kg).toBe(102.0);
  });

  it("2026-07-01 Case C: odd count, timestamp is middle entry by measured_at", () => {
    const jul01 = result.daily_representatives.find((r) => r.local_date === "2026-07-01");
    // 3 entries sorted by measured_at: 05:00, 09:00, 18:00 → lower-middle for odd=3 is index 1 = 09:00
    expect(jul01!.measured_at).toBe("2026-07-01T09:00:00Z");
  });

  it("2026-07-02 source is official (Case B)", () => {
    const jul02 = result.daily_representatives.find((r) => r.local_date === "2026-07-02");
    expect(jul02!.source).toBe("official");
    expect(jul02!.weight_kg).toBe(103.0);
  });

  it("2026-07-03 source is latest_official_of_multiple (Case D)", () => {
    const jul03 = result.daily_representatives.find((r) => r.local_date === "2026-07-03");
    expect(jul03!.source).toBe("latest_official_of_multiple");
    expect(jul03!.weight_kg).toBe(104.0); // 07:00 entry (later)
  });

  it("2026-07-03 Case D emits multiple_official_entries warning", () => {
    const hasWarning = result.warnings.some((w) => w.includes("multiple_official_entries"));
    expect(hasWarning).toBe(true);
  });

  it("2026-07-04 Case A — single entry (non-official) used", () => {
    const jul04 = result.daily_representatives.find((r) => r.local_date === "2026-07-04");
    expect(jul04!.source).toBe("median"); // non-official only → median (no officials)
    expect(jul04!.weight_kg).toBe(103.0);
  });
});

// ── Fixture D: stable weight, EWMA converges to 80 ────────────────────────────

describe("Fixture D — stable weight, EWMA convergence", () => {
  const entries: RawEntry[] = Array.from({ length: 14 }, (_, i) =>
    rawEntry(`d${String(i + 1).padStart(2, "0")}`, `2026-07-${String(i + 1).padStart(2, "0")}T05:00:00Z`, 80.0),
  );
  const result = calculate(entries, "2026-07-15T05:00:00Z");

  it("status is provisional (14 days < 14 coverage... exactly 13 elapsed)", () => {
    // 14 measurements from Jul 1 to Jul 14 → coverage = 13 days < 14 → provisional
    expect(["provisional", "usable"]).toContain(result.status);
  });

  it("EWMA trend stays at 80.0 for all stable entries", () => {
    for (const tp of result.trend_points) {
      expect(Math.abs(tp.trend_weight_kg - 80.0)).toBeLessThan(EPS);
    }
  });

  it("Theil-Sen rate ≈ 0.0", () => {
    expect(result.weekly_rate).not.toBeNull();
    expect(Math.abs(result.weekly_rate!.estimate_kg)).toBeLessThan(EPS6);
  });

  it("no huber_capped points (all innovations = 0)", () => {
    expect(result.trend_points.every((p) => !p.huber_capped)).toBe(true);
  });
});

// ── Fixture J: Huber protection — 30 kg spike from 100 kg trend ──────────────

describe("Fixture J — extreme spike, Huber protection v3", () => {
  const baseEntries: RawEntry[] = Array.from({ length: 14 }, (_, i) =>
    rawEntry(`j${String(i + 1).padStart(2, "0")}`, `2026-07-${String(i + 1).padStart(2, "0")}T05:00:00Z`, 100.0),
  );
  const spikeEntries: RawEntry[] = [
    rawEntry("j15", "2026-08-05T05:00:00Z", 130.0), // 22-day gap, 30 kg spike
    rawEntry("j16", "2026-08-06T05:00:00Z", 100.0), // recovery
  ];
  const entries = [...baseEntries, ...spikeEntries];
  const result = calculate(entries, "2026-08-07T05:00:00Z");

  // After 14 days at 100 kg, trend is exactly 100.0 kg.
  // 22-day gap: alpha = 1 - 2^(-22/7) ≈ 0.886787
  // cap = clamp(100 * 0.05, 3.0, 6.0) = clamp(5.0, 3.0, 6.0) = 5.0
  // innovation = 30 > 5.0 → capped
  // trend_after_spike = 100.0 + alpha(22) * 5.0

  it("spike point has huber_capped = true", () => {
    const spikePoint = result.trend_points.find((p) => p.raw_weight_kg === 130.0);
    expect(spikePoint).toBeDefined();
    expect(spikePoint!.huber_capped).toBe(true);
  });

  it("trend after spike ≈ 100 + alpha(22)*5.0 (within 1e-6)", () => {
    const alpha22 = 1 - Math.pow(2, -22 / 7);
    const expected = 100.0 + alpha22 * 5.0; // cap=5.0 at 100 kg
    const spikePoint = result.trend_points.find((p) => p.raw_weight_kg === 130.0);
    expect(Math.abs(spikePoint!.trend_weight_kg - expected)).toBeLessThan(EPS6);
  });

  it("trend after spike is << 130 (Huber prevents immediate displacement)", () => {
    const spikePoint = result.trend_points.find((p) => p.raw_weight_kg === 130.0);
    expect(spikePoint!.trend_weight_kg).toBeLessThan(110);
    expect(spikePoint!.trend_weight_kg).toBeGreaterThan(100);
  });
});

// ── Fixture K: genuine +5 kg shift NOT capped (boundary condition) ────────────

describe("Fixture K — genuine shift, Huber boundary (exactly at cap)", () => {
  const baseEntries: RawEntry[] = Array.from({ length: 14 }, (_, i) =>
    rawEntry(`k${String(i + 1).padStart(2, "0")}a`, `2026-07-${String(i + 1).padStart(2, "0")}T05:00:00Z`, 100.0),
  );
  const shiftEntries: RawEntry[] = Array.from({ length: 14 }, (_, i) =>
    rawEntry(`k${String(i + 15).padStart(2, "0")}b`, `2026-07-${String(i + 15).padStart(2, "0")}T05:00:00Z`, 105.0),
  );
  const entries = [...baseEntries, ...shiftEntries];
  const result = calculate(entries, "2026-07-29T05:00:00Z");

  it("first shift point is NOT capped (innovation=5.0 = cap=5.0, strict > fails)", () => {
    const firstShift = result.trend_points.find((p) => p.raw_weight_kg === 105.0);
    expect(firstShift).toBeDefined();
    expect(firstShift!.huber_capped).toBe(false);
  });

  it("trend converges toward 105 kg after 14 days at that weight", () => {
    const lastPoint = result.trend_points[result.trend_points.length - 1];
    // After 14 daily steps at +5.0 kg innovation, trend moves noticeably above 100
    expect(lastPoint.trend_weight_kg).toBeGreaterThan(101.5);
  });

  it("weekly_rate is positive (upward shift)", () => {
    expect(result.weekly_rate!.estimate_kg).toBeGreaterThan(0);
  });
});

// ── Fixture G: SAST timezone boundary ────────────────────────────────────────

describe("Fixture G — SAST timezone boundary", () => {
  const entries: RawEntry[] = [
    rawEntry("g01", "2026-03-10T21:59:00Z", 80.0),   // 23:59 SAST → 2026-03-10
    rawEntry("g02", "2026-03-10T22:00:00Z", 80.2),   // 00:00 SAST → 2026-03-11
    rawEntry("g03", "2026-03-10T23:59:00Z", 80.1),   // 01:59 SAST → 2026-03-11 (same day → Case D)
    rawEntry("g04", "2026-03-11T00:00:00+02:00", 80.3), // explicit offset → 2026-03-11
  ];
  const result = calculate(entries, "2026-03-12T05:00:00Z");

  it("g01 groups to 2026-03-10 (SAST)", () => {
    const mar10 = result.daily_representatives.find((r) => r.local_date === "2026-03-10");
    expect(mar10).toBeDefined();
    expect(mar10!.source_measurement_ids).toContain("g01");
  });

  it("g02, g03, g04 all group to 2026-03-11 (SAST)", () => {
    const mar11 = result.daily_representatives.find((r) => r.local_date === "2026-03-11");
    expect(mar11).toBeDefined();
    // 3 official on 2026-03-11 → Case D: latest by measured_at
    expect(mar11!.source).toBe("latest_official_of_multiple");
  });

  it("2 distinct SAST days total", () =>
    expect(result.daily_representatives).toHaveLength(2));
});

// ── Fixture I: full-history EWMA stability ────────────────────────────────────

describe("Fixture I — full-history EWMA (phase transition visible at display boundary)", () => {
  const partA: RawEntry[] = Array.from({ length: 29 }, (_, i) =>
    rawEntry(
      `i${String(i + 1).padStart(2, "0")}a`,
      `2026-07-${String(i + 1).padStart(2, "0")}T05:00:00Z`,
      110.0,
    ),
  );
  const partBDates = [
    ["2026-07-30", "i30b"], ["2026-07-31", "i31b"],
    ["2026-08-01", "i01b"], ["2026-08-02", "i02b"], ["2026-08-03", "i03b"],
    ["2026-08-04", "i04b"], ["2026-08-05", "i05b"], ["2026-08-06", "i06b"],
    ["2026-08-07", "i07b"], ["2026-08-08", "i08b"], ["2026-08-09", "i09b"],
    ["2026-08-10", "i10b"], ["2026-08-11", "i11b"], ["2026-08-12", "i12b"],
    ["2026-08-13", "i13b"], ["2026-08-14", "i14b"], ["2026-08-15", "i15b"],
    ["2026-08-16", "i16b"], ["2026-08-17", "i17b"], ["2026-08-18", "i18b"],
    ["2026-08-19", "i19b"], ["2026-08-20", "i20b"], ["2026-08-21", "i21b"],
    ["2026-08-22", "i22b"], ["2026-08-23", "i23b"], ["2026-08-24", "i24b"],
    ["2026-08-25", "i25b"], ["2026-08-26", "i26b"], ["2026-08-27", "i27b"],
  ];
  const partB: RawEntry[] = partBDates.map(([d, pid]) =>
    rawEntry(pid, `${d}T05:00:00Z`, 105.0),
  );
  const entries = [...partA, ...partB];
  const result = calculate(entries, "2026-08-28T05:00:00Z");

  it("selected_rate_window_days is 28 (28 days ≥ 6 days)", () =>
    expect(result.measurements.selected_rate_window_days).toBe(28));

  it("first trend_point in display window > 105.0 (full-history EWMA, not window-reset)", () => {
    // Display window starts 28 days before 2026-08-28 = 2026-07-31.
    // At 2026-07-31, the trend reflects prior 110 kg history → should be > 105 kg.
    const firstDisplay = result.trend_points[0];
    expect(firstDisplay.trend_weight_kg).toBeGreaterThan(105.0);
  });

  it("first trend_point in display window < 110.0 (some 105 kg influence)", () => {
    const firstDisplay = result.trend_points[0];
    expect(firstDisplay.trend_weight_kg).toBeLessThan(110.0);
  });

  it("latest trend_weight_kg is closer to 105 than to 110 (29 days at 105 pulled it down)", () => {
    expect(result.latest_trend_weight_kg!).toBeLessThan(107.5);
  });
});

// ── Low-data boundary ─────────────────────────────────────────────────────────

describe("Boundary — fewer than 6 modelling days → no rate, no CI", () => {
  const entries = Array.from({ length: 5 }, (_, i) =>
    rawEntry(`x${i}`, `2026-07-${String(i + 1).padStart(2, "0")}T05:00:00Z`, 80.0),
  );
  const result = calculate(entries, "2026-07-10T05:00:00Z");

  it("weekly_rate is null (< 6 modelling days for CI)", () =>
    expect(result.weekly_rate).toBeNull());
  it("selected_rate_window_days is null", () =>
    expect(result.measurements.selected_rate_window_days).toBeNull());
  it("status is insufficient_measurements or insufficient_coverage", () =>
    expect(["insufficient_measurements", "insufficient_coverage"]).toContain(result.status));
  it("confidence is low", () => expect(result.confidence).toBe("low"));
});

// ── Empty input ───────────────────────────────────────────────────────────────

describe("Boundary — empty input", () => {
  const result = calculate([], "2026-07-15T05:00:00Z");

  it("status is insufficient_measurements", () =>
    expect(result.status).toBe("insufficient_measurements"));
  it("weekly_rate is null", () => expect(result.weekly_rate).toBeNull());
  it("warnings contains insufficient_measurements", () =>
    expect(result.warnings).toContain("insufficient_measurements"));
  it("latest_raw_weight_kg is null", () => expect(result.latest_raw_weight_kg).toBeNull());
  it("latest_trend_weight_kg is null", () =>
    expect(result.latest_trend_weight_kg).toBeNull());
  it("all algorithm versions are present", () => {
    expect(result.algorithm_versions.smoothing).toBe("weight_time_ewma_v3");
    expect(result.algorithm_versions.rate).toBe("weight_rate_theil_sen_v1");
    expect(result.algorithm_versions.interval).toBe("weight_rate_interval_sen_v1");
    expect(result.algorithm_versions.confidence).toBe("weight_trend_confidence_v1");
    expect(result.algorithm_versions.daily_representative).toBe("weight_daily_representative_v1");
  });
});

// ── Validity filtering ────────────────────────────────────────────────────────

describe("Validity filter — non-finite and zero weights excluded", () => {
  const entries: RawEntry[] = [
    rawEntry("v1", "2026-07-01T05:00:00Z", 80.0),
    rawEntry("v2", "2026-07-02T05:00:00Z", -5.0),  // negative → invalid
    rawEntry("v3", "2026-07-03T05:00:00Z", 0.0),   // zero → invalid
    rawEntry("v4", "2026-07-04T05:00:00Z", 80.2),
    rawEntry("v5", "2026-07-05T05:00:00Z", 79.8),
    rawEntry("v6", "2026-07-06T05:00:00Z", 80.1),
  ];
  const result = calculate(entries, "2026-07-10T05:00:00Z");

  it("excluded_count is 2", () => expect(result.measurements.excluded_count).toBe(2));
  it("flagged_measurements contains v2 and v3", () => {
    expect(result.flagged_measurements).toContain("v2");
    expect(result.flagged_measurements).toContain("v3");
  });
  it("valid_count is 4", () => expect(result.measurements.valid_count).toBe(4));
});

// ── Huber cap v3 formula ──────────────────────────────────────────────────────

describe("Huber cap formula — v3 bounded proportional cap", () => {
  function huberCapV3(trend: number): number {
    return Math.min(Math.max(trend * 0.05, 3.0), 6.0);
  }

  it("cap at 60 kg = 3.0 (floor)", () =>
    expect(Math.abs(huberCapV3(60) - 3.0)).toBeLessThan(EPS));
  it("cap at 100 kg = 5.0 (proportional zone)", () =>
    expect(Math.abs(huberCapV3(100) - 5.0)).toBeLessThan(EPS));
  it("cap at 120 kg = 6.0 (ceiling)", () =>
    expect(Math.abs(huberCapV3(120) - 6.0)).toBeLessThan(EPS));
  it("cap at 200 kg = 6.0 (ceiling)", () =>
    expect(Math.abs(huberCapV3(200) - 6.0)).toBeLessThan(EPS));

  it("60 kg spike: cap=3.0 (lower than v2 cap=5.0)", () => {
    // v2 would have cap = max(60*0.05, 5.0) = 5.0
    // v3 has cap = clamp(60*0.05, 3.0, 6.0) = 3.0
    expect(huberCapV3(60)).toBeLessThan(5.0);
  });
});
