/**
 * Phase 7 — pure calculation unit tests
 *
 * All expected values are independently predetermined.
 * No database or network calls.
 */
import { describe, it, expect } from "vitest";
import {
  calculate,
  classifyNutritionQuality,
  classifyConfidence,
  ENERGY_PER_KG_KCAL,
  ENERGY_BALANCE_VERSION,
  NUTRITION_QUALITY_VERSION,
  CONFIDENCE_VERSION,
  type AdaptiveMaintenanceInput,
} from "@shared/adaptiveMaintenance";

// ── Base fixture helper ───────────────────────────────────────────────────────

function makeInput(overrides: Partial<AdaptiveMaintenanceInput> = {}): AdaptiveMaintenanceInput {
  return {
    averageIntakeKcal: 2000,
    eligibleDayCount: 24,
    analysisCalendarDays: 28,
    probablyCompleteDayCount: 0,
    weeklyRateKg: -0.5,
    rateLowerKg: -0.6,
    rateUpperKg: -0.4,
    weightTrendConfidence: "high",
    nutritionWarnings: [],
    goalPhaseId: "test-phase-id",
    equationEstimatedTdeeKcal: 2400,
    manualMaintenanceOverrideKcal: null,
    effectiveMaintenanceKcal: 2400,
    effectiveMaintenanceSource: "equation_estimate",
    ...overrides,
  };
}

// ── Fixture A: loss with complete logging ─────────────────────────────────────

describe("Fixture A — loss with complete logging", () => {
  it("calculates observed maintenance = 2,550 kcal/day", () => {
    const result = calculate(makeInput({
      averageIntakeKcal: 2000,
      weeklyRateKg: -0.5,
    }));
    expect(result).not.toBeNull();
    // 2000 − (−0.5 × 7700 / 7) = 2000 − (−550) = 2550
    expect(result!.observedMaintenanceKcal).toBeCloseTo(2550, 4);
  });

  it("calculates range lower = 2,440 and upper = 2,660 kcal/day", () => {
    const result = calculate(makeInput({
      averageIntakeKcal: 2000,
      weeklyRateKg: -0.5,
      rateLowerKg: -0.6,
      rateUpperKg: -0.4,
    }));
    expect(result).not.toBeNull();
    // lower = 2000 − (−0.4 × 7700 / 7) = 2000 − (−440) = 2440
    // upper = 2000 − (−0.6 × 7700 / 7) = 2000 − (−660) = 2660
    expect(result!.maintenanceLowerKcal).toBeCloseTo(2440, 4);
    expect(result!.maintenanceUpperKcal).toBeCloseTo(2660, 4);
  });
});

// ── Fixture B: maintenance ────────────────────────────────────────────────────

describe("Fixture B — maintenance (zero rate)", () => {
  it("observed maintenance equals average intake when rate is 0", () => {
    const result = calculate(makeInput({
      averageIntakeKcal: 2400,
      weeklyRateKg: 0,
      rateLowerKg: 0,
      rateUpperKg: 0,
    }));
    expect(result).not.toBeNull();
    expect(result!.observedMaintenanceKcal).toBeCloseTo(2400, 4);
  });
});

// ── Fixture C: gain ───────────────────────────────────────────────────────────

describe("Fixture C — gain", () => {
  it("calculates observed maintenance = 2,525 kcal/day for +0.25 kg/week gain", () => {
    const result = calculate(makeInput({
      averageIntakeKcal: 2800,
      weeklyRateKg: 0.25,
      rateLowerKg: null,
      rateUpperKg: null,
    }));
    expect(result).not.toBeNull();
    // 2800 − (0.25 × 7700 / 7) = 2800 − 275 = 2525
    expect(result!.observedMaintenanceKcal).toBeCloseTo(2525, 4);
  });
});

// ── Fixture D: Phase 6 Fixture A integration ─────────────────────────────────

describe("Fixture D — Phase 6 Fixture A rate integration", () => {
  it("matches predetermined expected values", () => {
    const result = calculate(makeInput({
      averageIntakeKcal: 1800,
      weeklyRateKg: -0.700426,
      rateLowerKg: -0.816667,
      rateUpperKg: -0.6125,
    }));
    expect(result).not.toBeNull();
    // observed = 1800 − (−0.700426 × 7700 / 7) = 1800 − (−770.4686) = 2570.4686
    expect(result!.observedMaintenanceKcal).toBeCloseTo(2570.4686, 2);
    // lower = 1800 − (−0.6125 × 7700 / 7) = 1800 − (−673.75) = 2473.75
    expect(result!.maintenanceLowerKcal).toBeCloseTo(2473.75, 2);
    // upper = 1800 − (−0.816667 × 7700 / 7) = 1800 − (−898.3337) = 2698.3337
    expect(result!.maintenanceUpperKcal).toBeCloseTo(2698.3337, 2);
  });
});

// ── Fixture E: insufficient logging ──────────────────────────────────────────

describe("Fixture E — insufficient logging", () => {
  it("returns null when eligible days < 14", () => {
    const result = calculate(makeInput({ eligibleDayCount: 12 }));
    expect(result).toBeNull();
  });

  it("returns null when coverage < 50%", () => {
    const result = calculate(makeInput({ eligibleDayCount: 10, analysisCalendarDays: 28 }));
    expect(result).toBeNull();
  });
});

