// delete-meal
// Deletes a logged meal or a single item within a meal.
// POST body: { meal_id: uuid, item_id?: uuid }
// When item_id is supplied, only that item is removed (audit record written first).
// When omitted, the entire meal is hard-deleted (cascade removes items + edit log).

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

    const service = getServiceClient();

    // Verify meal belongs to the user before any mutation.
    const { data: meal, error: mealErr } = await service
      .from("meals")
      .select("id, user_id")
      .eq("id", body.meal_id)
      .single();

    if (mealErr || !meal) return fail("NOT_FOUND", "Meal not found", 404);
    if (meal.user_id !== userId) return fail("FORBIDDEN", "Not your meal", 403);

    if (body.item_id) {
      // Item deletion — snapshot to audit log first.
      const { data: item, error: itemErr } = await service
        .from("meal_items")
        .select("*")
        .eq("id", body.item_id)
        .eq("meal_id", body.meal_id)
        .single();

      if (itemErr || !item) return fail("NOT_FOUND", "Item not found", 404);

      await service.from("meal_edit_log").insert({
        meal_id: body.meal_id,
        field_name: "item_deleted",
        old_value: item,
        new_value: null,
        edited_by: userId,
      });

      const { error: delErr } = await service
        .from("meal_items")
        .delete()
        .eq("id", body.item_id);

      if (delErr) {
        console.error(delErr);
        return fail("INTERNAL_ERROR", "Failed to delete item", 500);
      }

      return ok({ deleted: "item", item_id: body.item_id });
    }

    // Meal deletion — hard delete (cascade removes items and edit log).
    const { error: delErr } = await service
      .from("meals")
      .delete()
      .eq("id", body.meal_id);

    if (delErr) {
      console.error(delErr);
      return fail("INTERNAL_ERROR", "Failed to delete meal", 500);
    }

    return ok({ deleted: "meal", meal_id: body.meal_id });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error", 500);
  }
});
