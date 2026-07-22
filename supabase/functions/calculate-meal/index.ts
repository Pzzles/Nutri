// calculate-meal
// Pure Nutrition Engine function. Takes resolved food matches + quantities,
// returns calculated nutrition. No persistence happens here — see log-meal.
// See docs/02-prs.md FR-020 and docs/04-system-architecture.md → Layer 3.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { computeMealConfidence } from "../_shared/confidence.ts";
import { ResolvedFoodItem, CalculatedItem } from "../_shared/types.ts";
import { normaliseUnit } from "../_shared/portionUnits.ts";

const FORBIDDEN_KEYS = ["calories", "protein_g", "carbs_g", "fat_g", "fibre_g"];

// A portion above this in grams requires user confirmation before logging.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);
    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);

    const body = await req.json().catch(() => ({}));
    const items: ResolvedFoodItem[] = body?.resolved_items ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return fail("VALIDATION_ERROR", "resolved_items must be a non-empty array");
    }

    // Defense-in-depth: this function must never trust caller-supplied
    // nutrition values, only food_id + quantity (FR-002 AC4).
    for (const item of items as any[]) {
      if (FORBIDDEN_KEYS.some((k) => k in item)) {
        return fail("VALIDATION_ERROR", "resolved_items must not include nutrition values");
      }
      if (!item.food_id) {
        return fail("VALIDATION_ERROR", "every resolved item must have a food_id — unresolved items belong in clarification_required");
      }
    }

    const service = getServiceClient();
    const foodIds = [...new Set(items.map((i) => i.food_id))];

    const [foodsResult, portionsResult] = await Promise.all([
      service
        .from("foods")
        .select("id, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, source, serving_size_g")
        .in("id", foodIds),
      service
        .from("user_food_portions")
        .select("food_id, usual_g, use_count")
        .eq("user_id", userData.user.id)
        .in("food_id", foodIds),
    ]);

    if (foodsResult.error) return fail("INTERNAL_ERROR", "Failed to load food data", 500);

    interface FoodRow {
      id: string;
      calories_100g: number;
      protein_100g: number;
      carbs_100g: number;
      fat_100g: number;
      fibre_100g: number | null;
      source: string;
      serving_size_g: number | null;
    }

    interface PortionRow { food_id: string; usual_g: number; use_count: number; }

    const foodMap = new Map<string, FoodRow>((foodsResult.data ?? []).map((f: FoodRow) => [f.id, f]));
    const portionMap = new Map<string, PortionRow>((portionsResult.data ?? []).map((p: PortionRow) => [p.food_id, p]));

    const calculated: CalculatedItem[] = [];
    const portionClarifications: Array<{ raw_phrase: string } & PortionClarification> = [];
    const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };

    for (const item of items) {
      const food = foodMap.get(item.food_id!);
      if (!food) return fail("FOOD_NOT_FOUND", `Food ${item.food_id} not found`, 404);

      const history = portionMap.get(item.food_id!) ?? null;
      const resolution = resolveWeightGrams(item, food.serving_size_g, history);

      if (resolution.kind === "clarification") {
        portionClarifications.push({ raw_phrase: item.raw_phrase, ...resolution.clarification });
        continue;
      }

      const { grams: weightG, source: portionSource } = resolution;
      const factor = weightG / 100;

      const calc: CalculatedItem = {
        ...item,
        calories: round(food.calories_100g * factor),
        protein_g: round(food.protein_100g * factor),
        carbs_g: round(food.carbs_100g * factor),
        fat_g: round(food.fat_100g * factor),
        fibre_g: food.fibre_100g != null ? round(food.fibre_100g * factor) : null,
        nutrition_source: food.source,
        portion_g: weightG,
        portion_source: portionSource,
        history_use_count: portionSource === "history" ? (history?.use_count ?? null) : null,
      };
      calculated.push(calc);

      totals.calories += calc.calories;
      totals.protein_g += calc.protein_g;
      totals.carbs_g += calc.carbs_g;
      totals.fat_g += calc.fat_g;
      totals.fibre_g += calc.fibre_g ?? 0;
    }

    // FR-020 AC2: meal confidence = strict minimum of item confidences.
    // Clarification items are excluded — they don't contribute to the meal.
    const mealConfidence = computeMealConfidence(calculated.map((i) => i.item_confidence));

    return ok({
      items: calculated,
      clarification_required: portionClarifications,
      meal_totals: {
        calories: round(totals.calories),
        protein_g: round(totals.protein_g),
        carbs_g: round(totals.carbs_g),
        fat_g: round(totals.fat_g),
        fibre_g: round(totals.fibre_g),
      },
      meal_confidence: mealConfidence,
    });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error calculating meal", 500);
  }
});

function resolveWeightGrams(
  item: ResolvedFoodItem,
  defaultServingG: number | null,
  history: { usual_g: number; use_count: number } | null,
): WeightResolution {
  const qty = item.quantity;
  const rawUnit = item.unit != null ? item.unit.trim().toLowerCase() : null;

  if (qty != null) {
    if (rawUnit !== null) {
      const normUnit = normaliseUnit(rawUnit);

      if (normUnit === null) {
        // Quantity given with an unrecognised unit — never fall back to serving
        // multiplication, as that would silently produce nonsense.
        // (This was the root cause of the 150mg → 41 700g bug.)
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
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };

        case "g":
          grams = qty;
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };

        case "kg":
          grams = qty * 1000;
          return checkExtreme(grams, item.unit) ?? { kind: "ok", grams, source: "explicit" };

        // ml → g uses a 1:1 density approximation, valid for aqueous foods.
        // Dense liquids (oil ≈ 0.92, fruit juice ≈ 1.04) deviate by ≤ ~20 %.
        // A food-specific density lookup should replace this when available.
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
          // Count unit but no serving size known — fall through to history/default.
          break;
      }
    } else {
      // No unit given — treat as a serving count when a serving size is available.
      // Extreme check still applies (e.g. "150 oatmeal" × 278 g = 41 700 g → EXTREME_PORTION).
      if (defaultServingG != null) {
        const grams = qty * defaultServingG;
        const extreme = checkExtreme(grams, null);
        if (extreme) return extreme;
        return { kind: "ok", grams, source: "explicit" };
      }
      // No unit, no serving size — fall through to history/default.
    }
  }

  // No usable (qty, unit) combination — consult the user's logged history
  // for this food, then fall back to one serving or 100 g.
  if (history != null) return { kind: "ok", grams: history.usual_g, source: "history" };
  return { kind: "ok", grams: defaultServingG ?? 100, source: "default" };
}

function checkExtreme(grams: number, rawUnit: string | null): WeightResolution | null {
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
  if (grams > EXTREME_PORTION_THRESHOLD_G) {
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

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
