// end-goal-phase
// Terminates an active goal phase by setting status to 'completed' or
// 'cancelled'. The phase is identified by phase_id (explicit) or by the
// user's current active phase (default).
//
// Completed and cancelled phases are preserved in history — they are never
// deleted. Only the active phase may be ended; calling on an already-ended
// phase returns 409.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

interface EndPhaseBody {
  phase_id?: string;
  outcome: "completed" | "cancelled";
  ended_reason?: string;
  ended_at?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body: EndPhaseBody = await req.json().catch(() => ({}));

    if (!body.outcome || !["completed", "cancelled"].includes(body.outcome)) {
      return fail("VALIDATION_ERROR", "outcome must be 'completed' or 'cancelled'");
    }

    const endedAt = body.ended_at ? new Date(body.ended_at) : new Date();
    if (isNaN(endedAt.getTime())) {
      return fail("VALIDATION_ERROR", "ended_at must be a valid ISO timestamp");
    }

    const service = getServiceClient();

    // Resolve target phase.
    let phaseId = body.phase_id;
    if (!phaseId) {
      const { data: activePhase } = await service
        .from("goal_phases")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (!activePhase) {
        return fail("NO_ACTIVE_PHASE", "No active goal phase found", 404);
      }
      phaseId = activePhase.id;
    }

    // Verify ownership and active status.
    const { data: existing } = await service
      .from("goal_phases")
      .select("id, user_id, status, started_at")
      .eq("id", phaseId)
      .maybeSingle();

    if (!existing) return fail("NOT_FOUND", "Goal phase not found", 404);
    if (existing.user_id !== userId) return fail("FORBIDDEN", "Cannot end another user's phase", 403);
    if (existing.status !== "active") {
      return fail(
        "PHASE_NOT_ACTIVE",
        `Phase is already '${existing.status}' and cannot be ended again.`,
        409,
      );
    }

    if (endedAt < new Date(existing.started_at)) {
      return fail("VALIDATION_ERROR", "ended_at cannot be before the phase's started_at");
    }

    const { data: updated, error: updateErr } = await service
      .from("goal_phases")
      .update({
        status: body.outcome,
        ended_at: endedAt.toISOString(),
        ended_reason: body.ended_reason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", phaseId)
      .select("*")
      .single();

    if (updateErr) {
      console.error(updateErr);
      return fail("INTERNAL_ERROR", "Failed to end goal phase", 500);
    }

    return ok(updated);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error ending goal phase", 500);
  }
});
