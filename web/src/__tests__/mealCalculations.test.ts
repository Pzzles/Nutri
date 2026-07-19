import { describe, it, expect } from "vitest";
import { scaleMacros } from "../lib/meal";
import type { CalculatedItem } from "../lib/types";

const BASE_ITEM: CalculatedItem = {
  raw_phrase: "chicken breast",
  normalized_query: "chicken breast",
  food_id: "00000000-0000-0000-0000-000000000001",
  quantity: 150,
  unit: "g",
  match_confidence: "exact",
  portion_confidence: "exact",
  item_confidence: "high",
  calories: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
  fibre_g: 0,
  nutrition_source: "fatsecret",
  portion_g: 150,
  portion_source: "explicit",
  history_use_count: null,
};

describe("scaleMacros", () => {
  it("scales macros proportionally when portion changes", () => {
    const result = scaleMacros(BASE_ITEM, 300);
    expect(result.portion_g).toBe(300);
    expect(result.calories).toBeCloseTo(330, 1);
    expect(result.protein_g).toBeCloseTo(62, 1);
    expect(result.carbs_g).toBeCloseTo(0, 1);
    expect(result.fat_g).toBeCloseTo(7.2, 1);
  });

  it("sets portion_source to explicit regardless of original source", () => {
    const historyItem: CalculatedItem = { ...BASE_ITEM, portion_source: "history", history_use_count: 3 };
    const result = scaleMacros(historyItem, 200);
    expect(result.portion_source).toBe("explicit");
    expect(result.history_use_count).toBeNull();
  });

  it("scales to 50g (half portion)", () => {
    const result = scaleMacros(BASE_ITEM, 50);
    expect(result.calories).toBeCloseTo(55, 1);
    expect(result.protein_g).toBeCloseTo(10.3, 1);
  });

  it("preserves fibre_g null when original is null", () => {
    const noFibre: CalculatedItem = { ...BASE_ITEM, fibre_g: null };
    const result = scaleMacros(noFibre, 200);
    expect(result.fibre_g).toBeNull();
  });

  it("scales fibre_g when original is non-null", () => {
    const withFibre: CalculatedItem = { ...BASE_ITEM, fibre_g: 4 };
    const result = scaleMacros(withFibre, 300);
    expect(result.fibre_g).toBeCloseTo(8, 1);
  });

  it("sets unit to g and quantity to new gram weight", () => {
    const result = scaleMacros(BASE_ITEM, 75);
    expect(result.unit).toBe("g");
    expect(result.quantity).toBe(75);
  });
});
