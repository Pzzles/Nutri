// get-weight-logs
// Returns weight log entries for the authenticated user, newest first.
// Query params:
//   limit        — max rows, default 30, max 90
//   official_only — "true" to return only is_official=true rows (default false)
//   before_date  — YYYY-MM-DD: return rows where logged_date <= this date
//
// Response: { logs: WeightLog[], latest_official: WeightLog | null }
// latest_official is always the single most recent is_official=true entry,
// regardless of the limit/filter — used by dashboard and start-goal-phase UI.

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

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit") ?? "30";
    const officialOnly = url.searchParams.get("official_only") === "true";
    const beforeDate = url.searchParams.get("before_date");

    const limit = Math.min(Math.max(1, parseInt(limitParam, 10) || 30), 90);

    if (beforeDate && !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
      return fail("VALIDATION_ERROR", "before_date must be YYYY-MM-DD");
    }

    const service = getServiceClient();

    // Run main list and latest-official queries in parallel.
    let listQuery = service
      .from("weight_logs")
      .select("*")
      .eq("user_id", userId)
      .order("measured_at", { ascending: false })
      .limit(limit);

    if (officialOnly) listQuery = listQuery.eq("is_official", true);
    if (beforeDate) listQuery = listQuery.lte("logged_date", beforeDate);

    const [listResult, latestResult] = await Promise.all([
      listQuery,
      service
        .from("weight_logs")
        .select("*")
        .eq("user_id", userId)
        .eq("is_official", true)
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (listResult.error) {
      console.error(listResult.error);
      return fail("INTERNAL_ERROR", "Failed to fetch weight logs", 500);
    }

    return ok({
      logs: listResult.data ?? [],
      latest_official: latestResult.data ?? null,
    });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error fetching weight logs", 500);
  }
});