// ── Fixture F: provisional logging ───────────────────────────────────────────

describe("Fixture F — provisional logging", () => {
  it("returns provisional status with ≥14 days but <20", () => {
    const result = calculate(makeInput({
      eligibleDayCount: 16,
      analysisCalendarDays: 28,
      weightTrendConfidence: "medium",
    }));
    expect(result).not.toBeNull();
    expect(result!.status).toBe("provisional");
  });

  it("returns low confidence when provisional", () => {
    const result = calculate(makeInput({
      eligibleDayCount: 16,
      analysisCalendarDays: 28,
      weightTrendConfidence: "medium",
    }));
    expect(result!.confidence).toBe("low");
  });
});

// ── Fixture G: explicit fasting ───────────────────────────────────────────────

describe("Fixture G — explicit fasting counted at zero calories", () => {
  it("eligible day count includes fasting days", () => {
    // This fixture tests only the counting logic in the pure module via
    // the eligibleDayCount input (fasting days are pre-counted by the endpoint).
    const result = calculate(makeInput({
      averageIntakeKcal: 1714.29, // 6 days × 2000 + 1 fasting day ÷ 7
      eligibleDayCount: 14,       // 13 complete + 1 fasting
      analysisCalendarDays: 28,
    }));
    expect(result).not.toBeNull();
    expect(result!.eligibleDayCount).toBe(14);
  });
});

// ── Sign convention ───────────────────────────────────────────────────────────

describe("Sign convention", () => {
  it("loss rate gives maintenance > intake", () => {
    const result = calculate(makeInput({ weeklyRateKg: -1.0, averageIntakeKcal: 1800 }));
    expect(result!.observedMaintenanceKcal).toBeGreaterThan(1800);
  });

  it("gain rate gives maintenance < intake", () => {
    const result = calculate(makeInput({ weeklyRateKg: 0.5, averageIntakeKcal: 2800 }));
    expect(result!.observedMaintenanceKcal).toBeLessThan(2800);
  });

  it("zero rate gives maintenance = intake", () => {
    const result = calculate(makeInput({ weeklyRateKg: 0, averageIntakeKcal: 2200, rateLowerKg: 0, rateUpperKg: 0 }));
    expect(result!.observedMaintenanceKcal).toBeCloseTo(2200, 4);
  });
});

// ── Range bound reversal ──────────────────────────────────────────────────────

describe("Range bound reversal", () => {
  it("lower maintenance = intake minus rate_upper (bounds reverse)", () => {
    const avgIntake = 2000;
    const rateUpper = -0.4;
    const result = calculate(makeInput({ averageIntakeKcal: avgIntake, rateLowerKg: -0.6, rateUpperKg: rateUpper }));
    const expected = avgIntake - (rateUpper * ENERGY_PER_KG_KCAL) / 7;
    expect(result!.maintenanceLowerKcal).toBeCloseTo(expected, 4);
  });

  it("upper maintenance = intake minus rate_lower", () => {
    const avgIntake = 2000;
    const rateLower = -0.6;
    const result = calculate(makeInput({ averageIntakeKcal: avgIntake, rateLowerKg: rateLower, rateUpperKg: -0.4 }));
    const expected = avgIntake - (rateLower * ENERGY_PER_KG_KCAL) / 7;
    expect(result!.maintenanceUpperKcal).toBeCloseTo(expected, 4);
  });

  it("lower < upper always holds for non-zero rate range", () => {
    const result = calculate(makeInput({ rateLowerKg: -0.8, rateUpperKg: -0.2 }));
    expect(result!.maintenanceLowerKcal!).toBeLessThan(result!.maintenanceUpperKcal!);
  });
});

// ── Null rate range ───────────────────────────────────────────────────────────

describe("Null rate range", () => {
  it("maintenanceLowerKcal and maintenanceUpperKcal are null when CI unavailable", () => {
    const result = calculate(makeInput({ rateLowerKg: null, rateUpperKg: null }));
    expect(result).not.toBeNull();
    expect(result!.maintenanceLowerKcal).toBeNull();
    expect(result!.maintenanceUpperKcal).toBeNull();
  });
});

// ── Internal decimal precision ────────────────────────────────────────────────

describe("Internal decimal precision", () => {
  it("preserves fractional precision internally", () => {
    const result = calculate(makeInput({
      averageIntakeKcal: 1800,
      weeklyRateKg: -0.700426,
    }));
    // Should NOT round to integers internally
    expect(result!.observedMaintenanceKcal).not.toBe(Math.round(result!.observedMaintenanceKcal));
  });
});

// ── Non-finite values ────────────────────────────────────────────────────────

describe("Non-finite values", () => {
  it("returns null for NaN intake", () => {
    expect(calculate(makeInput({ averageIntakeKcal: NaN }))).toBeNull();
  });

  it("returns null for Infinity weekly rate", () => {
    expect(calculate(makeInput({ weeklyRateKg: Infinity }))).toBeNull();
  });

  it("returns null for zero calendar days", () => {
    expect(calculate(makeInput({ analysisCalendarDays: 0 }))).toBeNull();
  });

  it("returns null for negative eligible day count", () => {
    expect(calculate(makeInput({ eligibleDayCount: -1 }))).toBeNull();
  });
});

