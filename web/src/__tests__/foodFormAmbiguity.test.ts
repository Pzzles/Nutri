// Tests for the PRODUCTION detectFoodFormAmbiguity implementation.
// Imports directly from the shared Edge Function module — no inlined copy.
import { describe, it, expect } from "vitest";
import {
  detectFoodFormAmbiguity,
  deduplicateCandidates,
  FOOD_FORM_RATIO_THRESHOLD,
} from "@shared/foodFormAmbiguity";

describe("FOOD_FORM_RATIO_THRESHOLD", () => {
  it("is 3.0", () => expect(FOOD_FORM_RATIO_THRESHOLD).toBe(3.0));
});

describe("detectFoodFormAmbiguity — core oatmeal case", () => {
  it("cooked oatmeal (71) vs dry oats (380) → ambiguous (ratio ≈ 5.4)", () => {
    expect(detectFoodFormAmbiguity([
      { calories100g: 71 },   // cooked
      { calories100g: 380 },  // dry
    ])).toBe(true);
  });

  it("3 candidates: cooked, dry, instant dry → ambiguous", () => {
    expect(detectFoodFormAmbiguity([
      { calories100g: 71 },
      { calories100g: 380 },
      { calories100g: 374 },
    ])).toBe(true);
  });
});

describe("detectFoodFormAmbiguity — ratio boundary", () => {
  it("ratio exactly at threshold (max/min = 3.0) → NOT ambiguous (must be > 3.0)", () => {
    expect(detectFoodFormAmbiguity([
      { calories100g: 100 },
      { calories100g: 300 }, // 300/100 = exactly 3.0
    ])).toBe(false);
  });

  it("ratio slightly above threshold (300.1/100 > 3.0) → ambiguous", () => {
    expect(detectFoodFormAmbiguity([
      { calories100g: 100 },
      { calories100g: 300.1 },
    ])).toBe(true);
  });

  it("similar chicken preparations (ratio ≈ 1.1) → not ambiguous", () => {
    expect(detectFoodFormAmbiguity([
      { calories100g: 165 },
      { calories100g: 172 },
      { calories100g: 160 },
    ])).toBe(false);
  });
});

describe("detectFoodFormAmbiguity — edge cases", () => {
  it("single candidate → never ambiguous", () => {
    expect(detectFoodFormAmbiguity([{ calories100g: 380 }])).toBe(false);
  });

  it("empty candidates → not ambiguous", () => {
    expect(detectFoodFormAmbiguity([])).toBe(false);
  });

  it("zero-calorie candidates are excluded before computing ratio", () => {
    // A zero entry in the data must not suppress a real ambiguity.
    expect(detectFoodFormAmbiguity([
      { calories100g: 0 },
      { calories100g: 380 },
      { calories100g: 71 },
    ])).toBe(true);
  });

  it("all zero-calorie → not ambiguous (no valid candidates)", () => {
    expect(detectFoodFormAmbiguity([
      { calories100g: 0 },
      { calories100g: 0 },
    ])).toBe(false);
  });

  it("duplicate candidates (same food, two sources) → deduped before ratio check", () => {
    // If both entries represent the same food, the ratio is 1.0 → not ambiguous.
    expect(detectFoodFormAmbiguity([
      { calories100g: 380 },
      { calories100g: 380 }, // duplicate — same food from different provider
    ])).toBe(false);
  });

  it("more than 3 candidates: only top 3 (after dedup) are considered", () => {
    // Candidates 4+ are ignored — they are lower-ranked and less relevant.
    expect(detectFoodFormAmbiguity([
      { calories100g: 100 },
      { calories100g: 105 },
      { calories100g: 102 }, // top 3: ratio ≈ 1.05, not ambiguous
      { calories100g: 1 },   // 4th — would trigger if included
    ])).toBe(false);
  });

  it("multiple branded versions with similar calories → not ambiguous", () => {
    expect(detectFoodFormAmbiguity([
      { calories100g: 250 },
      { calories100g: 260 },
      { calories100g: 245 },
    ])).toBe(false);
  });
});

describe("detectFoodFormAmbiguity — identity: dedup prevents false positives", () => {
  it("two weak unrelated search results with very different calories → dedup applied, still ambiguous if ratio holds", () => {
    // NOTE: the function cannot distinguish between two preparations of the same food
    // and two unrelated foods. If two distinct foods have a calorie ratio > 3, the
    // function will flag it. This is a known limitation documented in the module.
    // The caller (resolve-foods) is responsible for providing relevance-ranked candidates.
    expect(detectFoodFormAmbiguity([
      { calories100g: 50 },
      { calories100g: 200 }, // ratio = 4 > threshold
    ])).toBe(true);
  });
});

// ── deduplicateCandidates ─────────────────────────────────────────────────────

describe("deduplicateCandidates", () => {
  it("removes exact duplicates by rounded calorie value", () => {
    const result = deduplicateCandidates([
      { calories100g: 380 },
      { calories100g: 380 },
      { calories100g: 71 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].calories100g).toBe(380);
    expect(result[1].calories100g).toBe(71);
  });

  it("rounds to nearest integer for comparison (379.8 and 380.2 are both 380)", () => {
    const result = deduplicateCandidates([
      { calories100g: 379.8 },
      { calories100g: 380.2 },
    ]);
    expect(result).toHaveLength(1);
  });

  it("preserves insertion order", () => {
    const result = deduplicateCandidates([
      { calories100g: 71 },
      { calories100g: 380 },
    ]);
    expect(result[0].calories100g).toBe(71);
    expect(result[1].calories100g).toBe(380);
  });

  it("preserves extra fields on the candidate objects", () => {
    const result = deduplicateCandidates([
      { calories100g: 380, name: "dry oats" },
      { calories100g: 71, name: "cooked oatmeal" },
    ]);
    expect(result[0]).toMatchObject({ name: "dry oats" });
    expect(result[1]).toMatchObject({ name: "cooked oatmeal" });
  });

  it("empty array → empty", () => {
    expect(deduplicateCandidates([])).toHaveLength(0);
  });
});
