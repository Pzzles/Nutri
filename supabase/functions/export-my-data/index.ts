// export-my-data
// Authenticated GET endpoint. Returns all personal data stored for the
// calling user as a single JSON document (format: nutri_data_export_v3).
// The frontend downloads this as a .json file.
//
// Tables exported (all filtered to the authenticated user):
//   profile, weight_logs, goal_phases, calorie_target_snapshots,
//   meals, meal_items, daily_log_status, user_foods, user_food_cache,
//   goal_feedback_assessments, anthropometric_sessions,
//   anthropometric_readings, anthropometric_representatives
//
// The export intentionally omits global caches (global_food_cache) and
// foods the user did not create (owner_user_id IS NULL).

import { fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { contextFromRow } from "../_shared/anthropometryContext.ts";
import {
  ANTHROPOMETRY_CHANGE_VERSION,
  ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
  ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
  ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
} from "../_shared/anthropometryProgress.ts";

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
      anthropometricSessionsRes,
    ] = await Promise.all([
      svc.from("profiles").select("*").eq("id", userId).maybeSingle(),
      svc.from("weight_logs").select("*").eq("user_id", userId).order("measured_at", { ascending: true }),
      svc.from("goal_phases").select("*").eq("user_id", userId).order("started_at", { ascending: true }),
      svc.from("calorie_target_snapshots").select("*").eq("user_id", userId).order("calculation_timestamp", { ascending: true }),
      svc.from("meals").select("*").eq("user_id", userId).order("eaten_at", { ascending: true }),
      svc.from("daily_log_status").select("*").eq("user_id", userId).order("logged_date", { ascending: true }),
      svc.from("foods").select("*").eq("owner_user_id", userId),
      svc.from("user_food_cache").select("*").eq("user_id", userId),
      svc.from("goal_feedback_assessments").select("*").eq("user_id", userId).order("assessed_at", { ascending: true }),
      svc.from("anthropometric_sessions").select("*").eq("user_id", userId)
        .order("measured_at", { ascending: true, nullsFirst: true })
        .order("id", { ascending: true }),
    ]);
    const directQueryError = [
      profileRes, weightLogsRes, goalPhasesRes, snapshotsRes, mealsRes,
      dailyLogStatusRes, userFoodsRes, userFoodCacheRes, feedbackRes,
      anthropometricSessionsRes,
    ].find((result) => result.error)?.error;
    if (directQueryError) throw new Error("EXPORT_QUERY_FAILED");

    // meal_items must be fetched via meal_id — chunk to avoid URL length limits.
    const mealIds: string[] = (mealsRes.data ?? []).map((m: Record<string, unknown>) => m.id as string);
    let mealItems: unknown[] = [];
    if (mealIds.length > 0) {
      const { data, error } = await svc.from("meal_items").select("*").in("meal_id", mealIds);
      if (error) throw new Error("EXPORT_QUERY_FAILED");
      mealItems = data ?? [];
    }

    const anthropometricSessionIds: string[] = (anthropometricSessionsRes.data ?? [])
      .map((session: Record<string, unknown>) => session.id as string);
    let anthropometricReadings: unknown[] = [];
    let anthropometricRepresentatives: unknown[] = [];
    if (anthropometricSessionIds.length > 0) {
      const [readingsRes, representativesRes] = await Promise.all([
        svc.from("anthropometric_readings").select("*")
          .eq("user_id", userId)
          .in("session_id", anthropometricSessionIds)
          .order("session_id").order("site_code").order("reading_number"),
        svc.from("anthropometric_representatives").select("*")
          .eq("user_id", userId)
          .in("session_id", anthropometricSessionIds)
          .order("session_id").order("site_code"),
      ]);
      if (readingsRes.error || representativesRes.error) {
        throw new Error("EXPORT_QUERY_FAILED");
      }
      anthropometricReadings = readingsRes.data ?? [];
      anthropometricRepresentatives = representativesRes.data ?? [];
    }

    const anthropometricSessions = (anthropometricSessionsRes.data ?? []).map(
      (row: Record<string, unknown>) => ({ ...row, measurement_context: contextFromRow(row) }),
    );
    const exportDoc = {
      export_version: "nutri_data_export_v3",
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
        anthropometric_sessions:    anthropometricSessions,
        anthropometric_readings:    anthropometricReadings,
        anthropometric_representatives: anthropometricRepresentatives,
      },
      anthropometry_provenance: {
        change_summary_version: ANTHROPOMETRY_CHANGE_VERSION,
        context_comparison_version: ANTHROPOMETRY_CONTEXT_COMPARISON_VERSION,
        protocol_compatibility_version: ANTHROPOMETRY_PROTOCOL_COMPATIBILITY_VERSION,
        weight_comparison_version: ANTHROPOMETRY_WEIGHT_COMPARISON_VERSION,
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
  } catch (_err) {
    console.error(JSON.stringify({
      event: "data_export_failed",
      error_code: "EXPORT_FAILED",
    }));
    return fail("INTERNAL_ERROR", "Failed to export data", 500);
  }
});
