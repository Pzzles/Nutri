// get-meals
// Returns all logged meals for a calendar date, with items and food names.
// GET /functions/v1/get-meals?date=YYYY-MM-DD

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

    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return fail("VALIDATION_ERROR", "date parameter is required (YYYY-MM-DD)");
    }

    const service = getServiceClient();

    const { data: meals, error: mealsErr } = await service
      .from("meals")
      .select(`
        id, meal_type, eaten_at, meal_confidence,
        meal_items (
          id, food_id, quantity, unit, weight_g,
          calories, protein_g, carbs_g, fat_g, fibre_g,
          match_confidence, portion_confidence, confidence, nutrition_source,
          foods ( name, brand )
        )
      `)
      .eq("user_id", userId)
      .eq("logged_date", dateParam)
      .order("eaten_at", { ascending: true });

    if (mealsErr) {
      console.error(mealsErr);
      return fail("INTERNAL_ERROR", "Failed to fetch meals", 500);
    }

    const shaped = (meals ?? []).map((meal: any) => {
      const items = (meal.meal_items ?? []).map((item: any) => ({
        id: item.id,
        food_id: item.food_id,
        food_name: item.foods?.name ?? "Unknown food",
        brand: item.foods?.brand ?? null,
        quantity: item.quantity != null ? Number(item.quantity) : null,
        unit: item.unit ?? null,
        weight_g: item.weight_g != null ? Number(item.weight_g) : null,
        calories: Number(item.calories),
        protein_g: Number(item.protein_g),
        carbs_g: Number(item.carbs_g),
        fat_g: Number(item.fat_g),
        fibre_g: item.fibre_g != null ? Number(item.fibre_g) : null,
        confidence: item.confidence,
        match_confidence: item.match_confidence,
        portion_confidence: item.portion_confidence,
        nutrition_source: item.nutrition_source,
      }));

      const totals = items.reduce(
        (acc: any, it: any) => ({
          calories: acc.calories + it.calories,
          protein_g: acc.protein_g + it.protein_g,
          carbs_g: acc.carbs_g + it.carbs_g,
          fat_g: acc.fat_g + it.fat_g,
          fibre_g: acc.fibre_g + (it.fibre_g ?? 0),
        }),
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 },
      );

      return {
        id: meal.id,
        meal_type: meal.meal_type,
        eaten_at: meal.eaten_at,
        meal_confidence: meal.meal_confidence,
        items,
        totals,
      };
    });

    const day_totals = shaped.reduce(
      (acc: any, meal: any) => ({
        calories: acc.calories + meal.totals.calories,
        protein_g: acc.protein_g + meal.totals.protein_g,
        carbs_g: acc.carbs_g + meal.totals.carbs_g,
        fat_g: acc.fat_g + meal.totals.fat_g,
        fibre_g: acc.fibre_g + meal.totals.fibre_g,
      }),
      { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 },
    );

    return ok({ date: dateParam, meals: shaped, day_totals });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error fetching meals", 500);
  }
});
