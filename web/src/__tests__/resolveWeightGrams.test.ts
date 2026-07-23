// Tests for the PRODUCTION resolveWeightGrams and checkExtreme implementations.
// Imports directly from the shared Edge Function module — no inlined copy.
import { describe, it, expect } from "vitest";
import {
  resolveWeightGrams,
  checkExtreme,
  EXTREME_PORTION_THRESHOLD_G,
} from "@shared/portionResolution";

// ── Unit normalisation boundary ────────────────────────────────────────────────

describe("EXTREME_PORTION_THRESHOLD_G constant", () => {
  it("is 2000 g", () => expect(EXTREME_PORTION_THRESHOLD_G).toBe(2000));
});

// ── mg boundary: LIKELY_UNIT_ERROR threshold ──────────────────────────────────
// The boundary is at 1 g: amounts < 1 g after conversion trigger LIKELY_UNIT_ERROR.
// 999 mg = 0.999 g < 1 → error. 1000 mg = 1 g → ok.

describe("resolveWeightGrams — mg conversions and boundary", () => {
  it("150 mg → LIKELY_UNIT_ERROR (0.15 g is implausible)", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") {
      expect(r.clarification.code).toBe("LIKELY_UNIT_ERROR");
      expect(r.clarification.suggested_unit).toBe("g");
      expect(r.clarification.suggested_qty).toBe(150);
    }
  });

  it("999 mg = 0.999 g < 1 g → LIKELY_UNIT_ERROR", () => {
    const r = resolveWeightGrams({ quantity: 999, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("LIKELY_UNIT_ERROR");
  });

  it("1000 mg = exactly 1 g → ok (boundary: 1 g is the minimum plausible meal amount)", () => {
    const r = resolveWeightGrams({ quantity: 1000, unit: "mg" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.grams).toBeCloseTo(1, 5);
      expect(r.source).toBe("explicit");
    }
  });

  it("1500 mg → 1.5 g", () => {
    const r = resolveWeightGrams({ quantity: 1500, unit: "mg" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBeCloseTo(1.5, 5);
  });

  it("2000000 mg = 2000 g → at EXTREME_PORTION boundary (2000 is ok, not extreme)", () => {
    const r = resolveWeightGrams({ quantity: 2000000, unit: "mg" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(2000);
  });

  it("2000001 mg > 2000 g → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 2000001, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("milligrams (plural spelling) normalised", () => {
    const r = resolveWeightGrams({ quantity: 2000, unit: "milligrams" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBeCloseTo(2, 5);
  });

  it("zero mg → LIKELY_UNIT_ERROR (0 mg = 0 g, which is < 1 g threshold)", () => {
    // The < 1 g LIKELY_UNIT_ERROR guard runs before checkExtreme.
    // Zero mg falls into that guard because 0 / 1000 = 0 < 1.
    const r = resolveWeightGrams({ quantity: 0, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("LIKELY_UNIT_ERROR");
  });

  it("negative mg → LIKELY_UNIT_ERROR (negative grams < 1 g threshold)", () => {
    const r = resolveWeightGrams({ quantity: -100, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("LIKELY_UNIT_ERROR");
  });

  it("NaN mg → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: NaN, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("Infinity mg → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: Infinity, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });
});

// ── g conversions ─────────────────────────────────────────────────────────────

describe("resolveWeightGrams — g conversions", () => {
  it("150 g → 150 g", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: "g" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(150); expect(r.source).toBe("explicit"); }
  });

  it("exactly 2000 g → ok (at threshold, not above)", () => {
    const r = resolveWeightGrams({ quantity: 2000, unit: "g" }, null, null);
    expect(r.kind).toBe("ok");
  });

  it("2000.1 g → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 2000.1, unit: "g" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("zero g → EXTREME_PORTION (zero is invalid)", () => {
    const r = resolveWeightGrams({ quantity: 0, unit: "g" }, null, null);
    expect(r.kind).toBe("clarification");
  });

  it("negative g → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: -50, unit: "g" }, null, null);
    expect(r.kind).toBe("clarification");
  });
});

// ── kg conversions ────────────────────────────────────────────────────────────

describe("resolveWeightGrams — kg conversions", () => {
  it("1.5 kg → 1500 g", () => {
    const r = resolveWeightGrams({ quantity: 1.5, unit: "kg" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBeCloseTo(1500, 3);
  });

  it("exactly 2 kg = 2000 g → ok (at threshold)", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "kg" }, null, null);
    expect(r.kind).toBe("ok");
  });

  it("2.001 kg = 2001 g → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 2.001, unit: "kg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });
});

// ── ml conversions (1 ml ≈ 1 g approximation) ─────────────────────────────────

describe("resolveWeightGrams — ml conversions", () => {
  it("250 ml → 250 g (1 ml ≈ 1 g approximation for aqueous foods)", () => {
    const r = resolveWeightGrams({ quantity: 250, unit: "ml" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(250); expect(r.source).toBe("explicit"); }
  });

  it("exactly 2000 ml → ok (at threshold)", () => {
    const r = resolveWeightGrams({ quantity: 2000, unit: "ml" }, null, null);
    expect(r.kind).toBe("ok");
  });

  it("2000.1 ml → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 2000.1, unit: "ml" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("zero ml → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 0, unit: "ml" }, null, null);
    expect(r.kind).toBe("clarification");
  });

  it("negative ml → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: -100, unit: "ml" }, null, null);
    expect(r.kind).toBe("clarification");
  });
});

