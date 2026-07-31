// Unit tests for the frontend energy calculation engine (web/src/lib/energyCalc.ts).
// These are pure function tests — no I/O, no mocking.
import { describe, it, expect } from "vitest";
import {
  calculateAgeYears,
  calculateBMR,
  getActivityMultiplier,
  resolveMaintenanceKcal,
  calculateDailyAdjustment,
  isAggressiveRate,
  runLiveEnergyCalc,
} from "../lib/energyCalc";

// ── calculateAgeYears ─────────────────────────────────────────────────────────

describe("calculateAgeYears", () => {
  it("returns correct age when birthday has already passed this year", () => {
    // Born 1990-01-15; calc on 2026-07-31 → turned 36 this year already
    expect(calculateAgeYears("1990-01-15", "2026-07-31")).toBe(36);
  });

  it("returns age minus one when birthday has not yet occurred this year", () => {
    // Born 1990-12-25; calc on 2026-07-31 → hasn't turned 36 yet
    expect(calculateAgeYears("1990-12-25", "2026-07-31")).toBe(35);
  });

  it("returns correct age on the exact birthday", () => {
    expect(calculateAgeYears("1990-07-31", "2026-07-31")).toBe(36);
  });
});

// ── calculateBMR ──────────────────────────────────────────────────────────────
// Mifflin–St Jeor: BMR = 10×weight + 6.25×height − 5×age + sex_constant
// Male constant: +5, Female constant: −161

describe("calculateBMR", () => {
  it("calculates correct male BMR", () => {
    // 10*80 + 6.25*175 − 5*30 + 5 = 800 + 1093.75 − 150 + 5 = 1748.75
    const bmr = calculateBMR({ weight_kg: 80, height_cm: 175, age_years: 30, equation_sex: "male" });
    expect(bmr).toBeCloseTo(1748.75, 2);
  });

  it("calculates correct female BMR", () => {
    // 10*65 + 6.25*165 − 5*28 − 161 = 650 + 1031.25 − 140 − 161 = 1380.25
    const bmr = calculateBMR({ weight_kg: 65, height_cm: 165, age_years: 28, equation_sex: "female" });
    expect(bmr).toBeCloseTo(1380.25, 2);
  });

  it("sex constant difference is exactly 166 (5 − (−161))", () => {
    const inputs = { weight_kg: 70, height_cm: 170, age_years: 30 };
    const male   = calculateBMR({ ...inputs, equation_sex: "male" });
    const female = calculateBMR({ ...inputs, equation_sex: "female" });
    expect(male - female).toBeCloseTo(166, 6);
  });
});

// ── getActivityMultiplier ─────────────────────────────────────────────────────

describe("getActivityMultiplier", () => {
  it.each([
    ["sedentary",   1.200],
    ["light",       1.375],
    ["moderate",    1.550],
    ["active",      1.725],
    ["very_active", 1.900],
  ])("%s → %f", (level, expected) => {
    expect(getActivityMultiplier(level)).toBe(expected);
  });

  it("throws for unknown activity level", () => {
    expect(() => getActivityMultiplier("extreme_athlete")).toThrow();
  });
});

// ── resolveMaintenanceKcal ────────────────────────────────────────────────────

describe("resolveMaintenanceKcal", () => {
  it("returns equation_estimate when no manual value", () => {
    const { effective, source } = resolveMaintenanceKcal(2500);
    expect(source).toBe("equation_estimate");
    expect(effective).toBe(2500);
  });

  it("returns manual_override when manual value is within bounds", () => {
    const { effective, source } = resolveMaintenanceKcal(2500, 2800);
    expect(source).toBe("manual_override");
    expect(effective).toBe(2800);
  });

  it("falls back to equation when manual is below 500", () => {
    const { source } = resolveMaintenanceKcal(2500, 400);
    expect(source).toBe("equation_estimate");
  });

  it("falls back to equation when manual exceeds 10,000", () => {
    const { source } = resolveMaintenanceKcal(2500, 12000);
    expect(source).toBe("equation_estimate");
  });

  it("falls back to equation for null manual", () => {
    const { source } = resolveMaintenanceKcal(2500, null);
    expect(source).toBe("equation_estimate");
  });
});

// ── calculateDailyAdjustment ──────────────────────────────────────────────────

