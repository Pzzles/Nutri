// Canonical portion-unit normalisation for the Nutrition Engine.
// Separate from units.ts, which handles duplicate-merge compatibility.
// This module is pure (no I/O) so it can be unit-tested in isolation.

export type CanonicalUnit = "mg" | "g" | "kg" | "ml" | "l" | "count";
export type UnitCategory = "mass" | "volume" | "count";

export interface NormalisedUnit {
  canonical: CanonicalUnit;
  category: UnitCategory;
}

// Exhaustive map of lower-cased, trimmed raw unit strings → canonical form.
// Only explicitly listed strings are recognised; any other string returns null
// so the caller can surface a structured clarification rather than guessing.
const UNIT_MAP: Record<string, NormalisedUnit> = {
  // milligrams
  mg: { canonical: "mg", category: "mass" },
  milligram: { canonical: "mg", category: "mass" },
  milligrams: { canonical: "mg", category: "mass" },
  // grams
  g: { canonical: "g", category: "mass" },
  gram: { canonical: "g", category: "mass" },
  grams: { canonical: "g", category: "mass" },
  // kilograms
  kg: { canonical: "kg", category: "mass" },
  kilogram: { canonical: "kg", category: "mass" },
  kilograms: { canonical: "kg", category: "mass" },
  // millilitres
  ml: { canonical: "ml", category: "volume" },
  millilitre: { canonical: "ml", category: "volume" },
  millilitres: { canonical: "ml", category: "volume" },
  milliliter: { canonical: "ml", category: "volume" },
  milliliters: { canonical: "ml", category: "volume" },
  // litres
  l: { canonical: "l", category: "volume" },
  litre: { canonical: "l", category: "volume" },
  litres: { canonical: "l", category: "volume" },
  liter: { canonical: "l", category: "volume" },
  liters: { canonical: "l", category: "volume" },
  // count / serving units
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

/**
 * Normalise a raw unit string to a canonical form.
 *
 * Returns null when raw is null/empty (no unit given) OR when the string is
 * not in the table (unrecognised unit). Callers MUST treat null as "unknown"
 * and never assume any default behaviour — specifically, they must not fall
 * back to serving-size multiplication for an unrecognised unit.
 */
export function normaliseUnit(raw: string | null | undefined): NormalisedUnit | null {
  if (raw == null || raw.trim() === "") return null;
  return UNIT_MAP[raw.trim().toLowerCase()] ?? null;
}
