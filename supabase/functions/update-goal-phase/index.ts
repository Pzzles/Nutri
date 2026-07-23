// update-goal-phase
// Mutates mutable fields on the ACTIVE phase only.
// Immutable fields (mode, started_at, starting_weight_*, superseded_by) are
// silently ignored so clients can send partial objects. Only the allowlisted
// fields below can be changed after phase creation.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

const MUTABLE_FIELDS = [
  "target_weight_kg",
  "target_change_kg_per_week",
  "target_calories",
  "target_protein_g",
  "target_carbs_g",
  "target_fat_g",
] as const;

type MutableField = (typeof MUTABLE_FIELDS)[number];

interface UpdatePhaseBody extends Partial<Record<MutableField, number | null>> {
  phase_id?: string;
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

    const body: UpdatePhaseBody = await req.json().catch(() => ({}));
    const service = getServiceClient();

    // Resolve the phase to update.
    let phaseId = body.phase_id;
    if (!phaseId) {
      // Default to the user's active phase.
      const { data: activePhase } = await service
        .from("goal_phases")
        .select("id")
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (!activePhase) {
        return fail("NO_ACTIVE_PHASE", "No active goal phase found. Start a phase first.", 404);
      }
      phaseId = activePhase.id;
    }

    // Verify ownership and that the phase is active.
    const { data: existing } = await service
      .from("goal_phases")
      .select("id, user_id, status")
      .eq("id", phaseId)
      .maybeSingle();

    if (!existing) return fail("NOT_FOUND", "Goal phase not found", 404);
    if (existing.user_id !== userId) return fail("FORBIDDEN", "Cannot modify another user's phase", 403);
    if (existing.status !== "active") {
      return fail(
        "PHASE_NOT_ACTIVE",
        `Cannot update a phase with status '${existing.status}'. Only active phases can be modified.`,
        409,
      );
    }

    // Extract and validate only allowlisted fields.
    const updates: Partial<Record<MutableField, number | null>> = {};
    for (const field of MUTABLE_FIELDS) {
      if (!(field in body)) continue;
      const val = body[field];
      if (val === null) {
        updates[field] = null;
        continue;
      }
      const n = Number(val);
      if (isNaN(n)) {
        return fail("VALIDATION_ERROR", `${field} must be a number or null`);
      }
      if (field === "target_change_kg_per_week") {
        if (n > 0) {
          return fail("VALIDATION_ERROR", "target_change_kg_per_week must be negative or zero");
        }
        if (n < -2.0) {
          return fail("VALIDATION_ERROR", "target_change_kg_per_week cannot exceed -2.0 kg/week");
        }
      } else if (n < 0) {
        return fail("VALIDATION_ERROR", `${field} must be non-negative`);
      }
      if (field === "target_calories" && n === 0) {
        return fail("VALIDATION_ERROR", "target_calories must be greater than 0");
      }
      if ((field === "target_weight_kg") && (n < 20 || n > 300)) {
        return fail("VALIDATION_ERROR", "target_weight_kg must be between 20 and 300");
      }
      updates[field] = n;
    }

    if (Object.keys(updates).length === 0) {
      return fail("VALIDATION_ERROR", "No mutable fields provided");
    }

    const { data: updated, error: updateErr } = await service
      .from("goal_phases")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", phaseId)
      .select("*")
      .single();

    if (updateErr) {
      console.error(updateErr);
      return fail("INTERNAL_ERROR", "Failed to update goal phase", 500);
    }

    return ok(updated);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error updating goal phase", 500);
  }
});