describe("calculateDailyAdjustment", () => {
  it("returns negative for a cut rate", () => {
    // −0.5 kg/week × 7700 ÷ 7 = −550 kcal/day
    expect(calculateDailyAdjustment(-0.5)).toBeCloseTo(-550, 4);
  });

  it("returns positive for a bulk rate", () => {
    expect(calculateDailyAdjustment(0.5)).toBeCloseTo(550, 4);
  });

  it("returns 0 for maintenance", () => {
    expect(calculateDailyAdjustment(0)).toBe(0);
  });
});

// ── isAggressiveRate ──────────────────────────────────────────────────────────

describe("isAggressiveRate", () => {
  it("flags as aggressive when abs(rate)/weight > 0.01", () => {
    // 0.9 kg/week with 80 kg body weight → 0.9/80 = 0.01125 > 0.01
    expect(isAggressiveRate(-0.9, 80)).toBe(true);
  });

  it("does not flag exactly at the threshold (0.01 × weight)", () => {
    // 0.8 kg/week with 80 kg body weight → 0.8/80 = 0.01 → NOT > 0.01
    expect(isAggressiveRate(-0.8, 80)).toBe(false);
  });

  it("does not flag conservative rates", () => {
    expect(isAggressiveRate(-0.5, 80)).toBe(false);
  });

  it("handles bulk rates too", () => {
    expect(isAggressiveRate(1.0, 80)).toBe(true);
  });

  it("returns false for zero weight (guard)", () => {
    expect(isAggressiveRate(-1.0, 0)).toBe(false);
  });
});

// ── runLiveEnergyCalc ─────────────────────────────────────────────────────────

describe("runLiveEnergyCalc", () => {
  const BASE_INPUTS = {
    birth_date: "1990-07-31",        // turns 36 on 2026-07-31
    equation_sex: "male" as const,
    height_cm: 175,
    weight_kg: 80,
    activity_level: "moderate" as const,
    goal_mode: "cut" as const,
    target_change_kg_per_week: -0.5,
  };

  it("returns a result with all expected fields for a cut phase", () => {
    const result = runLiveEnergyCalc(BASE_INPUTS);
    expect(result.estimated_bmr_kcal).toBeGreaterThan(0);
    expect(result.estimated_tdee_kcal).toBeGreaterThan(result.estimated_bmr_kcal);
    expect(result.daily_adjustment_kcal).toBeCloseTo(-550, 4);
    expect(result.raw_target_kcal).toBeCloseTo(result.effective_maintenance_kcal - 550, 1);
    expect(result.maintenance_source).toBe("equation_estimate");
    expect(result.warnings).not.toContain("target_below_floor");
  });

  it("sets rate to 0 and no adjustment for maintenance mode", () => {
    const result = runLiveEnergyCalc({
      ...BASE_INPUTS,
      goal_mode: "maintenance",
      target_change_kg_per_week: 0,
    });
    expect(result.daily_adjustment_kcal).toBe(0);
    expect(result.raw_target_kcal).toBeCloseTo(result.effective_maintenance_kcal, 1);
  });

  it("uses manual_override when within bounds", () => {
    const result = runLiveEnergyCalc({ ...BASE_INPUTS, manual_maintenance_kcal: 3000 });
    expect(result.maintenance_source).toBe("manual_override");
    expect(result.effective_maintenance_kcal).toBe(3000);
    expect(result.raw_target_kcal).toBeCloseTo(3000 - 550, 1);
  });

  it("adds aggressive_rate warning for rate > 1% body weight/week", () => {
    const result = runLiveEnergyCalc({
      ...BASE_INPUTS,
      target_change_kg_per_week: -0.9, // 0.9/80 = 1.125% > 1%
    });
    expect(result.warnings).toContain("aggressive_rate");
    expect(result.is_aggressive_rate).toBe(true);
  });

  it("adds target_below_floor warning when target < 1000 kcal", () => {
    // Use very aggressive cut on a very low manual maintenance
    const result = runLiveEnergyCalc({
      ...BASE_INPUTS,
      manual_maintenance_kcal: 1200,
      target_change_kg_per_week: -0.5, // 1200 - 550 = 650 < 1000
    });
    expect(result.warnings).toContain("target_below_floor");
    expect(result.raw_target_kcal).toBeLessThan(1000);
  });

  it("bulk phase: positive adjustment increases the target", () => {
    const result = runLiveEnergyCalc({
      ...BASE_INPUTS,
      goal_mode: "bulk",
      target_change_kg_per_week: 0.3,
    });
    expect(result.daily_adjustment_kcal).toBeCloseTo(330, 1);
    expect(result.raw_target_kcal).toBeGreaterThan(result.effective_maintenance_kcal);
  });
});
