// Pure portion-resolution logic for the Nutrition Engine.
// No Supabase, Deno or network dependencies — safe to import in any test runner.
// Extracted from calculate-meal/index.ts so tests exercise the real production code.

import { normaliseUnit } from "./portionUnits.ts";

export type ClarificationCode =
  | "UNSUPPORTED_PORTION_UNIT"
  | "EXTREME_PORTION"
  | "LIKELY_UNIT_ERROR"
  | "MISSING_SERVING_SIZE";

export interface PortionClarification {
  code: ClarificationCode;
  raw_unit: string | null;
  message: string;
  suggested_unit?: string;
  suggested_qty?: number;
}

export type WeightResolution =
  | { kind: "ok"; grams: number; source: "explicit" | "history" | "default" }
  | { kind: "clarification"; clarification: PortionClarification };

// Grams above this threshold require explicit user confirmation before logging.
// Applies after conversion for all unit types (g, kg, ml, l, count × serving).
export const EXTREME_PORTION_THRESHOLD_G = 2000;

export interface PortionInput {
  quantity: number | null;
  unit: string | null;
  // Set to true after the user has explicitly confirmed an extreme portion.
  // EXTREME_PORTION is a confirmation state, not permanent rejection.
  extreme_confirmed?: boolean;
}

export function resolveWeightGrams(
  item: PortionInput,
  defaultServingG: number | null,
  history: { usual_g: number; use_count: number } | null,
): WeightResolution {
  const qty = item.quantity;
  const rawUnit = item.unit != null ? item.unit.trim().toLowerCase() : null;

  if (qty != null) {
    if (rawUnit !== null) {
      const normUnit = normaliseUnit(rawUnit);

      if (normUnit === null) {
        return {
          kind: "clarification",
          clarification: {
            code: "UNSUPPORTED_PORTION_UNIT",
            raw_unit: item.unit,
            message: `"${item.unit}" is not a recognised portion unit. Use g, kg, mg, ml, l, or a count word like "pieces" or "slices".`,
          },
        };
      }

      let grams: number;
      switch (normUnit.canonical) {
        case "mg":
          grams = qty / 1000;
          // Amounts under 1 g are implausible for a meal food — the user almost
          // certainly typed "mg" when they meant "g".
          if (grams < 1.0) {
            return {
              kind: "clarification",
              clarification: {
                code: "LIKELY_UNIT_ERROR",
                raw_unit: "mg",
                message: `Did you mean ${qty} g? ${qty} mg converts to ${grams.toFixed(2)} g — a very small amount for a meal item.`,
                suggested_unit: "g",
                suggested_qty: qty,
              },
            };
          }
          return checkExtreme(grams, item.unit, item.extreme_confirmed) ?? { kind: "ok", grams, source: "explicit" };

        case "g":
          grams = qty;
          return checkExtreme(grams, item.unit, item.extreme_confirmed) ?? { kind: "ok", grams, source: "explicit" };

        case "kg":
          grams = qty * 1000;
          return checkExtreme(grams, item.unit, item.extreme_confirmed) ?? { kind: "ok", grams, source: "explicit" };

        case "ml":
          // 1 ml ≈ 1 g (aqueous density approximation, accurate within ~20% for
          // most beverages and watery foods; not suitable for oils or dense liquids).
          grams = qty;
          return checkExtreme(grams, item.unit, item.extreme_confirmed) ?? { kind: "ok", grams, source: "explicit" };

        case "l":
          grams = qty * 1000;
          return checkExtreme(grams, item.unit, item.extreme_confirmed) ?? { kind: "ok", grams, source: "explicit" };

        case "count":
          if (defaultServingG != null) {
            grams = qty * defaultServingG;
            return checkExtreme(grams, item.unit, item.extreme_confirmed) ?? { kind: "ok", grams, source: "explicit" };
          }
          // Count unit given but no serving size — cannot convert without knowing
          // how many grams each piece weighs. Do NOT silently fall back to 100 g.
          return {
            kind: "clarification",
            clarification: {
              code: "MISSING_SERVING_SIZE",
              raw_unit: item.unit,
              message: `"${item.unit}" requires a known serving size for this food, but none is available. Please specify a weight instead (e.g. 120 g).`,
            },
          };
      }
    } else {
      // No unit — treat quantity as a serving multiplier when serving size is known.
      // Product decision: "2 oatmeal" without a unit means "2 servings of oatmeal"
      // only when serving_size_g is available from the food record.
      if (defaultServingG != null) {
        const grams = qty * defaultServingG;
        const extreme = checkExtreme(grams, null, item.extreme_confirmed);
        if (extreme) return extreme;
        return { kind: "ok", grams, source: "explicit" };
      }
      // Explicit quantity given with no unit and no serving size — check history
      // before giving up. History stores the user's usual total gram weight for this
      // food, which is more informative than an unanswerable arithmetic question.
      if (history != null) return { kind: "ok", grams: history.usual_g, source: "history" };
      // No history either — we cannot honour the explicit quantity.
      return {
        kind: "clarification",
        clarification: {
          code: "MISSING_SERVING_SIZE",
          raw_unit: null,
          message: "A quantity was given without a unit, and no serving size or portion history is available. Please specify a weight (e.g. 150 g).",
        },
      };
    }
  }

  // qty is null — no portion information at all. Use history, then serving size, then 100 g.
  if (history != null) return { kind: "ok", grams: history.usual_g, source: "history" };
  return { kind: "ok", grams: defaultServingG ?? 100, source: "default" };
}

export function checkExtreme(
  grams: number,
  rawUnit: string | null,
  confirmed = false,
): WeightResolution | null {
  if (!isFinite(grams) || grams <= 0) {
    return {
      kind: "clarification",
      clarification: {
        code: "EXTREME_PORTION",
        raw_unit: rawUnit,
        message: "The converted portion is zero or infinite — please check the quantity and unit.",
      },
    };
  }
  if (grams > EXTREME_PORTION_THRESHOLD_G && !confirmed) {
    return {
      kind: "clarification",
      clarification: {
        code: "EXTREME_PORTION",
        raw_unit: rawUnit,
        message: `${Math.round(grams)} g is above the ${EXTREME_PORTION_THRESHOLD_G} g per-item safety threshold. Please confirm or correct the quantity.`,
      },
    };
  }
  return null;
}
