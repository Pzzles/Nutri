// edit-meal-item
// Changes the gram weight of a meal item, proportionally rescaling all nutrition.
// Implements the "replace row" strategy (ADR-001): the old row is deleted and a new
// one is inserted with the adjusted values. The change is recorded in meal_edit_log.
//
// POST body: { meal_id: uuid, item_id: uuid, weight_g: number }

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    if (!body.meal_id) return fail("VALIDATION_ERROR", "meal_id is required");
    if (!body.item_id) return fail("VALIDATION_ERROR", "item_id is required");

    const newWeightG = Number(body.weight_g);
    if (isNaN(newWeightG) || newWeightG <= 0) {
      return fail("VALIDATION_ERROR", "weight_g must be a positive number");
    }
    if (newWeightG > 5000) {
      return fail("VALIDATION_ERROR", "weight_g cannot exceed 5000g");
    }

    const service = getServiceClient();

    // Verify meal ownership.
    const { data: meal, error: mealErr } = await service
      .from("meals")
      .select("id, user_id")
      .eq("id", body.meal_id)
      .single();

    if (mealErr || !meal) return fail("NOT_FOUND", "Meal not found", 404);
    if (meal.user_id !== userId) return fail("FORBIDDEN", "Not your meal", 403);

    // Fetch the item to rescale.
    const { data: item, error: itemErr } = await service
      .from("meal_items")
      .select("*")
      .eq("id", body.item_id)
      .eq("meal_id", body.meal_id)
      .single();

    if (itemErr || !item) return fail("NOT_FOUND", "Item not found", 404);

    const oldWeightG = Number(item.weight_g);
    if (!oldWeightG || isNaN(oldWeightG)) {
      return fail("INTERNAL_ERROR", "Cannot rescale item with unknown original weight", 500);
    }

    const ratio = newWeightG / oldWeightG;
    const round1 = (n: number) => Math.round(n * 10) / 10;

    const replacement = {
      food_id: item.food_id,
      meal_id: item.meal_id,
      raw_phrases: item.raw_phrases,
      quantity: newWeightG,
      unit: "g",
      weight_g: newWeightG,
      calories: round1(Number(item.calories) * ratio),
      protein_g: round1(Number(item.protein_g) * ratio),
      carbs_g: round1(Number(item.carbs_g) * ratio),
      fat_g: round1(Number(item.fat_g) * ratio),
      fibre_g: item.fibre_g != null ? round1(Number(item.fibre_g) * ratio) : null,
      match_confidence: item.match_confidence,
      portion_confidence: "estimated" as const,
      confidence: item.confidence,
      nutrition_source: item.nutrition_source,
    };

    // Audit: record what changed.
    await service.from("meal_edit_log").insert({
      meal_id: body.meal_id,
      field_name: "item_weight_g",
      old_value: {
        item_id: item.id,
        weight_g: oldWeightG,
        calories: Number(item.calories),
        protein_g: Number(item.protein_g),
      },
      new_value: {
        weight_g: newWeightG,
        calories: replacement.calories,
        protein_g: replacement.protein_g,
      },
      edited_by: userId,
    });

    // Replace: delete old row, insert new.
    await service.from("meal_items").delete().eq("id", body.item_id);
    const { data: newItem, error: insertErr } = await service
      .from("meal_items")
      .insert(replacement)
      .select()
      .single();

    if (insertErr || !newItem) {
      console.error(insertErr);
      return fail("INTERNAL_ERROR", "Failed to save updated item", 500);
    }

    return ok(newItem);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error editing item", 500);
  }
});
