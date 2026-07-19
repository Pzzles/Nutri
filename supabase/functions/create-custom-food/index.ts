// create-custom-food
// Creates a fully custom food. Per ADR-007, this always writes TWO rows —
// `foods` (the canonical nutrition definition) and `user_saved_foods` (the
// user's nickname/default serving) — never one conflated table.
// See docs/02-prs.md FR-013.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

const REQUIRED_FIELDS = ["name", "serving_size", "serving_unit", "calories", "protein_g", "carbs_g", "fat_g"];
const NUMERIC_FIELDS = ["calories", "protein_g", "carbs_g", "fat_g", "fibre_g"];

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

    for (const field of REQUIRED_FIELDS) {
      if (body?.[field] === undefined || body?.[field] === null || body?.[field] === "") {
        return fail("VALIDATION_ERROR", `${field} is required`);
      }
    }
    for (const field of NUMERIC_FIELDS) {
      if (body[field] != null && Number(body[field]) < 0) {
        return fail("VALIDATION_ERROR", `${field} must be >= 0`);
      }
    }

    const service = getServiceClient();
    const normalizedName = String(body.name).trim().toLowerCase();
    const servingSize = Number(body.serving_size);
    // Nutrition values arrive per-serving; normalize to per-100g for storage,
    // since `foods` always stores canonical per-100g values.
    const factor = servingSize > 0 ? 100 / servingSize : 1;

    const { data: food, error: foodErr } = await service
      .from("foods")
      .insert({
        name: body.name,
        normalized_name: normalizedName,
        barcode: body.barcode ?? null,
        source: "user_manual",
        owner_user_id: userId,
        serving_size_g: body.serving_unit === "g" ? servingSize : null,
        calories_100g: Number(body.calories) * factor,
        protein_100g: Number(body.protein_g) * factor,
        carbs_100g: Number(body.carbs_g) * factor,
        fat_100g: Number(body.fat_g) * factor,
        fibre_100g: body.fibre_g != null ? Number(body.fibre_g) * factor : null,
        verified: false,
      })
      .select("id")
      .single();
    if (foodErr) {
      console.error(foodErr);
      return fail("INTERNAL_ERROR", "Failed to create food", 500);
    }

    const { error: savedErr } = await service.from("user_saved_foods").insert({
      user_id: userId,
      food_id: food.id,
      nickname: body.nickname ?? null,
      default_serving_size: servingSize,
      default_serving_unit: body.serving_unit,
    });
    if (savedErr) console.error("Failed to create user_saved_foods row:", savedErr);

    // FR-013: manual entries are always forced to low confidence — this
    // food can never produce a match_confidence 'exact' result downstream
    // beyond the fact that the user themselves defined it.
    return ok({ food_id: food.id, confidence: "low" });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error creating custom food", 500);
  }
});
