import { describe, expect, it } from "vitest";
import { calculateWHtR } from "../../functions/_shared/bodyComposition.ts";

describe("calculateWHtR", () => {
  it("computes the correct ratio when both values are present", () => {
    // 90 cm waist, 180 cm height → 90/180 = 0.5
    const result = calculateWHtR(90, 180);
    expect(result.value).toBe(0.5);
    expect(result.provenance).toBe("calculated");
    expect(result.method).toBe("WHtR");
    expect(result.unavailable_reason).toBeUndefined();
  });

  it("rounds to 3 decimal places", () => {
    // 85 cm / 170 cm = 0.5 exactly
    expect(calculateWHtR(85, 170).value).toBe(0.5);
    // 92 cm / 175 cm = 0.52571... → 0.526
    expect(calculateWHtR(92, 175).value).toBe(0.526);
    // 100 cm / 165 cm = 0.60606... → 0.606
    expect(calculateWHtR(100, 165).value).toBe(0.606);
  });

  it("returns null and waist_missing when waist is null", () => {
    const result = calculateWHtR(null, 175);
    expect(result.value).toBeNull();
    expect(result.unavailable_reason).toBe("waist_missing");
    expect(result.provenance).toBe("calculated");
  });

  it("returns null and waist_missing when waist is undefined", () => {
    const result = calculateWHtR(undefined, 175);
    expect(result.value).toBeNull();
    expect(result.unavailable_reason).toBe("waist_missing");
  });

  it("returns null and height_missing when height is null", () => {
    const result = calculateWHtR(90, null);
    expect(result.value).toBeNull();
    expect(result.unavailable_reason).toBe("height_missing");
  });

  it("returns null and height_missing when height is undefined", () => {
    const result = calculateWHtR(90, undefined);
    expect(result.value).toBeNull();
    expect(result.unavailable_reason).toBe("height_missing");
  });

  it("returns null when both inputs are null", () => {
    const result = calculateWHtR(null, null);
    expect(result.value).toBeNull();
    // waist is checked first
    expect(result.unavailable_reason).toBe("waist_missing");
  });

  it("returns null and invalid_measurement when waist is zero", () => {
    const result = calculateWHtR(0, 175);
    expect(result.value).toBeNull();
    expect(result.unavailable_reason).toBe("invalid_measurement");
  });

  it("returns null and invalid_measurement when height is zero", () => {
    const result = calculateWHtR(90, 0);
    expect(result.value).toBeNull();
    expect(result.unavailable_reason).toBe("invalid_measurement");
  });

  it("returns null and invalid_measurement for negative waist", () => {
    expect(calculateWHtR(-1, 175).unavailable_reason).toBe("invalid_measurement");
  });

  it("returns null and invalid_measurement for negative height", () => {
    expect(calculateWHtR(90, -1).unavailable_reason).toBe("invalid_measurement");
  });

  it("always reports inputs as waist_cm and height_cm", () => {
    expect(calculateWHtR(90, 180).inputs).toEqual(["waist_cm", "height_cm"]);
    expect(calculateWHtR(null, 180).inputs).toEqual(["waist_cm", "height_cm"]);
    expect(calculateWHtR(0, 0).inputs).toEqual(["waist_cm", "height_cm"]);
  });

  it("unit invariance: same ratio when both values are scaled uniformly", () => {
    // 90 cm / 180 cm = 35.4 in / 70.9 in ≈ 0.499 (floating point)
    // Nutri always stores in cm so this test documents the invariant, not a conversion path.
    const cm = calculateWHtR(90, 180);
    const scaled = calculateWHtR(90 * 2, 180 * 2);
    expect(cm.value).toBe(scaled.value);
  });
});
