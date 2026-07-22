import { describe, it, expect } from "vitest";

// Inlined from supabase/functions/_shared/portionUnits.ts for Node/Vitest
// compatibility (Deno modules can't be imported directly into Node).
// If this diverges from production, these tests become stale — keep in sync.

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

describe("normaliseUnit — null / empty", () => {
  it("null → null", () => expect(normaliseUnit(null)).toBeNull());
  it("undefined → null", () => expect(normaliseUnit(undefined)).toBeNull());
  it("empty string → null", () => expect(normaliseUnit("")).toBeNull());
  it("whitespace only → null", () => expect(normaliseUnit("  ")).toBeNull());
});

describe("normaliseUnit — mass units", () => {
  it("mg → mg/mass", () => expect(normaliseUnit("mg")).toEqual({ canonical: "mg", category: "mass" }));
  it("milligram → mg/mass", () => expect(normaliseUnit("milligram")).toEqual({ canonical: "mg", category: "mass" }));
  it("milligrams → mg/mass", () => expect(normaliseUnit("milligrams")).toEqual({ canonical: "mg", category: "mass" }));
  it("g → g/mass", () => expect(normaliseUnit("g")).toEqual({ canonical: "g", category: "mass" }));
  it("gram → g/mass", () => expect(normaliseUnit("gram")).toEqual({ canonical: "g", category: "mass" }));
  it("grams → g/mass", () => expect(normaliseUnit("grams")).toEqual({ canonical: "g", category: "mass" }));
  it("kg → kg/mass", () => expect(normaliseUnit("kg")).toEqual({ canonical: "kg", category: "mass" }));
  it("kilogram → kg/mass", () => expect(normaliseUnit("kilogram")).toEqual({ canonical: "kg", category: "mass" }));
  it("kilograms → kg/mass", () => expect(normaliseUnit("kilograms")).toEqual({ canonical: "kg", category: "mass" }));
});

describe("normaliseUnit — volume units", () => {
  it("ml → ml/volume", () => expect(normaliseUnit("ml")).toEqual({ canonical: "ml", category: "volume" }));
  it("millilitre → ml/volume", () => expect(normaliseUnit("millilitre")).toEqual({ canonical: "ml", category: "volume" }));
  it("milliliters (US spelling) → ml/volume", () => expect(normaliseUnit("milliliters")).toEqual({ canonical: "ml", category: "volume" }));
  it("l → l/volume", () => expect(normaliseUnit("l")).toEqual({ canonical: "l", category: "volume" }));
  it("litre → l/volume", () => expect(normaliseUnit("litre")).toEqual({ canonical: "l", category: "volume" }));
  it("liters (US spelling) → l/volume", () => expect(normaliseUnit("liters")).toEqual({ canonical: "l", category: "volume" }));
});

describe("normaliseUnit — count units", () => {
  it("piece → count", () => expect(normaliseUnit("piece")?.canonical).toBe("count"));
  it("pieces → count", () => expect(normaliseUnit("pieces")?.canonical).toBe("count"));
  it("item → count", () => expect(normaliseUnit("item")?.canonical).toBe("count"));
  it("items → count", () => expect(normaliseUnit("items")?.canonical).toBe("count"));
  it("slice → count", () => expect(normaliseUnit("slice")?.canonical).toBe("count"));
  it("slices → count", () => expect(normaliseUnit("slices")?.canonical).toBe("count"));
  it("serving → count", () => expect(normaliseUnit("serving")?.canonical).toBe("count"));
  it("servings → count", () => expect(normaliseUnit("servings")?.canonical).toBe("count"));
  it("portion → count", () => expect(normaliseUnit("portion")?.canonical).toBe("count"));
  it("portions → count", () => expect(normaliseUnit("portions")?.canonical).toBe("count"));
});

describe("normaliseUnit — unrecognised units return null (no silent fallback)", () => {
  it("mgg (misspelled) → null", () => expect(normaliseUnit("mgg")).toBeNull());
  it("oz → null (not in table)", () => expect(normaliseUnit("oz")).toBeNull());
  it("lb → null (not in table)", () => expect(normaliseUnit("lb")).toBeNull());
  it("cup → null (not in table)", () => expect(normaliseUnit("cup")).toBeNull());
  it("tbsp → null (not in table)", () => expect(normaliseUnit("tbsp")).toBeNull());
  it("tsp → null (not in table)", () => expect(normaliseUnit("tsp")).toBeNull());
  it("xyz → null", () => expect(normaliseUnit("xyz")).toBeNull());
});

describe("normaliseUnit — case and whitespace handling", () => {
  it("G (uppercase) → g/mass", () => expect(normaliseUnit("G")).toEqual({ canonical: "g", category: "mass" }));
  it("KG (uppercase) → kg/mass", () => expect(normaliseUnit("KG")).toEqual({ canonical: "kg", category: "mass" }));
  it("ML (uppercase) → ml/volume", () => expect(normaliseUnit("ML")).toEqual({ canonical: "ml", category: "volume" }));
  it("  g  (surrounding spaces) → g/mass", () => expect(normaliseUnit("  g  ")).toEqual({ canonical: "g", category: "mass" }));
  it("Grams (mixed case) → g/mass", () => expect(normaliseUnit("Grams")).toEqual({ canonical: "g", category: "mass" }));
});
