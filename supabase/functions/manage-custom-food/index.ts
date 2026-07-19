// manage-custom-food
// Update, archive (never hard-delete), or duplicate a user-owned food.
// See docs/02-prs.md FR-070.

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
    const { food_id, action, changes } = body;
    if (!food_id || !["update", "archive", "duplicate"].includes(action)) {
      return fail("VALIDATION_ERROR", "food_id and a valid action (update|archive|duplicate) are required");
    }

    const service = getServiceClient();
    const { data: food, error: fetchErr } = await service
      .from("foods")
      .select("*")
      .eq("id", food_id)
      .eq("owner_user_id", userId)
      .single();
    if (fetchErr || !food) return fail("FOOD_NOT_FOUND", "Food not found or not owned by this user", 404);

    if (action === "update") {
      const MUTABLE_FIELDS = new Set([
        "name", "normalized_name", "brand", "barcode",
        "serving_size_g", "calories_100g", "protein_100g",
        "carbs_100g", "fat_100g", "fibre_100g",
      ]);
      const sanitized = Object.fromEntries(
        Object.entries(changes ?? {}).filter(([k]) => MUTABLE_FIELDS.has(k)),
      );
      if (Object.keys(sanitized).length === 0) {
        return fail("VALIDATION_ERROR", "No mutable fields provided");
      }
      const { error } = await service.from("foods").update(sanitized).eq("id", food_id);
      if (error) return fail("INTERNAL_ERROR", "Failed to update food", 500);
      return ok({ food_id });
    }

    if (action === "archive") {
      // FR-070 AC1: archived foods stay resolvable in HISTORICAL meal_items
      // (their snapshot is untouched), but drop out of new-lookup tiers 1-2
      // and out of search results, via the status='active' filters already
      // present in resolve-foods and search-food.
      const { error } = await service
        .from("foods")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", food_id);
      if (error) return fail("INTERNAL_ERROR", "Failed to archive food", 500);
      return ok({ food_id, status: "archived" });
    }

    // duplicate — FR-070 AC2.
    const { id, created_at, updated_at, ...rest } = food;
    const { data: copy, error: dupErr } = await service
      .from("foods")
      .insert({ ...rest, name: `${food.name} (copy)`, normalized_name: `${food.normalized_name} (copy)`, barcode: null })
      .select("id")
      .single();
    if (dupErr) {
      console.error(dupErr);
      return fail("INTERNAL_ERROR", "Failed to duplicate food", 500);
    }
    return ok({ food_id: copy.id });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error managing custom food", 500);
  }
});