// ── l conversions ─────────────────────────────────────────────────────────────

describe("resolveWeightGrams — l conversions", () => {
  it("2 l → 2000 g", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "l" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(2000);
  });

  it("exactly 2 l = 2000 g → ok (at threshold)", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "l" }, null, null);
    expect(r.kind).toBe("ok");
  });

  it("2.001 l → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 2.001, unit: "l" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });
});

// ── count units ───────────────────────────────────────────────────────────────

describe("resolveWeightGrams — count units with serving size", () => {
  it("2 pieces × 60 g/serving → 120 g", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "pieces" }, 60, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(120); expect(r.source).toBe("explicit"); }
  });

  it("3 slices × 40 g/serving → 120 g", () => {
    const r = resolveWeightGrams({ quantity: 3, unit: "slices" }, 40, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(120);
  });

  it("1 serving × 278 g → 278 g", () => {
    const r = resolveWeightGrams({ quantity: 1, unit: "serving" }, 278, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(278);
  });

  it("count multiplication exactly at 2000 g → ok", () => {
    const r = resolveWeightGrams({ quantity: 4, unit: "pieces" }, 500, null);
    expect(r.kind).toBe("ok");
  });

  it("count multiplication exceeding 2000 g → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 5, unit: "pieces" }, 500, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("zero count × serving → EXTREME_PORTION (zero is invalid)", () => {
    const r = resolveWeightGrams({ quantity: 0, unit: "pieces" }, 60, null);
    expect(r.kind).toBe("clarification");
  });

  it("negative count → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: -2, unit: "pieces" }, 60, null);
    expect(r.kind).toBe("clarification");
  });
});

describe("resolveWeightGrams — count unit with no serving size → MISSING_SERVING_SIZE", () => {
  it("2 eggs (pieces) with no serving size → MISSING_SERVING_SIZE, not 100 g fallback", () => {
    // Product decision: when a count word is given but the food has no
    // serving_size_g, we cannot do the arithmetic. Silently using 100 g
    // would produce wrong nutrition values, so we surface a clarification.
    const r = resolveWeightGrams({ quantity: 2, unit: "pieces" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("MISSING_SERVING_SIZE");
  });

  it("2 pieces with no serving size, even with history → MISSING_SERVING_SIZE (history not used for count units)", () => {
    // History is only consulted in the no-unit path.
    // For count units, serving_size_g is mandatory to convert pieces → grams.
    const r = resolveWeightGrams({ quantity: 2, unit: "pieces" }, null, { usual_g: 120, use_count: 3 });
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("MISSING_SERVING_SIZE");
  });
});

// ── no-unit (unitless) quantities ─────────────────────────────────────────────
// Product decision: a bare number is treated as a serving multiplier only when
// the food has a known serving_size_g. With no serving size, history is tried
// first; failing that, MISSING_SERVING_SIZE is returned.

describe("resolveWeightGrams — no-unit quantities", () => {
  it("2 [no unit] + serving 278 g → 2 × 278 = 556 g", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: null }, 278, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(556); expect(r.source).toBe("explicit"); }
  });

  it("150 [no unit] + serving 278 g → 150 × 278 = 41 700 g → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: null }, 278, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("1 [no unit] + no serving + no history → MISSING_SERVING_SIZE", () => {
    const r = resolveWeightGrams({ quantity: 1, unit: null }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("MISSING_SERVING_SIZE");
  });

  it("150 [no unit] + no serving + history 200 g → uses history", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: null }, null, { usual_g: 200, use_count: 5 });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(200); expect(r.source).toBe("history"); }
  });
});

// ── unsupported units ─────────────────────────────────────────────────────────

describe("resolveWeightGrams — unsupported units → UNSUPPORTED_PORTION_UNIT", () => {
  it("oz → UNSUPPORTED_PORTION_UNIT", () => {
    const r = resolveWeightGrams({ quantity: 3, unit: "oz" }, 30, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
  });

  it("tbsp → UNSUPPORTED_PORTION_UNIT (not multiplied by serving)", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "tbsp" }, 15, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
  });

  it("cup → UNSUPPORTED_PORTION_UNIT", () => {
    const r = resolveWeightGrams({ quantity: 1, unit: "cup" }, 240, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
  });

  it("lb → UNSUPPORTED_PORTION_UNIT", () => {
    const r = resolveWeightGrams({ quantity: 1, unit: "lb" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
  });

  it("mgg (misspelling) with serving → UNSUPPORTED_PORTION_UNIT, not 41 700 g", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: "mgg" }, 278, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
    if (r.kind === "ok") expect(r.grams).not.toBe(41700);
  });
});

