/**
 * Phase 10 Gate 2 pure tests.
 *
 * These tests exercise only the deterministic representative engine. They do
 * not mock Supabase or an Edge Function. Authenticated database/API behaviour
 * belongs to Prompt 3's real-backend integration suite.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANTHROPOMETRY_DATA_CONTRACT_VERSION,
  ANTHROPOMETRY_MAX_READING_TENTHS,
  ANTHROPOMETRY_MIN_READING_TENTHS,
  ANTHROPOMETRY_PROTOCOL_VERSION,
  ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS,
  ANTHROPOMETRY_REPRESENTATIVE_VERSION,
  ANTHROPOMETRY_SITE_CODES,
  ANTHROPOMETRY_THRESHOLDS_VERSION,
  AnthropometryValidationError,
  calculateAnthropometryRepresentative,
  calculateAnthropometryRepresentatives,
} from "../../functions/_shared/anthropometry.ts";

interface FrozenRepresentativeFixture {
  id: string;
  site_code: string;
  readings_cm: number[];
  expected: {
    representative_cm: number;
    method: string;
    reading_count: number;
    initial_pair_difference_cm: number;
    all_readings_range_cm: number;
    quality: string;
  };
}

interface FrozenFixtureFile {
  algorithm_versions: Record<string, string>;
  representative_fixtures: FrozenRepresentativeFixture[];
}

const fixturePath = fileURLToPath(
  new URL(
    "../../../docs/testing/phase-10-anthropometry-fixtures.json",
    import.meta.url,
  ),
);
const frozenFixtures = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as FrozenFixtureFile;

function captureValidationError(run: () => unknown): AnthropometryValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AnthropometryValidationError);
    return error as AnthropometryValidationError;
  }
  throw new Error("Expected AnthropometryValidationError");
}

describe("anthropometry representative engine — frozen fixture parity", () => {
  for (const fixture of frozenFixtures.representative_fixtures) {
    it(`${fixture.id} matches the independently frozen representative`, () => {
      const result = calculateAnthropometryRepresentative(fixture);

      expect(result).toMatchObject({
        site_code: fixture.site_code,
        readings_cm: fixture.readings_cm,
        representative_cm: fixture.expected.representative_cm,
        method: fixture.expected.method,
        reading_count: fixture.expected.reading_count,
        initial_pair_difference_cm:
          fixture.expected.initial_pair_difference_cm,
        all_readings_range_cm: fixture.expected.all_readings_range_cm,
        quality: fixture.expected.quality,
        algorithm_version: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
      });
    });
  }
});

describe("calculateAnthropometryRepresentative", () => {
  it("accepts the exact 1.0 cm repeatability boundary", () => {
    const result = calculateAnthropometryRepresentative({
      site_code: "waist",
      readings_cm: [88.2, 89.2],
    });

    expect(result.method).toBe("mean_of_two");
    expect(result.representative_cm).toBe(88.7);
    expect(result.quality_flags).toEqual([]);
  });

  it("requires a third reading at 1.1 cm", () => {
    const error = captureValidationError(() =>
      calculateAnthropometryRepresentative({
        site_code: "waist",
        readings_cm: [80.0, 81.1],
      })
    );

    expect(error.code).toBe("THIRD_READING_REQUIRED");
    expect(error.siteCode).toBe("waist");
  });

  it("rejects a discretionary third reading when the pair passes", () => {
    const error = captureValidationError(() =>
      calculateAnthropometryRepresentative({
        site_code: "waist",
        readings_cm: [80.0, 81.0, 80.4],
      })
    );

    expect(error.code).toBe("UNEXPECTED_THIRD_READING");
  });

  it("uses the numeric median with deterministic ties", () => {
    const result = calculateAnthropometryRepresentative({
      site_code: "hips",
      readings_cm: [101.2, 99.8, 99.8],
    });

    expect(result.representative_cm).toBe(99.8);
    expect(result.method).toBe("median_of_three");
    expect(result.quality_flags).toEqual([
      "initial_pair_exceeds_repeatability_threshold",
    ]);
  });

  it("accepts a third reading when at least one pair agrees", () => {
    const result = calculateAnthropometryRepresentative({
      site_code: "waist",
      readings_cm: [80.0, 81.2, 80.5],
    });

    expect(result.representative_cm).toBe(80.5);
    expect(result.method).toBe("median_of_three");
    expect(result.quality).toBe("repeatability_warning");
  });

  it("requires a site retake when no pair of three readings agrees", () => {
    const error = captureValidationError(() =>
      calculateAnthropometryRepresentative({
        site_code: "waist",
        readings_cm: [80.0, 81.2, 50.0],
      })
    );

    expect(error.code).toBe("RETAKE_SITE_REQUIRED");
    expect(error.siteCode).toBe("waist");
  });

  it("accepts an agreeing pair at the exact 1.0 cm boundary", () => {
    const result = calculateAnthropometryRepresentative({
      site_code: "waist",
      readings_cm: [80.0, 82.0, 81.0],
    });

    expect(result.representative_cm).toBe(81.0);
  });

  it("preserves a mean at 0.05 cm precision", () => {
    const result = calculateAnthropometryRepresentative({
      site_code: "left_upper_arm_relaxed",
      readings_cm: [32.1, 32.2],
    });

    expect(result.representative_cm).toBe(32.15);
  });

  it.each([5.0, 300.0])("accepts the inclusive %s cm bound", (value) => {
    const result = calculateAnthropometryRepresentative({
      site_code: "neck",
      readings_cm: [value, value],
    });
    expect(result.representative_cm).toBe(value);
  });

  it.each([4.9, 300.1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the out-of-range or non-finite value %s",
    (value) => {
      const error = captureValidationError(() =>
        calculateAnthropometryRepresentative({
          site_code: "neck",
          readings_cm: [value, 40.0],
        })
      );
      expect(error.code).toBe("READING_OUT_OF_RANGE");
    },
  );

  it("rejects precision finer than 0.1 cm", () => {
    const error = captureValidationError(() =>
      calculateAnthropometryRepresentative({
        site_code: "right_mid_thigh",
        readings_cm: [56.25, 56.3],
      })
    );
    expect(error.code).toBe("INVALID_READING_PRECISION");
  });

  it.each([
    { readings: [40.0] },
    { readings: [40.0, 40.1, 40.2, 40.3] },
  ])(
    "rejects a reading count other than two or three",
    ({ readings }) => {
      const error = captureValidationError(() =>
        calculateAnthropometryRepresentative({
          site_code: "neck",
          readings_cm: readings,
        })
      );
      expect(error.code).toBe("INVALID_READING_COUNT");
    },
  );

  it("rejects an unknown site instead of aliasing it", () => {
    const error = captureValidationError(() =>
      calculateAnthropometryRepresentative({
        site_code: "abdomen",
        readings_cm: [90.0, 90.2],
      })
    );
    expect(error.code).toBe("UNKNOWN_SITE");
  });

  it("does not mutate the raw readings", () => {
    const readings = [110.8, 108.9, 109.4];
    const frozen = [...readings];

    calculateAnthropometryRepresentative({
      site_code: "hips",
      readings_cm: readings,
    });

    expect(readings).toEqual(frozen);
  });
});

describe("calculateAnthropometryRepresentatives", () => {
  it("requires at least one site", () => {
    const error = captureValidationError(() =>
      calculateAnthropometryRepresentatives([])
    );
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate sites instead of choosing by input order", () => {
    const error = captureValidationError(() =>
      calculateAnthropometryRepresentatives([
        { site_code: "waist", readings_cm: [88.0, 88.2] },
        { site_code: "waist", readings_cm: [87.9, 88.1] },
      ])
    );
    expect(error.code).toBe("DUPLICATE_SITE");
  });

  it("returns sites in frozen order regardless of request order", () => {
    const result = calculateAnthropometryRepresentatives([
      { site_code: "neck", readings_cm: [38.0, 38.2] },
      { site_code: "left_mid_thigh", readings_cm: [55.0, 55.2] },
      { site_code: "waist", readings_cm: [88.0, 88.2] },
      { site_code: "chest", readings_cm: [100.0, 100.2] },
    ]);

    expect(result.representatives.map((entry) => entry.site_code)).toEqual([
      "chest",
      "waist",
      "left_mid_thigh",
      "neck",
    ]);
  });

  it("keeps missing sites absent rather than creating zeros", () => {
    const result = calculateAnthropometryRepresentatives([
      { site_code: "waist", readings_cm: [88.0, 88.2] },
      {
        site_code: "left_upper_arm_relaxed",
        readings_cm: [31.0, 31.2],
      },
    ]);

    expect(result.representatives).toHaveLength(2);
    expect(result.representatives.some((entry) => entry.representative_cm === 0))
      .toBe(false);
    expect(result.representatives.map((entry) => entry.site_code)).not.toContain(
      "right_upper_arm_relaxed",
    );
  });

  it("returns all authoritative version identifiers", () => {
    const result = calculateAnthropometryRepresentatives([
      { site_code: "waist", readings_cm: [88.0, 88.2] },
    ]);

    expect(result.algorithm_versions).toEqual({
      data_contract: ANTHROPOMETRY_DATA_CONTRACT_VERSION,
      protocol: ANTHROPOMETRY_PROTOCOL_VERSION,
      representative: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
      repeatability_thresholds: ANTHROPOMETRY_THRESHOLDS_VERSION,
    });
    expect(frozenFixtures.algorithm_versions).toMatchObject({
      protocol: ANTHROPOMETRY_PROTOCOL_VERSION,
      representative: ANTHROPOMETRY_REPRESENTATIVE_VERSION,
      repeatability_thresholds: ANTHROPOMETRY_THRESHOLDS_VERSION,
    });
  });

  it("freezes the configured integer thresholds and site dictionary", () => {
    expect(ANTHROPOMETRY_MIN_READING_TENTHS).toBe(50);
    expect(ANTHROPOMETRY_MAX_READING_TENTHS).toBe(3000);
    expect(ANTHROPOMETRY_REPEATABILITY_THRESHOLD_TENTHS).toBe(10);
    expect(ANTHROPOMETRY_SITE_CODES).toEqual([
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
  });
});