// ── Differences ──────────────────────────────────────────────────────────────

describe("Equation/manual/observed separation", () => {
  it("observedMinusEquationKcal is correctly signed", () => {
    const result = calculate(makeInput({
      averageIntakeKcal: 2000,
      weeklyRateKg: -0.5,
      equationEstimatedTdeeKcal: 2400,
    }));
    // observed = 2550, equation = 2400 → diff = +150
    expect(result!.observedMinusEquationKcal).toBeCloseTo(150, 2);
  });

  it("observedMinusEquationKcal is null when equation is null", () => {
    const result = calculate(makeInput({ equationEstimatedTdeeKcal: null }));
    expect(result!.observedMinusEquationKcal).toBeNull();
  });

  it("observedMinusEffectiveKcal is null when effective is null", () => {
    const result = calculate(makeInput({ effectiveMaintenanceKcal: null }));
    expect(result!.observedMinusEffectiveKcal).toBeNull();
  });
});

// ── Confidence classification ─────────────────────────────────────────────────

describe("Confidence classification (classifyConfidence)", () => {
  it("returns high when weight=high + nutrition=high + no warnings", () => {
    expect(classifyConfidence("high", "high", [])).toBe("high");
  });

  it("returns medium when weight=medium + nutrition=usable + no warnings", () => {
    expect(classifyConfidence("medium", "usable", [])).toBe("medium");
  });

  it("returns low when weight trend confidence is low", () => {
    expect(classifyConfidence("low", "usable", [])).toBe("low");
  });

  it("returns low when nutrition is provisional", () => {
    expect(classifyConfidence("high", "provisional", [])).toBe("low");
  });

  it("returns low when material: warning present", () => {
    expect(classifyConfidence("high", "high", ["material: activity change detected"])).toBe("low");
  });
});

// ── Nutrition quality classification ─────────────────────────────────────────

describe("Nutrition quality (classifyNutritionQuality)", () => {
  it("insufficient when days < 14", () => {
    expect(classifyNutritionQuality(13, 0.9, [])).toBe("insufficient");
  });

  it("insufficient when coverage < 50%", () => {
    expect(classifyNutritionQuality(20, 0.49, [])).toBe("insufficient");
  });

  it("provisional when 14 ≤ days < 20 and coverage ≥ 50%", () => {
    expect(classifyNutritionQuality(16, 0.57, [])).toBe("provisional");
  });

  it("usable when 20 ≤ days < 24 and coverage ≥ 70%", () => {
    expect(classifyNutritionQuality(21, 0.75, [])).toBe("usable");
  });

  it("high when ≥24 days, ≥85% coverage, no material warnings", () => {
    expect(classifyNutritionQuality(24, 0.857, [])).toBe("high");
  });

  it("not high when material: warning present even with 24 days", () => {
    expect(classifyNutritionQuality(24, 0.9, ["material: unresolved items"])).toBe("usable");
  });
});

// ── Algorithm versions ────────────────────────────────────────────────────────

describe("Algorithm version constants", () => {
  it("are present and non-empty", () => {
    const result = calculate(makeInput());
    expect(result!.algorithmVersions.energyBalance).toBe(ENERGY_BALANCE_VERSION);
    expect(result!.algorithmVersions.nutritionQuality).toBe(NUTRITION_QUALITY_VERSION);
    expect(result!.algorithmVersions.confidence).toBe(CONFIDENCE_VERSION);
  });

  it("ENERGY_PER_KG_KCAL is 7700", () => {
    expect(ENERGY_PER_KG_KCAL).toBe(7700);
  });
});

// ── Limitations ──────────────────────────────────────────────────────────────

describe("Static limitations", () => {
  it("are returned in every successful result", () => {
    const result = calculate(makeInput());
    expect(Array.isArray(result!.limitations)).toBe(true);
    expect(result!.limitations.length).toBeGreaterThan(0);
  });

  it("do not claim 7700 kcal/kg is exact", () => {
    const result = calculate(makeInput());
    const combined = result!.limitations.join(" ").toLowerCase();
    expect(combined).toContain("approximation");
  });
});

// ── Usable threshold edge case ────────────────────────────────────────────────

describe("Threshold edge cases", () => {
  it("status is usable at exactly 20 eligible days and 70% coverage", () => {
    const result = calculate(makeInput({
      eligibleDayCount: 20,
      analysisCalendarDays: 28,      // 20/28 = 71.4% ≥ 70%
    }));
    expect(result!.status).toBe("usable");
  });

  it("status is provisional at exactly 14 eligible days and 50% coverage", () => {
    const result = calculate(makeInput({
      eligibleDayCount: 14,
      analysisCalendarDays: 28,      // 14/28 = 50.0% ≥ 50%
      weightTrendConfidence: "medium",
    }));
    expect(result!.status).toBe("provisional");
  });
});
