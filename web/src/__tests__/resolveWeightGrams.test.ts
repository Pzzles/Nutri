import { describe, it, expect } from "vitest";

// Inlined from supabase/functions/_shared/portionUnits.ts and
// supabase/functions/calculate-meal/index.ts for Node/Vitest compatibility.
// If either diverges from production, these tests become stale — keep in sync.

// ── portionUnits.ts ────────────────────────────────────────────────────────

type CanonicalUnit = "mg" | "g" | "kg" | "ml" | "l" | "count";
type UnitCategory = "mass" | "volume" | "count";
interface NormalisedUnit { canonical: CanonicalUnit; category: UnitCategory; }

const UNIT_MAP: Record<string, NormalisedUnit> = {
  mg: { canonical: "mg", category: "mass" },
  milligram: { canonical: "mg", category: "mass" },
  milligrams: { canonical: "mg", category: "mass" },
  g: { canonical: "g", category: "mass" },
  gram: { canonical: "g", category: "mass" },
  grams: { canonical: "g", category: "mass" },
  kg: { canonical: "kg", category: "mass" },
  kilogram: { canonical: "kg", category: "mass" },
  kilograms: { canonical: "kg", category: "mass" },
  ml: { canonical: "ml", category: "volume" },
  millilitre: { canonical: "ml", category: "volume" },
  millilitres: { canonical: "ml", category: "volume" },
  milliliter: { canonical: "ml", category: "volume" },
  milliliters: { canonical: "ml", category: "volume" },
  l: { canonical: "l", category: "volume" },
  litre: { canonical: "l", category: "volume" },
  litres: { canonical: "l", category: "volume" },
  liter: { canonical: "l", category: "volume" },
  liters: { canonical: "l", category: "volume" },
  piece: { canonical: "count", category: "count" },
  pieces: { canonical: "count", category: "count" },
  item: { canonical: "count", category: "count" },
  items: { canonical: "count", category: "count" },
  slice: { canonical: "count", category: "count" },
  slices: { canonical: "count", category: "count" },
  serving: { canonical: "count", category: "count" },
  servings: { canonical: "count", category: "count" },
  portion: { canonical: "count", category: "count" },
  portions: { canonical: "count", category: "count" },
};

function normaliseUnit(raw: string | null | undefined): NormalisedUnit | null {
  if (raw == null || raw.trim() === "") return null;
  return UNIT_MAP[raw.trim().toLowerCase()] ?? null;
}

// ── calculate-meal.ts (portion resolution logic) ───────────────────────────

const EXTREME_PORTION_THRESHOLD_G = 2000;

interface PortionClarification {
  code: "UNSUPPORTED_PORTION_UNIT" | "EXTREME_PORTION" | "LIKELY_UNIT_ERROR";
  raw_unit: string | null;
  message: string;
  suggested_unit?: string;
  suggested_qty?: number;
}

type WeightResolution =
  | { kind: "ok"; grams: number; source: "explicit" | "history" | "default" }
  | { kind: "clarification"; clarification: PortionClarification };

function checkExtreme(grams: number, rawUnit: string | null): WeightResolution | null {
  if (!isFinite(grams) || grams <= 0) {
    return { kind: "clarification", clarification: { code: "EXTREME_PORTION", raw_unit: rawUnit, message: "The converted portion is zero or infinite." } };
  }
  if (grams > EXTREME_PORTION_THRESHOLD_G) {
    return { kind: "clarification", clarification: { code: "EXTREME_PORTION", raw_unit: rawUnit, message: `${Math.round(grams)} g exceeds the ${EXTREME_PORTION_THRESHOLD_G} g safety threshold.` } };
  }
  return null;
}

