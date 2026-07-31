// save-meal-template
// Create/rename/favourite/archive reusable meal templates. Per ADR-004,
// this is the ONLY path by which a template changes — log-meal and
// edit-meal must never write to saved_meals/saved_meal_items. Per ADR-006,
// templates never store nutrition totals; those are always computed fresh
// on read from current food data.
// See docs/02-prs.md FR-032, FR-072.
//
// B3: The create action accepts an idempotency_key and delegates to the
// fn_save_meal_template RPC (migration 0017) which is atomic.
// Retrying the same key returns the original saved_meal_id.

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
      const { name, items, idempotency_key } = body;
      if (!name || !Array.isArray(items) || items.length === 0) {
        return fail("VALIDATION_ERROR", "name and a non-empty items array are required");
      }
      if (!idempotency_key) {
        return fail("VALIDATION_ERROR", "idempotency_key is required for template creation");
      }

      // Delegate to the atomic RPC (migration 0017).
      // ON CONFLICT DO NOTHING inside the function means concurrent duplicate
      // calls produce exactly one row — no TOCTOU race.
      const { data: savedId, error } = await service.rpc("fn_save_meal_template", {
        p_user_id:     userId,
        p_idem_key:    idempotency_key,
        p_name:        name,
        p_description: body.description ?? null,
        p_items:       items,
      });

      if (error) {
        console.error("[save-meal-template create]", error);
        return fail("INTERNAL_ERROR", "Failed to create saved meal template", 500);
      }

      return ok({ saved_meal_id: savedId });
    }

    if (action === "list") {
      const pageLimit = Math.min(Math.max(1, Number(body.limit) || 10), 50);
      const pageOffset = Math.max(0, Number(body.offset) || 0);

      const { data: templates, error: listErr, count } = await service
        .from("saved_meals")
        .select(`
          id, name, description, is_favorite, usage_count, last_used_at,
          saved_meal_items(
            id, food_id, default_quantity, default_unit,
            foods:food_id(name, normalized_name, calories_100g, protein_100g, carbs_100g, fat_100g, fibre_100g, serving_size_g)
          )
        `, { count: "exact" })
        .eq("user_id", userId)
        .eq("status", "active")
        .order("is_favorite", { ascending: false })
        .order("usage_count", { ascending: false })
        .range(pageOffset, pageOffset + pageLimit - 1);

      if (listErr) return fail("INTERNAL_ERROR", "Failed to list saved meals", 500);
      return ok({ templates: templates ?? [], total_count: count ?? 0 });
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
