import { describe, expect, it } from "vitest";
import {
  ANTHROPOMETRY_DATA_CONTRACT_VERSION,
  ANTHROPOMETRY_REPRESENTATIVE_VERSION,
  AnthropometryValidationError,
  calculateAnthropometryRepresentative,
  calculateAnthropometryRepresentatives,
  type AnthropometryReadingInput,
} from "../../functions/_shared/anthropometry.ts";

function readings(values: number[]): AnthropometryReadingInput[] {
  return values.map((value_cm, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    reading_index: (index + 1) as 1 | 2 | 3,
    value_cm,
  }));
}

function calculate(values: number[]) {
  return calculateAnthropometryRepresentative({ site_code: "waist", readings: readings(values) });
}

function error(values: number[]) {
  try {
    calculate(values);
  } catch (caught) {
    expect(caught).toBeInstanceOf(AnthropometryValidationError);
    return caught as AnthropometryValidationError;
  }
  throw new Error("Expected validation error");
}

describe("anthropometry representative v3 frozen fixtures", () => {
  it("A: averages an agreeing pair", () => {
    expect(calculate([82, 82.4])).toMatchObject({
      representative_cm: 82.2,
      quality: "pair_agree",
      selected_reading_indices: [1, 2],
      eligible_for_interpretation: true,
    });
  });

  it.each([
    [[82, 84, 82.3], 82.15, [1, 3]],
    [[80, 80.2, 50], 80.1, [1, 2]],
  ] as const)("B/C: excludes an isolated third reading", (values, expected, indices) => {
    expect(calculate([...values])).toMatchObject({
      representative_cm: expected,
      method: "mean_of_closest_pair",
      quality: "pair_agree_with_isolated_reading",
      warning_codes: ["isolated_reading_excluded"],
      selected_reading_indices: indices,
      eligible_for_interpretation: true,
    });
  });

  it("D: resolves equal-spread ties in (1,2), (1,3), (2,3) order", () => {
    expect(calculate([80, 81, 82])).toMatchObject({
      representative_cm: 80.5,
      selected_reading_indices: [1, 2],
      quality: "pair_agree",
    });
  });

  it("E: returns a low-confidence closest-pair preview when no pair agrees", () => {
    expect(calculate([80, 82, 84.5])).toMatchObject({
      representative_cm: 81,
      selected_reading_indices: [1, 2],
      selected_pair_spread_cm: 2,
      quality: "high_variability",
      warning_codes: ["no_pair_within_repeatability_threshold"],
      eligible_for_interpretation: false,
    });
  });

  it("F: deterministically chooses readings 1 and 2 when all match", () => {
    expect(calculate([90, 90, 90])).toMatchObject({
      representative_cm: 90,
      selected_reading_indices: [1, 2],
      quality: "pair_agree",
    });
  });

  it("requires the second and then the third reading", () => {
    expect(error([80]).code).toBe("SECOND_READING_REQUIRED");
    expect(error([80, 81.1]).code).toBe("THIRD_READING_REQUIRED");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 300.1])(
    "G: rejects an invalid reading %s",
    (value) => expect(error([value, 80]).code).toBe("READING_OUT_OF_RANGE"),
  );

  it("rejects out-of-contract precision and reading count", () => {
    expect(error([80.01, 80]).code).toBe("INVALID_READING_PRECISION");
    expect(error([]).code).toBe("INVALID_READING_COUNT");
    expect(error([80, 80, 80, 80]).code).toBe("INVALID_READING_COUNT");
  });

  it("H: does not mutate readings or their objects", () => {
    const input = readings([82, 84, 82.3]);
    const before = structuredClone(input);
    calculateAnthropometryRepresentative({ site_code: "waist", readings: input });
    expect(input).toEqual(before);
  });

  it("returns full source and pairwise provenance", () => {
    expect(calculate([82, 84, 82.3])).toMatchObject({
      source_reading_ids: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000003",
      ],
      unselected_reading_id: "00000000-0000-4000-8000-000000000002",
      pairwise_differences: { d12: 2, d13: 0.3, d23: 1.7 },
      algorithm_version: "anthropometry_representative_v3",
    });
  });
});

describe("calculateAnthropometryRepresentatives", () => {
  it("rejects duplicates and keeps canonical site order", () => {
    expect(() => calculateAnthropometryRepresentatives([
      { site_code: "waist", readings: readings([80, 80.2]) },
      { site_code: "waist", readings: readings([81, 81.2]) },
    ])).toThrow(AnthropometryValidationError);

    const result = calculateAnthropometryRepresentatives([
      { site_code: "neck", readings: readings([38, 38.2]) },
      { site_code: "chest", readings: readings([98, 98.2]) },
    ]);
    expect(result.representatives.map((entry) => entry.site_code)).toEqual(["chest", "neck"]);
    expect(result.algorithm_versions).toMatchObject({
      data_contract: ANTHROPOMETRY_DATA_CONTRACT_VERSION,
      representative: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
    });
  });
});
