import { describe, expect, it } from "vitest";
import {
  ANTHROPOMETRY_SITES,
  formatMeasurement,
  formatMeasurementChange,
  formatMeasurementInput,
  hasRepeatablePair,
  inputToCentimetres,
  needsThirdReading,
} from "../lib/anthropometry";

describe("anthropometry UI helpers", () => {
  it("keeps the frozen site order and marks only neck optional", () => {
    expect(ANTHROPOMETRY_SITES.map((site) => site.code)).toEqual([
      "chest",
      "waist",
      "abdomen_navel",
      "hips",
      "left_upper_arm_relaxed",
      "right_upper_arm_relaxed",
      "left_mid_thigh",
      "right_mid_thigh",
      "neck",
    ]);
    expect(ANTHROPOMETRY_SITES.filter((site) => site.optional).map((site) => site.code))
      .toEqual(["neck"]);
  });

  it("requires a third reading only above the exact 1.0 cm boundary", () => {
    expect(needsThirdReading([80, 81])).toBe(false);
    expect(needsThirdReading([80, 81.1])).toBe(true);
    expect(needsThirdReading([81.1, 80])).toBe(true);
  });

  it("recognizes whether any pair of three readings agrees", () => {
    expect(hasRepeatablePair([80, 81.2, 80.5])).toBe(true);
    expect(hasRepeatablePair([80, 82, 81])).toBe(true);
    expect(hasRepeatablePair([80, 81.2, 50])).toBe(false);
  });

  it("accepts centimetres at one-decimal precision", () => {
    expect(inputToCentimetres("88.4", "cm")).toEqual({ valueCm: 88.4, error: null });
    expect(inputToCentimetres("88.45", "cm").error).toMatch(/one decimal/i);
  });

  it("enforces the canonical centimetre bounds", () => {
    expect(inputToCentimetres("4.9", "cm").error).toMatch(/5.0 and 300.0/i);
    expect(inputToCentimetres("300.1", "cm").error).toMatch(/5.0 and 300.0/i);
    expect(inputToCentimetres("5.0", "cm").valueCm).toBe(5);
    expect(inputToCentimetres("300.0", "cm").valueCm).toBe(300);
  });

  it("converts inch input to canonical 0.1 cm readings", () => {
    expect(inputToCentimetres("31.50", "in")).toEqual({ valueCm: 80, error: null });
    expect(inputToCentimetres("0", "in").error).toMatch(/inches/i);
  });

  it("converts stored centimetres for display without changing the stored value", () => {
    expect(formatMeasurement(80, "cm")).toBe("80.0 cm");
    expect(formatMeasurement(80, "in")).toBe("31.5 in");
    expect(formatMeasurementInput(80, "in")).toBe("31.50");
  });

  it("formats signed longitudinal changes in either display unit", () => {
    expect(formatMeasurementChange(-3.4, "cm")).toBe("−3.4 cm");
    expect(formatMeasurementChange(2.54, "in")).toBe("+1.0 in");
    expect(formatMeasurementChange(0, "cm")).toBe("0.0 cm");
  });
});
