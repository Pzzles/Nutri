// Tests for the PRODUCTION normaliseUnit implementation.
// Imports directly from the shared Edge Function module — no inlined copy.
import { describe, it, expect } from "vitest";
import { normaliseUnit } from "@shared/portionUnits";

describe("normaliseUnit — null / empty / whitespace", () => {
  it("null → null", () => expect(normaliseUnit(null)).toBeNull());
  it("undefined → null", () => expect(normaliseUnit(undefined)).toBeNull());
  it("empty string → null", () => expect(normaliseUnit("")).toBeNull());
  it("whitespace only → null", () => expect(normaliseUnit("   ")).toBeNull());
});

describe("normaliseUnit — milligrams", () => {
  it("mg", () => expect(normaliseUnit("mg")).toEqual({ canonical: "mg", category: "mass" }));
  it("milligram", () => expect(normaliseUnit("milligram")).toEqual({ canonical: "mg", category: "mass" }));
  it("milligrams", () => expect(normaliseUnit("milligrams")).toEqual({ canonical: "mg", category: "mass" }));
  it("MG (uppercase)", () => expect(normaliseUnit("MG")).toEqual({ canonical: "mg", category: "mass" }));
  it("Milligrams (mixed case)", () => expect(normaliseUnit("Milligrams")).toEqual({ canonical: "mg", category: "mass" }));
  it("  mg  (surrounding whitespace)", () => expect(normaliseUnit("  mg  ")).toEqual({ canonical: "mg", category: "mass" }));
});

describe("normaliseUnit — grams", () => {
  it("g", () => expect(normaliseUnit("g")).toEqual({ canonical: "g", category: "mass" }));
  it("gram", () => expect(normaliseUnit("gram")).toEqual({ canonical: "g", category: "mass" }));
  it("grams", () => expect(normaliseUnit("grams")).toEqual({ canonical: "g", category: "mass" }));
  it("G (uppercase)", () => expect(normaliseUnit("G")).toEqual({ canonical: "g", category: "mass" }));
  it("Grams (mixed case)", () => expect(normaliseUnit("Grams")).toEqual({ canonical: "g", category: "mass" }));
  it("  g  (surrounding whitespace)", () => expect(normaliseUnit("  g  ")).toEqual({ canonical: "g", category: "mass" }));
});

describe("normaliseUnit — kilograms", () => {
  it("kg", () => expect(normaliseUnit("kg")).toEqual({ canonical: "kg", category: "mass" }));
  it("kilogram", () => expect(normaliseUnit("kilogram")).toEqual({ canonical: "kg", category: "mass" }));
  it("kilograms", () => expect(normaliseUnit("kilograms")).toEqual({ canonical: "kg", category: "mass" }));
  it("KG (uppercase)", () => expect(normaliseUnit("KG")).toEqual({ canonical: "kg", category: "mass" }));
});

describe("normaliseUnit — millilitres (British and US)", () => {
  it("ml", () => expect(normaliseUnit("ml")).toEqual({ canonical: "ml", category: "volume" }));
  it("millilitre (British)", () => expect(normaliseUnit("millilitre")).toEqual({ canonical: "ml", category: "volume" }));
  it("millilitres (British plural)", () => expect(normaliseUnit("millilitres")).toEqual({ canonical: "ml", category: "volume" }));
  it("milliliter (US)", () => expect(normaliseUnit("milliliter")).toEqual({ canonical: "ml", category: "volume" }));
  it("milliliters (US plural)", () => expect(normaliseUnit("milliliters")).toEqual({ canonical: "ml", category: "volume" }));
  it("ML (uppercase)", () => expect(normaliseUnit("ML")).toEqual({ canonical: "ml", category: "volume" }));
});

describe("normaliseUnit — litres (British and US)", () => {
  it("l", () => expect(normaliseUnit("l")).toEqual({ canonical: "l", category: "volume" }));
  it("litre (British)", () => expect(normaliseUnit("litre")).toEqual({ canonical: "l", category: "volume" }));
  it("litres (British plural)", () => expect(normaliseUnit("litres")).toEqual({ canonical: "l", category: "volume" }));
  it("liter (US)", () => expect(normaliseUnit("liter")).toEqual({ canonical: "l", category: "volume" }));
  it("liters (US plural)", () => expect(normaliseUnit("liters")).toEqual({ canonical: "l", category: "volume" }));
  it("L (uppercase)", () => expect(normaliseUnit("L")).toEqual({ canonical: "l", category: "volume" }));
});

describe("normaliseUnit — count singulars", () => {
  it("piece", () => expect(normaliseUnit("piece")?.canonical).toBe("count"));
  it("item", () => expect(normaliseUnit("item")?.canonical).toBe("count"));
  it("slice", () => expect(normaliseUnit("slice")?.canonical).toBe("count"));
  it("serving", () => expect(normaliseUnit("serving")?.canonical).toBe("count"));
  it("portion", () => expect(normaliseUnit("portion")?.canonical).toBe("count"));
});

describe("normaliseUnit — count plurals", () => {
  it("pieces", () => expect(normaliseUnit("pieces")?.canonical).toBe("count"));
  it("items", () => expect(normaliseUnit("items")?.canonical).toBe("count"));
  it("slices", () => expect(normaliseUnit("slices")?.canonical).toBe("count"));
  it("servings", () => expect(normaliseUnit("servings")?.canonical).toBe("count"));
  it("portions", () => expect(normaliseUnit("portions")?.canonical).toBe("count"));
});

describe("normaliseUnit — unsupported units return null (never silently become count)", () => {
  it("mgg (misspelling of mg)", () => expect(normaliseUnit("mgg")).toBeNull());
  it("gm (reversed letters, not in table)", () => expect(normaliseUnit("gm")).toBeNull());
  it("oz (imperial ounce)", () => expect(normaliseUnit("oz")).toBeNull());
  it("lb (imperial pound)", () => expect(normaliseUnit("lb")).toBeNull());
  it("cup", () => expect(normaliseUnit("cup")).toBeNull());
  it("tbsp (tablespoon)", () => expect(normaliseUnit("tbsp")).toBeNull());
  it("tsp (teaspoon)", () => expect(normaliseUnit("tsp")).toBeNull());
  it("arbitrary string xyz", () => expect(normaliseUnit("xyz")).toBeNull());
  it("empty-ish unicode space", () => expect(normaliseUnit(" ")).toBeNull());
});
