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
    const servingUnit = String(body.serving_unit).toLowerCase().trim();

    // Gram equivalent of one serving — used for portion resolution (e.g. "2 slices").
    // For gram/ml units, it equals servingSize. For count-based units (slice, piece, cup…)
    // the caller must supply gram_per_serving so the engine can convert without asking
    // the user every time they log.
    const gramPerServing: number | null =
      servingUnit === "g" ? servingSize
      : servingUnit === "ml" ? servingSize
      : body.gram_per_serving != null ? Number(body.gram_per_serving)
      : null;

    // Nutrition values arrive per-serving; normalize to per-100g for storage.
    // Use gramPerServing as the gram base when available; fall back to servingSize
    // (preserves behaviour for callers that don't supply gram_per_serving).
    const normBase = gramPerServing ?? servingSize;
    const factor = normBase > 0 ? 100 / normBase : 1;

    const { data: food, error: foodErr } = await service
      .from("foods")
      .insert({
        name: body.name,
        normalized_name: normalizedName,
        barcode: body.barcode ?? null,
        source: "user_manual",
        owner_user_id: userId,
        serving_size_g: gramPerServing,
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
