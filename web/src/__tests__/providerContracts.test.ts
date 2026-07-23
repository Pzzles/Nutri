// Provider contract tests — pure adapter functions only.
// NO live HTTP calls. See scripts/smoke-test-providers.ts for optional live-API verification.
import { describe, it, expect } from "vitest";
import { parseDescription, pickServing } from "@shared/fatsecret";
import { parseNutrients, pickBestMatch } from "@shared/usda";
import type { UsdaFood } from "@shared/usda";
import { filterForbiddenKeys, sanitizeGroqItem, FORBIDDEN_KEYS } from "@shared/groqParser";

import fsServingId0 from "./fixtures/fs_serving_id0.json";
import fsPerServing from "./fixtures/fs_per_serving.json";
import fsNoGramServing from "./fixtures/fs_no_gram_serving.json";
import usdaNutrientsFull from "./fixtures/usda_nutrients_full.json";
import usdaNutrientsMissingFibre from "./fixtures/usda_nutrients_missing_fibre.json";
import usdaNutrientsFibreZero from "./fixtures/usda_nutrients_fibre_zero.json";
import groqSuccess from "./fixtures/groq_success.json";
import groqForbiddenKeys from "./fixtures/groq_forbidden_keys.json";
import groqMalformedContent from "./fixtures/groq_malformed_content.json";
import offSuccess from "./fixtures/off_success.json";
import offNotFound from "./fixtures/off_not_found.json";
import offMissingNutrients from "./fixtures/off_missing_nutrients.json";

// ── FatSecret — parseDescription ─────────────────────────────────────────────

describe("FatSecret adapter — parseDescription", () => {
  it("100g format: extracts per-100g macros, no servingSizeG", () => {
    const result = parseDescription("Per 100g - Calories: 61kcal | Fat: 3.27g | Carbs: 4.78g | Prot: 3.15g");
    expect(result).not.toBeNull();
    expect(result!.servingSizeG).toBeNull();
    expect(result!.calories100g).toBe(61);
    expect(result!.fat100g).toBe(3.27);
    expect(result!.carbs100g).toBe(4.78);
    expect(result!.protein100g).toBe(3.15);
    expect(result!.fibre100g).toBeNull();
  });

  it("per-serving format: scales macros to per-100g and sets servingSizeG", () => {
    // Per 1 serving (32g): all values scaled by ×(100/32)
    const result = parseDescription(
      "Per 1 serving (32g) - Calories: 188kcal | Fat: 16.00g | Carbs: 6.06g | Prot: 8.00g | Fiber: 1.90g",
    );
    expect(result).not.toBeNull();
    expect(result!.servingSizeG).toBe(32);
    expect(result!.calories100g).toBeCloseTo(587.5, 1);
    expect(result!.fat100g).toBeCloseTo(50, 1);
    expect(result!.carbs100g).toBeCloseTo(18.94, 1);
    expect(result!.protein100g).toBeCloseTo(25, 1);
    expect(result!.fibre100g).toBeCloseTo(5.94, 1);
  });

  it("Fiber keyword in description → fibre100g is set", () => {
    const result = parseDescription(
      "Per 100g - Calories: 23kcal | Fat: 0.39g | Carbs: 3.63g | Prot: 2.86g | Fiber: 2.20g",
    );
    expect(result!.fibre100g).toBeCloseTo(2.2, 2);
  });

  it("Fiber absent from description → fibre100g is null", () => {
    const result = parseDescription("Per 100g - Calories: 165kcal | Fat: 3.60g | Carbs: 0.00g | Prot: 31.00g");
    expect(result!.fibre100g).toBeNull();
  });

  it("Fat and Carbs absent → defaults to 0", () => {
    const result = parseDescription("Per 100g - Calories: 100kcal | Prot: 5.00g");
    expect(result).not.toBeNull();
    expect(result!.fat100g).toBe(0);
    expect(result!.carbs100g).toBe(0);
  });

  it("no Calories in description → returns null", () => {
    expect(parseDescription("Per 100g - Fat: 3.27g | Carbs: 4.78g | Prot: 3.15g")).toBeNull();
  });

  it("empty string → returns null", () => {
    expect(parseDescription("")).toBeNull();
  });
});

// ── FatSecret — pickServing ───────────────────────────────────────────────────

