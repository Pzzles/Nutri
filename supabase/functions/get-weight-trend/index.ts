// get-weight-trend
// Returns EWMA-smoothed weight trend and regression-based weekly rate for the
// authenticated user. Calculations are performed on demand from immutable
// weight_logs rows — no trend data is persisted.
//
// Query parameters:
//   official_only  (default true)  — use only is_official=true entries
//   window_days    (default 90)    — how many days of history to fetch

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { calculateWeightTrend, type WeightMeasurement } from "../_shared/weightTrend.ts";
import { TREND_FETCH_WINDOW_DAYS } from "../_shared/scienceConfig.ts";

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
    const windowDays = Math.min(
      parseInt(url.searchParams.get("window_days") ?? String(TREND_FETCH_WINDOW_DAYS), 10),
      365,
    );
    const officialOnly = url.searchParams.get("official_only") !== "false";

    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    const service = getServiceClient();
    let query = service
      .from("weight_logs")
      .select("id, weight_kg, measured_at, is_official")
      .eq("user_id", userId)
      .gte("measured_at", since)
      .order("measured_at", { ascending: true });

    if (officialOnly) query = query.eq("is_official", true);

    const { data: rows, error } = await query;
    if (error) {
      console.error(error);
      return fail("INTERNAL_ERROR", "Failed to fetch weight logs", 500);
    }

    const measurements: WeightMeasurement[] = (rows ?? []).map((r) => ({
      id: r.id,
      weight_kg: Number(r.weight_kg),
      measured_at: r.measured_at,
      is_official: r.is_official,
    }));

    const result = calculateWeightTrend(measurements);

    return ok(result);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error calculating weight trend", 500);
  }
});