function resolveWeightGrams(
  item: { quantity: number | null; unit: string | null },
  defaultServingG: number | null,
  history: { usual_g: number; use_count: number } | null,
): WeightResolution {
  const qty = item.quantity;
  const rawUnit = item.unit != null ? item.unit.trim().toLowerCase() : null;

  if (qty != null) {
    if (rawUnit !== null) {
      const normUnit = normaliseUnit(rawUnit);
      if (normUnit === null) {
        return { kind: "clarification", clarification: { code: "UNSUPPORTED_PORTION_UNIT", raw_unit: item.unit, message: `"${item.unit}" is not a recognised portion unit.` } };
      }
      let grams: number;
      switch (normUnit.canonical) {
        case "mg":
          grams = qty / 1000;
          if (grams < 1.0) {
            return { kind: "clarification", clarification: { code: "LIKELY_UNIT_ERROR", raw_unit: "mg", message: `Did you mean ${qty} g? ${qty} mg is ${grams.toFixed(2)} g.`, suggested_unit: "g", suggested_qty: qty } };
          }
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };
        case "g":
          grams = qty;
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };
        case "kg":
          grams = qty * 1000;
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };
        case "ml":
          grams = qty;
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };
        case "l":
          grams = qty * 1000;
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };
        case "count":
          if (defaultServingG != null) {
            grams = qty * defaultServingG;
            return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };
          }
          break;
      }
    } else {
      if (defaultServingG != null) {
        const grams = qty * defaultServingG;
        const extreme = checkExtreme(grams, null);
        if (extreme) return extreme;
        return { kind: "ok", grams, source: "explicit" };
      }
    }
  }

  if (history != null) return { kind: "ok", grams: history.usual_g, source: "history" };
  return { kind: "ok", grams: defaultServingG ?? 100, source: "default" };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("resolveWeightGrams — mass unit conversions", () => {
  it("150 mg → LIKELY_UNIT_ERROR (0.15 g < 1 g meal threshold)", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: "mg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") {
      expect(r.clarification.code).toBe("LIKELY_UNIT_ERROR");
      expect(r.clarification.suggested_unit).toBe("g");
      expect(r.clarification.suggested_qty).toBe(150);
    }
  });

  it("1500 mg → 1.5 g (valid, no clarification)", () => {
    const r = resolveWeightGrams({ quantity: 1500, unit: "mg" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.grams).toBeCloseTo(1.5, 2);
      expect(r.source).toBe("explicit");
    }
  });

  it("150 g → 150 g", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: "g" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(150);
  });

  it("1.5 kg → 1500 g", () => {
    const r = resolveWeightGrams({ quantity: 1.5, unit: "kg" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBeCloseTo(1500, 1);
  });

  it("milligrams (plural spelling) recognised", () => {
    const r = resolveWeightGrams({ quantity: 2000, unit: "milligrams" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBeCloseTo(2, 2);
  });
});

describe("resolveWeightGrams — volume unit conversions", () => {
  it("250 ml → 250 g", () => {
    const r = resolveWeightGrams({ quantity: 250, unit: "ml" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(250);
  });

  it("2 l → 2000 g", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "l" }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(2000);
  });
});

describe("resolveWeightGrams — count unit with serving size", () => {
  it("2 pieces × 60 g/serving → 120 g", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "pieces" }, 60, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(120);
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
});

describe("resolveWeightGrams — unsupported units surface UNSUPPORTED_PORTION_UNIT", () => {
  it("oz → UNSUPPORTED_PORTION_UNIT (not in table)", () => {
    const r = resolveWeightGrams({ quantity: 3, unit: "oz" }, 30, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") {
      expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
      expect(r.clarification.raw_unit).toBe("oz");
    }
  });

  it("tbsp → UNSUPPORTED_PORTION_UNIT", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "tbsp" }, 15, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") {
      expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
    }
  });

  it("cup → UNSUPPORTED_PORTION_UNIT", () => {
    const r = resolveWeightGrams({ quantity: 1, unit: "cup" }, 240, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") {
      expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
    }
  });

  it("misspelled unit mgg → UNSUPPORTED_PORTION_UNIT (not multiplied by serving size)", () => {
    const r = resolveWeightGrams({ quantity: 150, unit: "mgg" }, 278, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") {
      expect(r.clarification.code).toBe("UNSUPPORTED_PORTION_UNIT");
    }
    if (r.kind === "ok") {
      // If it somehow resolved, it must not be 41 700 g (the original bug value).
      expect(r.grams).not.toBe(41700);
    }
  });
});

describe("resolveWeightGrams — null quantity falls back gracefully", () => {
  it("null qty → uses history when available", () => {
    const r = resolveWeightGrams({ quantity: null, unit: null }, 100, { usual_g: 200, use_count: 5 });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.grams).toBe(200);
      expect(r.source).toBe("history");
    }
  });

  it("null qty + no history → default serving size", () => {
    const r = resolveWeightGrams({ quantity: null, unit: null }, 278, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.grams).toBe(278);
      expect(r.source).toBe("default");
    }
  });

  it("null qty + no history + no serving → 100 g fallback", () => {
    const r = resolveWeightGrams({ quantity: null, unit: null }, null, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.grams).toBe(100);
      expect(r.source).toBe("default");
    }
  });
});

describe("resolveWeightGrams — extreme portion detection", () => {
  it("5 kg (5000 g) → EXTREME_PORTION", () => {
    const r = resolveWeightGrams({ quantity: 5, unit: "kg" }, null, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });

  it("2 eggs × 50 g/serving = 100 g — accepted (under threshold)", () => {
    const r = resolveWeightGrams({ quantity: 2, unit: "pieces" }, 50, null);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.grams).toBe(100);
  });

  it("unitless serving count that overflows (150 × 278 = 41 700 g) → EXTREME_PORTION", () => {
    // This is the exact null-unit variant of the original bug.
    const r = resolveWeightGrams({ quantity: 150, unit: null }, 278, null);
    expect(r.kind).toBe("clarification");
    if (r.kind === "clarification") expect(r.clarification.code).toBe("EXTREME_PORTION");
  });
});

