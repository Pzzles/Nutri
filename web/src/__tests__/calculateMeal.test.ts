// Integration tests for the calculate-meal logic.
// Tests the real production resolveWeightGrams + nutrition math together
// with deterministic mock food/portion data — no Supabase, no HTTP.
import { describe, it, expect } from "vitest";
import { resolveWeightGrams, EXTREME_PORTION_THRESHOLD_G } from "@shared/portionResolution";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockFood {
  id: string;
  calories_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fibre_100g: number | null;
  serving_size_g: number | null;
}

interface MockItem {
  food_id: string;
  raw_phrase: string;
  quantity: number | null;
  unit: string | null;
  extreme_confirmed?: boolean;
}

interface MockPortion {
  food_id: string;
  usual_g: number;
  use_count: number;
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

function simulateMealCalculation(
  items: MockItem[],
  foods: MockFood[],
  portions: MockPortion[] = [],
) {
  const foodMap = new Map(foods.map((f) => [f.id, f]));
  const portionMap = new Map(portions.map((p) => [p.food_id, p]));

  const calculated: Array<{ raw_phrase: string; food_id: string; grams: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; fibre_g: number | null }> = [];
  const clarifications: Array<{ raw_phrase: string; code: string }> = [];

  for (const item of items) {
    const food = foodMap.get(item.food_id);
    if (!food) { clarifications.push({ raw_phrase: item.raw_phrase, code: "FOOD_NOT_FOUND" }); continue; }

    const history = portionMap.get(item.food_id) ?? null;
    const resolution = resolveWeightGrams(
      { quantity: item.quantity, unit: item.unit, extreme_confirmed: item.extreme_confirmed },
      food.serving_size_g,
      history,
    );

    if (resolution.kind === "clarification") {
      clarifications.push({ raw_phrase: item.raw_phrase, code: resolution.clarification.code });
      continue;
    }

    const factor = resolution.grams / 100;
    calculated.push({
      raw_phrase: item.raw_phrase,
      food_id: item.food_id,
      grams: resolution.grams,
      calories: round(food.calories_100g * factor),
      protein_g: round(food.protein_100g * factor),
      carbs_g: round(food.carbs_100g * factor),
      fat_g: round(food.fat_100g * factor),
      fibre_g: food.fibre_100g != null ? round(food.fibre_100g * factor) : null,
    });
  }

  const totals = {
    calories: round(calculated.reduce((s, i) => s + i.calories, 0)),
    protein_g: round(calculated.reduce((s, i) => s + i.protein_g, 0)),
    carbs_g: round(calculated.reduce((s, i) => s + i.carbs_g, 0)),
    fat_g: round(calculated.reduce((s, i) => s + i.fat_g, 0)),
    fibre_g: round(calculated.reduce((s, i) => s + (i.fibre_g ?? 0), 0)),
  };

  return { calculated, clarifications, totals };
}

// ── Test foods ────────────────────────────────────────────────────────────────

const OATMEAL: MockFood = { id: "oatmeal-dry", calories_100g: 379.0, protein_100g: 13.0, carbs_100g: 68.0, fat_100g: 6.5, fibre_100g: 10.6, serving_size_g: 278 };
const OATMEAL_COOKED: MockFood = { id: "oatmeal-cooked", calories_100g: 71.0, protein_100g: 2.5, carbs_100g: 12.0, fat_100g: 1.5, fibre_100g: 1.7, serving_size_g: null };
const MILK: MockFood = { id: "milk", calories_100g: 61.0, protein_100g: 3.2, carbs_100g: 4.8, fat_100g: 3.3, fibre_100g: 0, serving_size_g: 100 };
const SUGAR: MockFood = { id: "sugar", calories_100g: 387.0, protein_100g: 0, carbs_100g: 100.0, fat_100g: 0, fibre_100g: 0, serving_size_g: 10 };
const CHICKEN: MockFood = { id: "chicken", calories_100g: 165.0, protein_100g: 31.0, carbs_100g: 0, fat_100g: 3.6, fibre_100g: null, serving_size_g: null };

// ── Core regression ───────────────────────────────────────────────────────────

describe("Regression: 150 mg oatmeal session", () => {
  const session: MockItem[] = [
    { food_id: "oatmeal-dry", raw_phrase: "oatmeal",       quantity: 150, unit: "mg" },
    { food_id: "milk",        raw_phrase: "full fat milk",  quantity: 50,  unit: "g"  },
    { food_id: "sugar",       raw_phrase: "sugar",          quantity: 15,  unit: "g"  },
  ];

  it("oatmeal 150 mg → LIKELY_UNIT_ERROR, not in totals", () => {
    const { clarifications, calculated } = simulateMealCalculation(session, [OATMEAL, MILK, SUGAR]);
    expect(clarifications).toHaveLength(1);
    expect(clarifications[0].raw_phrase).toBe("oatmeal");
    expect(clarifications[0].code).toBe("LIKELY_UNIT_ERROR");
    expect(calculated.find((c) => c.raw_phrase === "oatmeal")).toBeUndefined();
  });

  it("oatmeal does not contribute ~41 700 g or ~25 950 kcal", () => {
    const { totals } = simulateMealCalculation(session, [OATMEAL, MILK, SUGAR]);
    expect(totals.calories).toBeLessThan(200); // milk + sugar only
    expect(totals.calories).toBeGreaterThan(0);
  });

  it("milk and sugar are calculated correctly", () => {
    const { calculated } = simulateMealCalculation(session, [OATMEAL, MILK, SUGAR]);
    const milk = calculated.find((c) => c.raw_phrase === "full fat milk")!;
    expect(milk.grams).toBe(50);
    expect(milk.calories).toBeCloseTo(30.5, 1);

    const sugar = calculated.find((c) => c.raw_phrase === "sugar")!;
    expect(sugar.grams).toBe(15);
    expect(sugar.calories).toBeCloseTo(58.1, 1);
  });

  it("no NaN, infinity, or negative macro values", () => {
    const { totals, calculated } = simulateMealCalculation(session, [OATMEAL, MILK, SUGAR]);
    const allValues = [
      totals.calories, totals.protein_g, totals.carbs_g, totals.fat_g,
      ...calculated.flatMap((i) => [i.calories, i.protein_g, i.carbs_g, i.fat_g]),
    ];
    for (const v of allValues) {
      expect(isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("clarification_required contains oatmeal, meal confidence excludes it", () => {
    const { clarifications, calculated } = simulateMealCalculation(session, [OATMEAL, MILK, SUGAR]);
    expect(clarifications.map((c) => c.raw_phrase)).toContain("oatmeal");
    expect(calculated.map((c) => c.raw_phrase)).not.toContain("oatmeal");
  });
});

// ── Single valid item ─────────────────────────────────────────────────────────

describe("One valid item", () => {
  it("150g chicken → correct macros", () => {
    const { calculated, totals, clarifications } = simulateMealCalculation(
      [{ food_id: "chicken", raw_phrase: "chicken breast", quantity: 150, unit: "g" }],
      [CHICKEN],
    );
    expect(clarifications).toHaveLength(0);
    expect(calculated).toHaveLength(1);
    expect(calculated[0].grams).toBe(150);
    expect(calculated[0].calories).toBeCloseTo(247.5, 1);
    expect(calculated[0].protein_g).toBeCloseTo(46.5, 1);
    expect(calculated[0].fibre_g).toBeNull();
    expect(totals.calories).toBeCloseTo(247.5, 1);
  });
});

// ── All items unresolved ──────────────────────────────────────────────────────

describe("All items unresolved", () => {
  it("when all items need clarification, calculated is empty and totals are zero", () => {
    const { calculated, clarifications, totals } = simulateMealCalculation(
      [
        { food_id: "oatmeal-dry", raw_phrase: "oatmeal", quantity: 150, unit: "mg" },
        { food_id: "milk",        raw_phrase: "milk",     quantity: 2,   unit: "cups" },
      ],
      [OATMEAL, MILK],
    );
    expect(clarifications).toHaveLength(2);
    expect(calculated).toHaveLength(0);
    expect(totals.calories).toBe(0);
  });
});

// ── Mixed valid and unresolved ────────────────────────────────────────────────

describe("Valid and unresolved items mixed", () => {
  it("totals only include resolved items", () => {
    const { calculated, clarifications, totals } = simulateMealCalculation(
      [
        { food_id: "milk",  raw_phrase: "milk",    quantity: 100, unit: "g"   },
        { food_id: "sugar", raw_phrase: "sugar",   quantity: 5,   unit: "tbsp" }, // unsupported
      ],
      [MILK, SUGAR],
    );
    expect(clarifications).toHaveLength(1);
    expect(clarifications[0].raw_phrase).toBe("sugar");
    expect(calculated).toHaveLength(1);
    expect(totals.calories).toBeCloseTo(61.0, 1); // milk only
  });
});

// ── Missing food record ───────────────────────────────────────────────────────

describe("Missing food record", () => {
  it("unknown food_id → FOOD_NOT_FOUND clarification", () => {
    const { clarifications, calculated } = simulateMealCalculation(
      [{ food_id: "unknown-id", raw_phrase: "mystery food", quantity: 100, unit: "g" }],
      [],
    );
    expect(clarifications).toHaveLength(1);
    expect(clarifications[0].code).toBe("FOOD_NOT_FOUND");
    expect(calculated).toHaveLength(0);
  });
});

// ── Nullable fibre ────────────────────────────────────────────────────────────

describe("Nullable fibre", () => {
  it("food with null fibre_100g → fibre_g is null on calculated item", () => {
    const { calculated } = simulateMealCalculation(
      [{ food_id: "chicken", raw_phrase: "chicken", quantity: 100, unit: "g" }],
      [CHICKEN],
    );
    expect(calculated[0].fibre_g).toBeNull();
  });

  it("food with fibre_100g = 0 → fibre_g is 0 (not null)", () => {
    const { calculated } = simulateMealCalculation(
      [{ food_id: "milk", raw_phrase: "milk", quantity: 100, unit: "g" }],
      [MILK],
    );
    expect(calculated[0].fibre_g).toBe(0);
  });
});

// ── Decimal portions and rounding ─────────────────────────────────────────────

describe("Decimal portions and rounding", () => {
  it("1.5 kg chicken → 1500 g, calories rounded to 1 decimal", () => {
    const { calculated } = simulateMealCalculation(
      [{ food_id: "chicken", raw_phrase: "chicken", quantity: 1.5, unit: "kg" }],
      [CHICKEN],
    );
    expect(calculated[0].grams).toBe(1500);
    expect(Number.isFinite(calculated[0].calories)).toBe(true);
    // 1500g × 165/100 = 2475 kcal
    expect(calculated[0].calories).toBeCloseTo(2475, 1);
  });

  it("33.3 g → calories rounded to 1dp, no floating-point garbage", () => {
    const { calculated } = simulateMealCalculation(
      [{ food_id: "sugar", raw_phrase: "sugar", quantity: 33.3, unit: "g" }],
      [SUGAR],
    );
    const cal = calculated[0].calories;
    expect(String(cal).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

// ── Duplicate food IDs ────────────────────────────────────────────────────────

describe("Duplicate food IDs", () => {
  it("two items with the same food_id are both calculated (deduplification is the resolver's job)", () => {
    const { calculated } = simulateMealCalculation(
      [
        { food_id: "milk", raw_phrase: "morning milk", quantity: 100, unit: "g" },
        { food_id: "milk", raw_phrase: "evening milk", quantity: 200, unit: "g" },
      ],
      [MILK],
    );
    expect(calculated).toHaveLength(2);
    expect(calculated[0].grams).toBe(100);
    expect(calculated[1].grams).toBe(200);
  });
});

// ── Extreme portion confirmation ──────────────────────────────────────────────

describe("Extreme portion confirmation in session", () => {
  it("5000 g chicken without confirmation → clarification", () => {
    const { clarifications } = simulateMealCalculation(
      [{ food_id: "chicken", raw_phrase: "chicken", quantity: 5000, unit: "g" }],
      [CHICKEN],
    );
    expect(clarifications[0].code).toBe("EXTREME_PORTION");
  });

  it("5000 g chicken with extreme_confirmed → calculated, and included in totals", () => {
    const { calculated, clarifications, totals } = simulateMealCalculation(
      [{ food_id: "chicken", raw_phrase: "chicken", quantity: 5000, unit: "g", extreme_confirmed: true }],
      [CHICKEN],
    );
    expect(clarifications).toHaveLength(0);
    expect(calculated).toHaveLength(1);
    expect(calculated[0].grams).toBe(5000);
    expect(totals.calories).toBeCloseTo(8250, 0);
  });
});

// ── Empty input ───────────────────────────────────────────────────────────────

describe("Empty resolved-item array", () => {
  it("zero items → empty output, zero totals", () => {
    const { calculated, clarifications, totals } = simulateMealCalculation([], []);
    expect(calculated).toHaveLength(0);
    expect(clarifications).toHaveLength(0);
    expect(totals.calories).toBe(0);
  });
});

// ── EXTREME_PORTION threshold is 2000 (not 2001) ─────────────────────────────

describe("Extreme portion threshold boundary", () => {
  it(`exactly ${EXTREME_PORTION_THRESHOLD_G} g → ok (not extreme)`, () => {
    const { calculated } = simulateMealCalculation(
      [{ food_id: "milk", raw_phrase: "milk", quantity: EXTREME_PORTION_THRESHOLD_G, unit: "g" }],
      [MILK],
    );
    expect(calculated).toHaveLength(1);
  });

  it(`${EXTREME_PORTION_THRESHOLD_G + 0.001} g → extreme`, () => {
    const { clarifications } = simulateMealCalculation(
      [{ food_id: "milk", raw_phrase: "milk", quantity: EXTREME_PORTION_THRESHOLD_G + 0.001, unit: "g" }],
      [MILK],
    );
    expect(clarifications[0].code).toBe("EXTREME_PORTION");
  });
});