describe("FatSecret adapter — pickServing (fixture: fs_serving_id0)", () => {
  it("serving_id '0' with metric_serving_unit 'g' is the per-100g entry → per100: true", () => {
    const result = pickServing(fsServingId0 as any[]);
    expect(result).not.toBeNull();
    expect(result!.per100).toBe(true);
    expect(result!.serving.serving_id).toBe("0");
  });

  it("returns serving_id '0' entry even when it is not marked as default", () => {
    const servings = [
      { serving_id: "0", metric_serving_unit: "g", metric_serving_amount: "100.000", is_default: "0", calories: "61" },
      { serving_id: "30291", metric_serving_unit: "g", metric_serving_amount: "244.000", is_default: "1", calories: "149" },
    ];
    expect(pickServing(servings as any[])!.serving.serving_id).toBe("0");
    expect(pickServing(servings as any[])!.per100).toBe(true);
  });
});

describe("FatSecret adapter — pickServing (fixture: fs_per_serving)", () => {
  it("default serving with metric_serving_unit 'g' and no serving_id '0' → per100: false", () => {
    const result = pickServing(fsPerServing as any[]);
    expect(result).not.toBeNull();
    expect(result!.per100).toBe(false);
    expect(result!.serving.serving_id).toBe("56789");
    expect(result!.serving.metric_serving_amount).toBe("32.000");
  });
});

describe("FatSecret adapter — pickServing (fixture: fs_no_gram_serving)", () => {
  it("only oz serving → returns null (no gram serving to use)", () => {
    expect(pickServing(fsNoGramServing as any[])).toBeNull();
  });
});

describe("FatSecret adapter — pickServing edge cases", () => {
  it("empty array → null", () => {
    expect(pickServing([])).toBeNull();
  });

  it("g serving with metric_serving_amount '0' → skipped (must be positive)", () => {
    const servings = [
      { serving_id: "11", metric_serving_unit: "g", metric_serving_amount: "0", is_default: "1", calories: "0" },
    ];
    expect(pickServing(servings as any[])).toBeNull();
  });

  it("non-g first, then g → picks the g serving", () => {
    const servings = [
      { serving_id: "1", metric_serving_unit: "oz", metric_serving_amount: "1.000", is_default: "0", calories: "28" },
      { serving_id: "2", metric_serving_unit: "g", metric_serving_amount: "100.000", is_default: "1", calories: "61" },
    ];
    const result = pickServing(servings as any[]);
    expect(result).not.toBeNull();
    expect(result!.serving.metric_serving_unit).toBe("g");
  });
});

// ── USDA — parseNutrients ─────────────────────────────────────────────────────

describe("USDA adapter — parseNutrients (fixture: usda_nutrients_full)", () => {
  it("all five nutrient IDs present → correct values", () => {
    const result = parseNutrients(usdaNutrientsFull as any[]);
    expect(result.calories).toBe(61);
    expect(result.protein).toBe(3.15);
    expect(result.carbs).toBe(4.78);
    expect(result.fat).toBe(3.27);
    expect(result.fibre).toBe(0.5);
  });
});

describe("USDA adapter — parseNutrients (fixture: usda_nutrients_missing_fibre)", () => {
  it("nutrient ID 1079 absent → fibre is null", () => {
    const result = parseNutrients(usdaNutrientsMissingFibre as any[]);
    expect(result.fibre).toBeNull();
    expect(result.calories).toBe(61);
  });
});

describe("USDA adapter — parseNutrients (fixture: usda_nutrients_fibre_zero)", () => {
  // Known behaviour: `get(1079) || null` — value 0 is falsy, so it becomes null.
  it("fibre value 0 → fibre is null (falsy coercion in current implementation)", () => {
    const result = parseNutrients(usdaNutrientsFibreZero as any[]);
    expect(result.fibre).toBeNull();
  });
});

describe("USDA adapter — parseNutrients edge cases", () => {
  it("empty array → all zeros, fibre null", () => {
    const result = parseNutrients([]);
    expect(result.calories).toBe(0);
    expect(result.protein).toBe(0);
    expect(result.carbs).toBe(0);
    expect(result.fat).toBe(0);
    expect(result.fibre).toBeNull();
  });

  it("unrelated nutrientIds are ignored", () => {
    const result = parseNutrients([{ nutrientId: 9999, value: 9999 }, { nutrientId: 1008, value: 100 }] as any[]);
    expect(result.calories).toBe(100);
    expect(result.protein).toBe(0);
  });

  it("calories (ID 1008) absent → calories is 0", () => {
    const result = parseNutrients([{ nutrientId: 1003, value: 5 }] as any[]);
    expect(result.calories).toBe(0);
  });
});

// ── USDA — pickBestMatch ──────────────────────────────────────────────────────

