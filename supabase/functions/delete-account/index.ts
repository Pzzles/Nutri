// delete-account
// Authenticated DELETE (or POST) endpoint. Permanently deletes the calling
// user's account and all associated personal data.
//
// The caller must supply { confirm: "DELETE MY ACCOUNT" } in the request body
// to prevent accidental deletion.
//
// Deletion is performed via the service-role client (bypassing RLS) so that
// all rows are removed atomically before the auth user is deleted.
// Data deleted:
//   goal_feedback_assessments, calorie_target_snapshots,
//   goal_phases, meal_items (via meals FK cascade), meals,
//   daily_log_status, weight_logs, user_food_cache,
//   foods (user-owned), profiles
// Finally: auth.users row is deleted via admin API.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  if (req.method !== "POST" && req.method !== "DELETE") {
    return fail("METHOD_NOT_ALLOWED", "Use POST or DELETE to delete your account", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body: Record<string, unknown> = await req.json().catch(() => ({}));
    if (body["confirm"] !== "DELETE MY ACCOUNT") {
      return fail(
        "CONFIRMATION_REQUIRED",
        'Supply { "confirm": "DELETE MY ACCOUNT" } to confirm permanent deletion.',
        400,
      );
    }

    const svc = getServiceClient();

    // Delete in dependency order to avoid FK violations.
    // meal_items are deleted via ON DELETE CASCADE from meals.
    await svc.from("goal_feedback_assessments").delete().eq("user_id", userId);
    await svc.from("calorie_target_snapshots").delete().eq("user_id", userId);
    await svc.from("goal_phases").delete().eq("user_id", userId);
    await svc.from("meals").delete().eq("user_id", userId); // cascades meal_items
    await svc.from("daily_log_status").delete().eq("user_id", userId);
    await svc.from("weight_logs").delete().eq("user_id", userId);
    await svc.from("user_food_cache").delete().eq("user_id", userId);
    await svc.from("foods").delete().eq("owner_user_id", userId);
    await svc.from("profiles").delete().eq("id", userId);

    // Delete auth user last (service role admin delete).
    const { error: authErr } = await svc.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error("Failed to delete auth user:", authErr);
      return fail("INTERNAL_ERROR", "Data deleted but auth account removal failed.", 500);
    }

    return ok({ deleted: true, user_id: userId });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error during account deletion", 500);
  }
});