// ── Integration regression ─────────────────────────────────────────────────
// These tests prove the exact scenario that caused the original 41 700 g bug.

describe("Integration regression: 150 mg oatmeal", () => {
  it("150 mg + serving_size_g=278 is NEVER calculated as 41 700 g", () => {
    // Exact inputs that triggered the bug:
    //   qty=150, unit="mg", serving_size_g=278
    //   Old logic: 150 × 278 = 41 700 g (wrong)
    //   Fixed logic: 150 mg = 0.15 g → LIKELY_UNIT_ERROR
    const r = resolveWeightGrams({ quantity: 150, unit: "mg" }, 278, null);
    if (r.kind === "ok") {
      expect(r.grams).not.toBeCloseTo(41700, 0);
    } else {
      expect(r.clarification.code).toBe("LIKELY_UNIT_ERROR");
    }
  });

  it("full session: oatmeal excluded, milk and sugar calculated correctly", () => {
    const session = [
      { raw_phrase: "oatmeal",       quantity: 150, unit: "mg",  cal100: 62.2,  servingG: 278 },
      { raw_phrase: "full fat milk", quantity: 50,  unit: "g",   cal100: 61.0,  servingG: 100 },
      { raw_phrase: "sugar",         quantity: 15,  unit: "g",   cal100: 387.0, servingG: 10  },
    ];

    const calculated: Array<{ raw_phrase: string; grams: number; calories: number }> = [];
    const clarifications: Array<{ raw_phrase: string; code: string }> = [];

    for (const food of session) {
      const r = resolveWeightGrams({ quantity: food.quantity, unit: food.unit }, food.servingG, null);
      if (r.kind === "clarification") {
        clarifications.push({ raw_phrase: food.raw_phrase, code: r.clarification.code });
      } else {
        const cal = Math.round(food.cal100 * (r.grams / 100) * 10) / 10;
        calculated.push({ raw_phrase: food.raw_phrase, grams: r.grams, calories: cal });
      }
    }

    // Oatmeal must be in clarifications, not calculated items
    expect(clarifications).toHaveLength(1);
    expect(clarifications[0].raw_phrase).toBe("oatmeal");
    expect(clarifications[0].code).toBe("LIKELY_UNIT_ERROR");

    // Milk and sugar should be calculated correctly
    expect(calculated).toHaveLength(2);
    expect(calculated.every((c) => c.grams !== 41700)).toBe(true);

    const milk = calculated.find((c) => c.raw_phrase === "full fat milk")!;
    expect(milk.grams).toBe(50);
    expect(milk.calories).toBeCloseTo(30.5, 1); // 50 × 61/100

    const sugar = calculated.find((c) => c.raw_phrase === "sugar")!;
    expect(sugar.grams).toBe(15);
    expect(sugar.calories).toBeCloseTo(58.1, 1); // 15 × 387/100
  });
});

// ── Food-form ambiguity detection logic ───────────────────────────────────

describe("Food form ambiguity detection (ratio threshold logic)", () => {
  const FOOD_FORM_RATIO_THRESHOLD = 3.0;

  function isAmbiguous(candidates: Array<{ calories100g: number }>): boolean {
    const top = candidates.slice(0, 3).filter((c) => c.calories100g > 0);
    if (top.length < 2) return false;
    const max = Math.max(...top.map((c) => c.calories100g));
    const min = Math.min(...top.map((c) => c.calories100g));
    return max / min > FOOD_FORM_RATIO_THRESHOLD;
  }

  it("cooked oatmeal (71) vs dry oats (380) triggers ambiguity — ratio ~5.4", () => {
    expect(isAmbiguous([
      { calories100g: 71 },   // cooked
      { calories100g: 380 },  // dry
      { calories100g: 374 },  // instant dry
    ])).toBe(true);
  });

  it("similar chicken preparations do not trigger ambiguity — ratio ~1.1", () => {
    expect(isAmbiguous([
      { calories100g: 165 },
      { calories100g: 172 },
      { calories100g: 160 },
    ])).toBe(false);
  });

  it("single result never triggers ambiguity", () => {
    expect(isAmbiguous([{ calories100g: 380 }])).toBe(false);
  });

  it("zero-calorie entries are excluded before computing ratio", () => {
    // Broken data with a zero entry should not suppress a real ambiguity.
    expect(isAmbiguous([
      { calories100g: 0 },
      { calories100g: 380 },
      { calories100g: 71 },
    ])).toBe(true);
  });
});
