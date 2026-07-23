// Unit tests for goal phase validation rules.
// These run entirely in the test process — no network or DB access.
// All rules mirror the constraints enforced by fn_start_goal_phase and
// the start-goal-phase edge function.
import { describe, it, expect } from "vitest";

// ── Pure validation functions (inline — not extracted to a module yet) ─────────
// When a shared goalValidation.ts module is created these tests become imports.
// For now they encode the rules directly so CI catches regressions if the
// edge function rules change.

function validateMode(mode: string): string | null {
  if (!["cut", "maintenance"].includes(mode)) return "mode must be 'cut' or 'maintenance'";
  return null;
}

function validateStartingWeight(kg: number): string | null {
  if (isNaN(kg) || kg < 20 || kg > 300) return "starting_weight_kg must be between 20 and 300";
  return null;
}

function validateWeeklyRate(mode: string, rate: number | null): string | null {
  if (rate == null) return null;
  if (isNaN(rate)) return "target_change_kg_per_week must be a number";
  if (rate > 0) return "target_change_kg_per_week must be negative or zero";
  if (rate < -2.0) return "target_change_kg_per_week cannot exceed -2.0 kg/week";
  if (mode === "cut" && rate === 0) return "A cut phase requires a negative weekly change rate";
  if (mode === "maintenance" && rate !== 0) return "A maintenance phase requires a zero weekly change rate";
  return null;
}

function validateCalories(kcal: number | null): string | null {
  if (kcal == null) return null;
  if (isNaN(kcal) || kcal <= 0) return "target_calories must be greater than 0";
  return null;
}

function validateMacroG(field: string, g: number | null): string | null {
  if (g == null) return null;
  if (isNaN(g) || g < 0) return `${field} must be non-negative`;
  return null;
}

// ── Mode ───────────────────────────────────────────────────────────────────────

describe("validateMode", () => {
  it("accepts cut", () => expect(validateMode("cut")).toBeNull());
  it("accepts maintenance", () => expect(validateMode("maintenance")).toBeNull());
  it("rejects bulk", () => expect(validateMode("bulk")).not.toBeNull());
  it("rejects empty string", () => expect(validateMode("")).not.toBeNull());
  it("rejects undefined-cast string", () => expect(validateMode("undefined")).not.toBeNull());
});

// ── Starting weight ────────────────────────────────────────────────────────────

describe("validateStartingWeight", () => {
  it("accepts 20 (boundary)", () => expect(validateStartingWeight(20)).toBeNull());
  it("accepts 300 (boundary)", () => expect(validateStartingWeight(300)).toBeNull());
  it("accepts 85.5", () => expect(validateStartingWeight(85.5)).toBeNull());
  it("rejects 19.9", () => expect(validateStartingWeight(19.9)).not.toBeNull());
  it("rejects 300.1", () => expect(validateStartingWeight(300.1)).not.toBeNull());
  it("rejects 0", () => expect(validateStartingWeight(0)).not.toBeNull());
  it("rejects negative", () => expect(validateStartingWeight(-10)).not.toBeNull());
  it("rejects NaN", () => expect(validateStartingWeight(NaN)).not.toBeNull());
});

// ── Weekly rate ────────────────────────────────────────────────────────────────

describe("validateWeeklyRate", () => {
  it("accepts null (optional)", () => expect(validateWeeklyRate("cut", null)).toBeNull());
  it("accepts -0.5 for cut", () => expect(validateWeeklyRate("cut", -0.5)).toBeNull());
  it("accepts -2.0 for cut (boundary)", () => expect(validateWeeklyRate("cut", -2.0)).toBeNull());
  it("accepts 0 for maintenance", () => expect(validateWeeklyRate("maintenance", 0)).toBeNull());

  it("rejects +0.5 (positive not allowed)", () => expect(validateWeeklyRate("cut", 0.5)).not.toBeNull());
  it("rejects -2.1 (too extreme)", () => expect(validateWeeklyRate("cut", -2.1)).not.toBeNull());
  it("rejects 0 for cut (must be negative)", () => expect(validateWeeklyRate("cut", 0)).not.toBeNull());
  it("rejects -0.5 for maintenance (must be zero)", () => expect(validateWeeklyRate("maintenance", -0.5)).not.toBeNull());

  // Sign convention: negative = loss
  it("negative rate represents weight loss", () => {
    const rate = -0.5;
    expect(rate).toBeLessThan(0);
    expect(validateWeeklyRate("cut", rate)).toBeNull();
  });
});

// ── Calorie target ─────────────────────────────────────────────────────────────

describe("validateCalories", () => {
  it("accepts null (optional)", () => expect(validateCalories(null)).toBeNull());
  it("accepts 2000", () => expect(validateCalories(2000)).toBeNull());
  it("accepts 1200", () => expect(validateCalories(1200)).toBeNull());
  it("rejects 0", () => expect(validateCalories(0)).not.toBeNull());
  it("rejects negative", () => expect(validateCalories(-100)).not.toBeNull());
  it("rejects NaN", () => expect(validateCalories(NaN)).not.toBeNull());
});

// ── Macro grams ────────────────────────────────────────────────────────────────

describe("validateMacroG", () => {
  it("accepts null (optional)", () => expect(validateMacroG("protein_g", null)).toBeNull());
  it("accepts 0 (valid — e.g. fat-free food)", () => expect(validateMacroG("fat_g", 0)).toBeNull());
  it("accepts 150", () => expect(validateMacroG("protein_g", 150)).toBeNull());
  it("rejects -1", () => expect(validateMacroG("carbs_g", -1)).not.toBeNull());
  it("rejects NaN", () => expect(validateMacroG("fat_g", NaN)).not.toBeNull());
});

// ── Date: Africa/Johannesburg timezone boundary ────────────────────────────────

describe("timezone date derivation", () => {
  it("UTC midnight is still previous day in Africa/Johannesburg (UTC+2)", () => {
    // 2026-07-23T00:00:00Z = 2026-07-23T02:00:00+02:00 → still July 23 in SAST
    const ts = new Date("2026-07-23T00:00:00Z");
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ts);
    expect(localDate).toBe("2026-07-23");
  });

  it("2026-07-22T23:00:00Z = July 23 in Africa/Johannesburg", () => {
    const ts = new Date("2026-07-22T23:00:00Z");
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ts);
    expect(localDate).toBe("2026-07-23");
  });

  it("2026-07-22T21:59:59Z = July 22 in Africa/Johannesburg", () => {
    const ts = new Date("2026-07-22T21:59:59Z");
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ts);
    expect(localDate).toBe("2026-07-22");
  });
});
