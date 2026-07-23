// calculate-meal
// Pure Nutrition Engine function. Takes resolved food matches + quantities,
// returns calculated nutrition. No persistence happens here — see log-meal.
// See docs/02-prs.md FR-020 and docs/04-system-architecture.md → Layer 3.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { computeMealConfidence } from "../_shared/confidence.ts";
import { ResolvedFoodItem, CalculatedItem } from "../_shared/types.ts";
import {
  resolveWeightGrams,
  PortionClarification,
  EXTREME_PORTION_THRESHOLD_G,
} from "../_shared/portionResolution.ts";

const FORBIDDEN_KEYS = ["calories", "protein_g", "carbs_g", "fat_g", "fibre_g"];

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

    // food_ids whose extreme portions the user has explicitly confirmed
    const extremeConfirmedIds = new Set<string>(body.extreme_confirmed_ids ?? []);

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
    const portionClarifications: Array<{ raw_phrase: string; food_id: string } & PortionClarification> = [];
    const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };

    for (const item of items) {
      const food = foodMap.get(item.food_id!);
      if (!food) return fail("FOOD_NOT_FOUND", `Food ${item.food_id} not found`, 404);

      const history = portionMap.get(item.food_id!) ?? null;
      const resolution = resolveWeightGrams(
        {
          quantity: item.quantity,
          unit: item.unit,
          extreme_confirmed: extremeConfirmedIds.has(item.food_id!),
        },
        food.serving_size_g,
        history,
      );

      if (resolution.kind === "clarification") {
        portionClarifications.push({
          raw_phrase: item.raw_phrase,
          food_id: item.food_id!,
          ...resolution.clarification,
        });
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

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
