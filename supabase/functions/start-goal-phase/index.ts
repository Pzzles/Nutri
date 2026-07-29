// start-goal-phase
// Creates a new goal phase. If an active phase already exists the caller must
// supply transition='supersede'|'cancel' to resolve it. The old-phase
// transition and new-phase creation are atomic (fn_start_goal_phase RPC).
//
// Input validation is performed here; the RPC enforces DB-level constraints.
// See docs/adr/009-goal-phases.md for the full design rationale.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

interface StartPhaseBody {
  mode: string;
  started_at?: string;
  starting_weight_kg?: number;
  starting_weight_source?: string;
  target_weight_kg?: number;
  target_change_kg_per_week?: number;
  target_calories?: number;
  target_protein_g?: number;
  target_carbs_g?: number;
  target_fat_g?: number;
  target_fibre_g?: number;
  transition?: string;
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

    const body: StartPhaseBody = await req.json().catch(() => ({}));

    // ── Validate mode ────────────────────────────────────────────────────────
    if (!body.mode || !["cut", "maintenance", "bulk"].includes(body.mode)) {
      return fail("VALIDATION_ERROR", "mode must be 'cut', 'maintenance', or 'bulk'");
    }

    // ── Validate started_at ──────────────────────────────────────────────────
    const startedAt = body.started_at ? new Date(body.started_at) : new Date();
    if (isNaN(startedAt.getTime())) {
      return fail("VALIDATION_ERROR", "started_at must be a valid ISO timestamp");
    }

    // ── Validate starting weight ─────────────────────────────────────────────
    const service = getServiceClient();

    let startingWeightKg = body.starting_weight_kg;
    const source = body.starting_weight_source;

    if (!source || !["manual", "latest_weight_log"].includes(source)) {
      return fail("VALIDATION_ERROR", "starting_weight_source must be 'manual' or 'latest_weight_log'");
    }

    if (source === "latest_weight_log") {
      // Fetch the most recent official weight log.
      const { data: latestWeight } = await service
        .from("weight_logs")
        .select("weight_kg")
        .eq("user_id", userId)
        .eq("is_official", true)
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestWeight) {
        return fail(
          "NO_WEIGHT_LOG",
          "No official weight measurement found. Log a weight first or supply starting_weight_kg manually.",
          422,
        );
      }
      startingWeightKg = Number(latestWeight.weight_kg);
    }

    if (startingWeightKg == null || isNaN(Number(startingWeightKg))) {
      return fail("VALIDATION_ERROR", "starting_weight_kg is required");
    }
    const swKg = Number(startingWeightKg);
    if (swKg < 20 || swKg > 300) {
      return fail("VALIDATION_ERROR", "starting_weight_kg must be between 20 and 300");
    }

    // ── Validate target_weight_kg ────────────────────────────────────────────
    if (body.target_weight_kg != null) {
      const tw = Number(body.target_weight_kg);
      if (isNaN(tw) || tw < 20 || tw > 300) {
        return fail("VALIDATION_ERROR", "target_weight_kg must be between 20 and 300");
      }
    }

    // ── Validate target_change_kg_per_week ───────────────────────────────────
    // Sign convention: negative = loss (cut), zero = maintenance, positive = gain (bulk).
    if (body.target_change_kg_per_week != null) {
      const rate = Number(body.target_change_kg_per_week);
      if (isNaN(rate)) {
        return fail("VALIDATION_ERROR", "target_change_kg_per_week must be a number.");
      }
      if (Math.abs(rate) > 2.0) {
        return fail("VALIDATION_ERROR", "target_change_kg_per_week cannot exceed 2.0 kg/week in either direction.");
      }
      if (body.mode === "cut" && rate >= 0) {
        return fail("VALIDATION_ERROR", "A cut phase requires a negative weekly change rate.");
      }
      if (body.mode === "maintenance" && rate !== 0) {
        return fail("VALIDATION_ERROR", "A maintenance phase requires a zero weekly change rate.");
      }
      if (body.mode === "bulk" && rate <= 0) {
        return fail("VALIDATION_ERROR", "A bulk phase requires a positive weekly change rate.");
      }
    }

    // ── Validate nutrition targets ───────────────────────────────────────────
    for (const [field, val] of [
      ["target_calories", body.target_calories],
      ["target_protein_g", body.target_protein_g],
      ["target_carbs_g", body.target_carbs_g],
      ["target_fat_g", body.target_fat_g],
      ["target_fibre_g", body.target_fibre_g],
    ] as [string, number | undefined][]) {
      if (val != null) {
        const n = Number(val);
        if (isNaN(n) || n < 0) {
          return fail("VALIDATION_ERROR", `${field} must be a non-negative number`);
        }
        if (field === "target_calories" && n === 0) {
          return fail("VALIDATION_ERROR", "target_calories must be greater than 0");
        }
      }
    }

    // ── Validate transition ──────────────────────────────────────────────────
    if (body.transition != null && !["supersede", "cancel"].includes(body.transition)) {
      return fail("VALIDATION_ERROR", "transition must be 'supersede' or 'cancel'");
    }

    // ── Call atomic RPC ──────────────────────────────────────────────────────
    const { data: newPhaseId, error: rpcErr } = await service.rpc("fn_start_goal_phase", {
      p_user_id: userId,
      p_mode: body.mode,
      p_started_at: startedAt.toISOString(),
      p_starting_weight_kg: swKg,
      p_starting_weight_source: source,
      p_target_weight_kg: body.target_weight_kg ?? null,
      p_target_change_kg_per_week: body.target_change_kg_per_week ?? null,
      p_target_calories: body.target_calories ?? null,
      p_target_protein_g: body.target_protein_g ?? null,
      p_target_carbs_g: body.target_carbs_g ?? null,
      p_target_fat_g: body.target_fat_g ?? null,
      p_target_fibre_g: body.target_fibre_g ?? null,
      p_transition: body.transition ?? null,
    });

    if (rpcErr) {
      // Surface business-logic errors from the RPC.
      if (rpcErr.code === "P0002") {
        return fail(
          "ACTIVE_PHASE_EXISTS",
          "An active phase already exists. Supply transition=supersede or transition=cancel.",
          409,
        );
      }
      console.error(rpcErr);
      return fail("INTERNAL_ERROR", "Failed to start goal phase", 500);
    }

    // Return the newly created phase.
    const { data: phase } = await service
      .from("goal_phases")
      .select("*")
      .eq("id", newPhaseId)
      .single();

    return ok(phase);
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error starting goal phase", 500);
  }
});
