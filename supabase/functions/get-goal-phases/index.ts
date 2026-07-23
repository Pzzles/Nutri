// get-goal-phases
// Returns the user's goal phase history, newest first.
// Query params:
//   status  — filter: 'active' | 'completed' | 'cancelled' | 'superseded' | omit for all
//   limit   — max rows, default 20, max 100
//   offset  — pagination offset, default 0
// Response: { active_phase: GoalPhase | null, phases: GoalPhase[], total_count: number }

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

const VALID_STATUSES = ["active", "completed", "cancelled", "superseded"] as const;

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
    const statusFilter = url.searchParams.get("status") ?? null;
    const limitParam = url.searchParams.get("limit") ?? "20";
    const offsetParam = url.searchParams.get("offset") ?? "0";

    if (statusFilter && !VALID_STATUSES.includes(statusFilter as typeof VALID_STATUSES[number])) {
      return fail(
        "VALIDATION_ERROR",
        `Invalid status '${statusFilter}'. Must be one of: ${VALID_STATUSES.join(", ")}`,
      );
    }

    const limit = Math.min(Math.max(1, parseInt(limitParam, 10) || 20), 100);
    const offset = Math.max(0, parseInt(offsetParam, 10) || 0);

    const service = getServiceClient();

    let query = service
      .from("goal_phases")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { data: phases, error: fetchErr, count } = await query;

    if (fetchErr) {
      console.error(fetchErr);
      return fail("INTERNAL_ERROR", "Failed to fetch goal phases", 500);
    }

    // Pull out the active phase separately for convenience (regardless of filter).
    const activePhase = phases?.find((p) => p.status === "active") ??
      (statusFilter === null || statusFilter === "active"
        ? null
        : await service
            .from("goal_phases")
            .select("*")
            .eq("user_id", userId)
            .eq("status", "active")
            .maybeSingle()
            .then(({ data }) => data));

    return ok({
      active_phase: activePhase ?? null,
      phases: phases ?? [],
      total_count: count ?? 0,
    });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error fetching goal phases", 500);
  }
});
