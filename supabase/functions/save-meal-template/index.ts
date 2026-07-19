// save-meal-template
// Create/rename/favourite/archive reusable meal templates. Per ADR-004,
// this is the ONLY path by which a template changes — log-meal and
// edit-meal must never write to saved_meals/saved_meal_items. Per ADR-006,
// templates never store nutrition totals; those are always computed fresh
// on read from current food data.
// See docs/02-prs.md FR-032, FR-072.

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
    const { action } = body;
    const service = getServiceClient();

    if (action === "create") {
      const { name, items } = body;
      if (!name || !Array.isArray(items) || items.length === 0) {
        return fail("VALIDATION_ERROR", "name and a non-empty items array are required");
      }
      const { data: saved, error } = await service
        .from("saved_meals")
        .insert({ user_id: userId, name, description: body.description ?? null })
        .select("id")
        .single();
      if (error) return fail("INTERNAL_ERROR", "Failed to create saved meal", 500);

      const itemRows = items.map((i: any) => ({
        saved_meal_id: saved.id,
        food_id: i.food_id,
        default_quantity: i.quantity,
        default_unit: i.unit,
      }));
      const { error: itemsErr } = await service.from("saved_meal_items").insert(itemRows);
      if (itemsErr) {
        console.error(itemsErr);
        return fail("INTERNAL_ERROR", "Failed to save meal items", 500);
      }

      return ok({ saved_meal_id: saved.id });
    }

    if (["rename", "favourite", "archive"].includes(action)) {
      const { saved_meal_id } = body;
      if (!saved_meal_id) return fail("VALIDATION_ERROR", "saved_meal_id is required");

      const patch: Record<string, unknown> =
        action === "rename" ? { name: body.name }
        : action === "favourite" ? { is_favorite: body.is_favorite ?? true }
        : { status: "archived" };

      const { error } = await service
        .from("saved_meals")
        .update(patch)
        .eq("id", saved_meal_id)
        .eq("user_id", userId);
      if (error) return fail("INTERNAL_ERROR", `Failed to ${action} saved meal`, 500);
      return ok({ saved_meal_id });
    }

    return fail("VALIDATION_ERROR", "Unknown action — expected create|rename|favourite|archive");
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error managing saved meal template", 500);
  }
});
