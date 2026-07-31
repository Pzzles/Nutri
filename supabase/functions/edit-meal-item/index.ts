// edit-meal-item
// Changes the gram weight of a meal item, proportionally rescaling all nutrition.
// Delegates to the fn_edit_meal_item RPC which performs the replacement and
// audit-log insert atomically in a single DB transaction (migration 0018).
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

    const { data, error } = await service.rpc("fn_edit_meal_item", {
      p_meal_id:      body.meal_id,
      p_item_id:      body.item_id,
      p_user_id:      userId,
      p_new_weight_g: newWeightG,
    });

    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("FORBIDDEN"))      return fail("FORBIDDEN",       "Not your meal",                          403);
      if (msg.includes("NOT_FOUND"))      return fail("NOT_FOUND",       "Item not found",                         404);
      if (msg.includes("CANNOT_RESCALE")) return fail("INTERNAL_ERROR",  "Cannot rescale item with unknown weight", 500);
      console.error("[edit-meal-item]", error);
      return fail("INTERNAL_ERROR", "Failed to edit meal item", 500);
    }

    return ok(data);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error editing item", 500);
  }
});