describe("USDA adapter — pickBestMatch", () => {
  const makeFood = (description: string, fdcId = 1): UsdaFood => ({
    fdcId,
    description,
    brandOwner: null,
    servingSize: null,
    calories: 100,
    protein: 5,
    carbs: 10,
    fat: 3,
    fibre: null,
  });

  it("non-PREFER candidate first, PREFER candidate second → picks PREFER candidate", () => {
    const candidates = [makeFood("Oat bran, generic", 1), makeFood("Oat bran, raw", 2)];
    expect(pickBestMatch(candidates)!.description).toBe("Oat bran, raw");
  });

  it("when multiple candidates match PREFER, the first one wins", () => {
    const candidates = [makeFood("Oat bran, cooked", 1), makeFood("Oat bran, raw", 2)];
    // Both 'cooked' and 'raw' match the PREFER regex; find() returns the first
    expect(pickBestMatch(candidates)!.fdcId).toBe(1);
  });

  it("prefers 'fresh' description over frozen", () => {
    const candidates = [makeFood("Broccoli, frozen", 1), makeFood("Broccoli, fresh", 2)];
    expect(pickBestMatch(candidates)!.description).toBe("Broccoli, fresh");
  });

  it("prefers 'cooked' over generic", () => {
    const candidates = [makeFood("Oats, generic blend", 1), makeFood("Oats, cooked", 2)];
    expect(pickBestMatch(candidates)!.description).toBe("Oats, cooked");
  });

  it("deprioritizes 'dried' — picks non-dried candidate first", () => {
    const candidates = [makeFood("Mushrooms, dried", 1), makeFood("Mushrooms, cooked", 2)];
    expect(pickBestMatch(candidates)!.description).toBe("Mushrooms, cooked");
  });

  it("deprioritizes 'powder' — picks non-powder candidate", () => {
    const candidates = [makeFood("Milk, powder", 1), makeFood("Milk, whole", 2)];
    expect(pickBestMatch(candidates)!.description).toBe("Milk, whole");
  });

  it("deprioritizes 'dehydrated' — picks non-dehydrated candidate", () => {
    const candidates = [makeFood("Potato, dehydrated", 1), makeFood("Potato, boiled", 2)];
    expect(pickBestMatch(candidates)!.description).toBe("Potato, boiled");
  });

  it("falls back to first candidate when no PREFER or DEPRIORITIZE match", () => {
    const candidates = [makeFood("Granola bar", 1), makeFood("Energy bar", 2)];
    expect(pickBestMatch(candidates)!.fdcId).toBe(1);
  });

  it("single candidate → returned regardless of description content", () => {
    expect(pickBestMatch([makeFood("Oat bran, dried powder concentrate", 1)])!.fdcId).toBe(1);
  });

  it("empty array → null", () => {
    expect(pickBestMatch([])).toBeNull();
  });

  it("prefers non-deprioritized over deprioritized even if PREFER word absent", () => {
    const candidates = [makeFood("Concentrate", 1), makeFood("Plain cereal", 2)];
    expect(pickBestMatch(candidates)!.fdcId).toBe(2);
  });
});

// ── Groq parser — filterForbiddenKeys ────────────────────────────────────────

describe("Groq parser — filterForbiddenKeys (fixture: groq_success)", () => {
  it("success fixture content is valid JSON containing ParsedFoodItem fields", () => {
    const content = (groqSuccess.choices[0].message as any).content as string;
    const items = JSON.parse(content);
    expect(Array.isArray(items)).toBe(true);
    expect(items[0]).toHaveProperty("raw_phrase");
    expect(items[0]).toHaveProperty("normalized_name");
    expect(["high", "medium", "low"]).toContain(items[0].confidence_hint);
    expect(typeof items[0].ambiguous).toBe("boolean");
  });

  it("clean items all pass through filterForbiddenKeys unchanged", () => {
    const content = (groqSuccess.choices[0].message as any).content as string;
    const items = JSON.parse(content);
    expect(filterForbiddenKeys(items)).toHaveLength(items.length);
  });
});

describe("Groq parser — filterForbiddenKeys (fixture: groq_forbidden_keys)", () => {
  it("items with 'calories' or 'protein' keys are rejected, clean items pass", () => {
    const content = (groqForbiddenKeys.choices[0].message as any).content as string;
    const items = JSON.parse(content);
    const filtered = filterForbiddenKeys(items);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].normalized_name).toBe("brown rice");
  });

  it("FORBIDDEN_KEYS constant covers calories, protein, fat, carbs, fibre, fiber, macros", () => {
    expect(FORBIDDEN_KEYS).toContain("calories");
    expect(FORBIDDEN_KEYS).toContain("protein");
    expect(FORBIDDEN_KEYS).toContain("fat");
    expect(FORBIDDEN_KEYS).toContain("carbs");
    expect(FORBIDDEN_KEYS).toContain("fibre");
    expect(FORBIDDEN_KEYS).toContain("fiber");
    expect(FORBIDDEN_KEYS).toContain("macros");
  });
});