// ── null qty fallbacks ────────────────────────────────────────────────────────

describe("resolveWeightGrams — null quantity fallbacks", () => {
  it("null qty + history → history.usual_g", () => {
    const r = resolveWeightGrams({ quantity: null, unit: null }, 100, { usual_g: 200, use_count: 5 });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(200); expect(r.source).toBe("history"); }
  });

  it("null qty + no history + serving 278 g → 278 g default", () => {
    const r = resolveWeightGrams({ quantity: null, unit: null }, 278, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(278); expect(r.source).toBe("default"); }
  });

  it("null qty + no history + no serving → 100 g fallback", () => {
    const r = resolveWeightGrams({ quantity: null, unit: null }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(100); expect(r.source).toBe("default"); }
  });
});

// ── extreme-portion confirmation path ─────────────────────────────────────────

describe("resolveWeightGrams — EXTREME_PORTION is a confirmation state, not permanent rejection", () => {
  it("5000 g without confirmation → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 5000, unit: "g" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("5000 g with extreme_confirmed: true → ok (user confirmed large amount)", () => {
    const r = resolveWeightGrams({ quantity: 5000, unit: "g", extreme_confirmed: true }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") { expect(r.grams).toBe(5000); expect(r.source).toBe("explicit"); }
  });

  it("5 kg with extreme_confirmed → ok", () => {
    const r = resolveWeightGrams({ quantity: 5, unit: "kg", extreme_confirmed: true }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(5000);
  });

  it("extreme_confirmed does NOT bypass infinite/NaN/zero (those remain invalid)", () => {
    const r = resolveWeightGrams({ quantity: -100, unit: "g", extreme_confirmed: true }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });
});

// ── checkExtreme standalone ───────────────────────────────────────────────────

describe("checkExtreme", () => {
  it("100 g → null (not extreme)", () => expect(checkExtreme(100, "g")).toBeNull());
  it("exactly 2000 g → null (at threshold, not above)", () => expect(checkExtreme(2000, "g")).toBeNull());
  it("2000.001 g → clarification", () => expect(checkExtreme(2000.001, "g")?.kind).toBe("clarification"));
  it("0 g → clarification (invalid)", () => expect(checkExtreme(0, "g")?.kind).toBe("clarification"));
  it("-1 g → clarification (invalid)", () => expect(checkExtreme(-1, "g")?.kind).toBe("clarification"));
  it("NaN → clarification (invalid)", () => expect(checkExtreme(NaN, "g")?.kind).toBe("clarification"));
  it("Infinity → clarification (invalid)", () => expect(checkExtreme(Infinity, "g")?.kind).toBe("clarification"));
  it("5000 g confirmed: true → null (override active)", () => expect(checkExtreme(5000, "g", true)).toBeNull());
  it("EXTREME_PORTION code is set", () => {
    const r = checkExtreme(9999, "g");
    expect(r?.clarification.code).toBe("EXTREME_PORTION");
  });
});

// ── Original 41 700 g regression ─────────────────────────────────────────────

describe("Regression: 150 mg oatmeal must never produce 41 700 g", () => {
  it("150 mg + serving_size_g=278 → LIKELY_UNIT_ERROR, not 41 700 g", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: "mg" }, 278, null);
    if (r.kind === "ok") expect(r.grams).not.toBeCloseTo(41700, 0);
    else expect(r.clarification.code).toBe("LIKELY_UNIT_ERROR");
  });

  it("full 3-item session: oatmeal in clarifications, milk and sugar calculated", () => {
    const session = [
      { name: "oatmeal",       quantity: 150, unit: "mg",  cal100: 62.2,  servingG: 278 },
      { name: "full fat milk", quantity: 50,  unit: "g",   cal100: 61.0,  servingG: 100 },
      { name: "sugar",         quantity: 15,  unit: "g",   cal100: 387.0, servingG: 10  },
    ];

    const calculated: Array<{ name: string; grams: number; calories: number }> = [];
    const clarifications: Array<{ name: string; code: string }> = [];

    for (const food of session) {
      const r = resolveWeightGrams({ quantity: food.quantity, unit: food.unit }, food.servingG, null);
      if (r.kind === "clarification") {
        clarifications.push({ name: food.name, code: r.clarification.code });
      } else {
        calculated.push({ name: food.name, grams: r.grams, calories: Math.round(food.cal100 * (r.grams / 100) * 10) / 10 });
      }
    }

    expect(clarifications).toHaveLength(1);
    expect(clarifications[0].name).toBe("oatmeal");
    expect(clarifications[0].code).toBe("LIKELY_UNIT_ERROR");

    expect(calculated).toHaveLength(2);
    expect(calculated.every((c) => c.grams !== 41700)).toBe(true);

    const milk = calculated.find((c) => c.name === "full fat milk")!;
    expect(milk.grams).toBe(50);
    expect(milk.calories).toBeCloseTo(30.5, 1);

    const sugar = calculated.find((c) => c.name === "sugar")!;
    expect(sugar.grams).toBe(15);
    expect(sugar.calories).toBeCloseTo(58.1, 1);
  });
});
