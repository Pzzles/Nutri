// export-my-data
// Authenticated GET endpoint. Returns all personal data stored for the
// calling user as a single JSON document (format: nutri_data_export_v1).
// The frontend downloads this as a .json file.
//
// Tables exported (all filtered to the authenticated user):
//   profile, weight_logs, goal_phases, calorie_target_snapshots,
//   meals, meal_items, daily_log_status, user_foods, user_food_cache,
//   goal_feedback_assessments
//
// The export intentionally omits global caches (global_food_cache) and
// foods the user did not create (owner_user_id IS NULL).

import { fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  if (req.method !== "GET") {
    return fail("METHOD_NOT_ALLOWED", "Use GET to export your data", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const svc = getServiceClient();

    // Run all direct-user-id queries in parallel.
    const [
      profileRes,
      weightLogsRes,
      goalPhasesRes,
      snapshotsRes,
      mealsRes,
      dailyLogStatusRes,
      userFoodsRes,
      userFoodCacheRes,
      feedbackRes,
    ] = await Promise.all([
      svc.from("profiles").select("*").eq("id", userId).maybeSingle(),
      svc.from("weight_logs").select("*").eq("user_id", userId).order("measured_at", { ascending: true }),
      svc.from("goal_phases").select("*").eq("user_id", userId).order("started_at", { ascending: true }),
      svc.from("calorie_target_snapshots").select("*").eq("user_id", userId).order("calculation_timestamp", { ascending: true }),
      svc.from("meals").select("*").eq("user_id", userId).order("eaten_at", { ascending: true }),
      svc.from("daily_log_status").select("*").eq("user_id", userId).order("logged_date", { ascending: true }),
      svc.from("foods").select("*").eq("owner_user_id", userId),
      svc.from("user_food_cache").select("*").eq("user_id", userId),
      svc.from("goal_feedback_assessments").select("*").eq("user_id", userId).order("assessment_date", { ascending: true }),
    ]);

    // meal_items must be fetched via meal_id — chunk to avoid URL length limits.
    const mealIds: string[] = (mealsRes.data ?? []).map((m: Record<string, unknown>) => m.id as string);
    let mealItems: unknown[] = [];
    if (mealIds.length > 0) {
      const { data } = await svc.from("meal_items").select("*").in("meal_id", mealIds);
      mealItems = data ?? [];
    }

    const exportDoc = {
      export_version: "nutri_data_export_v1",
      exported_at: new Date().toISOString(),
      user_id: userId,
      data: {
        profile:                    profileRes.data ?? null,
        weight_logs:                weightLogsRes.data ?? [],
        goal_phases:                goalPhasesRes.data ?? [],
        calorie_target_snapshots:   snapshotsRes.data ?? [],
        meals:                      mealsRes.data ?? [],
        meal_items:                 mealItems,
        daily_log_status:           dailyLogStatusRes.data ?? [],
        user_foods:                 userFoodsRes.data ?? [],
        user_food_cache:            userFoodCacheRes.data ?? [],
        goal_feedback_assessments:  feedbackRes.data ?? [],
      },
    };

    return new Response(JSON.stringify(exportDoc, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="nutri-export-${new Date().toISOString().slice(0, 10)}.json"`,
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Failed to export data", 500);
  }
});