describe("Groq parser — filterForbiddenKeys (fixture: groq_malformed_content)", () => {
  it("malformed fixture content is not valid JSON (parser must handle retry)", () => {
    const content = (groqMalformedContent.choices[0].message as any).content as string;
    expect(() => JSON.parse(content)).toThrow(SyntaxError);
  });
});

// ── Groq parser — sanitizeGroqItem ───────────────────────────────────────────

describe("Groq parser — sanitizeGroqItem", () => {
  it("string 'null' quantity → null", () => {
    expect(sanitizeGroqItem({ quantity: "null", unit: "g" }).quantity).toBeNull();
  });

  it("JSON null quantity → null", () => {
    expect(sanitizeGroqItem({ quantity: null, unit: "g" }).quantity).toBeNull();
  });

  it("numeric string quantity → coerced to Number", () => {
    expect(sanitizeGroqItem({ quantity: "2", unit: "g" }).quantity).toBe(2);
  });

  it("float string quantity → coerced to Number", () => {
    expect(sanitizeGroqItem({ quantity: "1.5", unit: "kg" }).quantity).toBe(1.5);
  });

  it("string 'null' unit → null", () => {
    expect(sanitizeGroqItem({ quantity: 1, unit: "null" }).unit).toBeNull();
  });

  it("empty string unit → null", () => {
    expect(sanitizeGroqItem({ quantity: 1, unit: "" }).unit).toBeNull();
  });

  it("valid unit string → unchanged", () => {
    expect(sanitizeGroqItem({ quantity: 1, unit: "g" }).unit).toBe("g");
  });

  it("all non-quantity/unit fields pass through unchanged", () => {
    const item = sanitizeGroqItem({
      raw_phrase: "2 eggs",
      normalized_name: "egg",
      quantity: 2,
      unit: "piece",
      confidence_hint: "high",
      ambiguous: false,
    });
    expect(item.raw_phrase).toBe("2 eggs");
    expect(item.normalized_name).toBe("egg");
    expect(item.confidence_hint).toBe("high");
    expect(item.ambiguous).toBe(false);
  });
});

// ── Open Food Facts — response shape contract ─────────────────────────────────
// The barcode-lookup adapter is inline in a Deno handler and cannot be imported
// in Vitest directly. These tests verify that fixture files correctly represent
// the API shapes the adapter expects.

describe("Open Food Facts — success response contract (fixture: off_success)", () => {
  it("status is 1 and product is present", () => {
    expect(offSuccess.status).toBe(1);
    expect(offSuccess.product).toBeDefined();
  });

  it("nutriments contain the four required keys", () => {
    const n = offSuccess.product.nutriments as Record<string, unknown>;
    expect(n).toHaveProperty("energy-kcal_100g");
    expect(n).toHaveProperty("proteins_100g");
    expect(n).toHaveProperty("carbohydrates_100g");
    expect(n).toHaveProperty("fat_100g");
  });

  it("adapter would produce correct normalized payload", () => {
    const p = offSuccess.product;
    const n = p.nutriments as Record<string, number | null>;
    const payload = {
      name: p.product_name ?? "Unknown product",
      brand: (p as any).brands ?? null,
      calories_100g: n["energy-kcal_100g"] ?? 0,
      protein_100g: n["proteins_100g"] ?? 0,
      carbs_100g: n["carbohydrates_100g"] ?? 0,
      fat_100g: n["fat_100g"] ?? 0,
      fibre_100g: n["fiber_100g"] ?? null,
    };
    expect(payload.calories_100g).toBe(61);
    expect(payload.protein_100g).toBe(3.15);
    expect(payload.brand).toBe("Organic Valley");
    expect(payload.fibre_100g).toBe(0);
  });
});

describe("Open Food Facts — not-found response contract (fixture: off_not_found)", () => {
  it("status is 0 and no product key exists", () => {
    expect(offNotFound.status).toBe(0);
    expect((offNotFound as any).product).toBeUndefined();
  });

  it("adapter condition json?.status !== 1 would return FOOD_NOT_FOUND", () => {
    expect(offNotFound.status !== 1).toBe(true);
  });
});

describe("Open Food Facts — missing nutrient fields (fixture: off_missing_nutrients)", () => {
  it("absent nutriment keys: adapter ?? 0 / ?? null defaults apply", () => {
    const n = offMissingNutrients.product.nutriments as Record<string, unknown>;
    expect(n["proteins_100g"] ?? 0).toBe(0);
    expect(n["carbohydrates_100g"] ?? 0).toBe(0);
    expect(n["fat_100g"] ?? 0).toBe(0);
    expect(n["fiber_100g"] ?? null).toBeNull();
    expect(n["energy-kcal_100g"]).toBe(350);
  });
});
