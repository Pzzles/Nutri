// edit-meal
// Mutates a logged meal in place and records every change in
// meal_edit_log (ADR-001 — no versioning). This function operates ONLY on
// logged instances — it never touches saved_meals/saved_meal_items, which
// is precisely why editing a re-logged saved meal never affects the
// template (ADR-004).
// See docs/02-prs.md FR-032 AC3/AC4, FR-040 AC2.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

// Meal-level fields editable via this function. Editing meal_item values
// (e.g. quantity) would require re-running calculate-meal to refresh
// confidence/totals — left as a TODO for a follow-up pass rather than
// half-implemented here.
const EDITABLE_MEAL_FIELDS = ["meal_type", "eaten_at"];

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
    const { meal_id, changes } = body;
    if (!meal_id || !Array.isArray(changes) || changes.length === 0) {
      return fail("VALIDATION_ERROR", "meal_id and a non-empty changes array are required");
    }

    const service = getServiceClient();
    const { data: meal, error: fetchErr } = await service
      .from("meals")
      .select("*")
      .eq("id", meal_id)
      .eq("user_id", userId)
      .single();
    if (fetchErr || !meal) return fail("MEAL_NOT_FOUND", "Meal not found", 404);

    const updatePayload: Record<string, unknown> = {};
    for (const change of changes) {
      if (!EDITABLE_MEAL_FIELDS.includes(change.field_name)) {
        return fail(
          "VALIDATION_ERROR",
          `Field ${change.field_name} is not editable via edit-meal. Meal-item level edits (quantity, unit) aren't implemented in this scaffold yet.`,
        );
      }
      updatePayload[change.field_name] = change.new_value;
    }

    const { error: updateErr } = await service.from("meals").update(updatePayload).eq("id", meal_id);
    if (updateErr) return fail("INTERNAL_ERROR", "Failed to update meal", 500);

    const logRows = changes.map((c: any) => ({
      meal_id,
      field_name: c.field_name,
      old_value: (meal as any)[c.field_name] ?? null,
      new_value: c.new_value,
      edited_by: userId,
    }));
    const { error: logErr } = await service.from("meal_edit_log").insert(logRows);
    if (logErr) console.error("Failed to write meal_edit_log:", logErr);

    return ok({ meal_id });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error editing meal", 500);
  }
});
