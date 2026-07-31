// start-goal-phase
// Creates a new goal phase. If an active phase already exists the caller must
// supply transition='supersede'|'cancel' to resolve it. The old-phase
// transition and new-phase creation are atomic (fn_start_goal_phase_v2 RPC).
//
// Phase 5+: the server derives the calorie target from the user's profile and
// official weight. The caller MUST NOT supply target_calories; the server
// calculates and stores it authoritatively in a calorie_target_snapshot.
//
// If the user's profile lacks required energy-calc fields (birth_date, sex,
// height_cm, activity_level) or no official weight exists, the call returns
// PROFILE_INCOMPLETE with a list of missing fields.
//
// See docs/adr/009-goal-phases.md for the full design rationale.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import {
  validateEnergyInputs,
  calculateAgeYears,
  calculateBMR,
  getActivityMultiplier,
  resolveMaintenanceKcal,
  calculateDailyAdjustment,
  isAggressiveRate,
  type EquationSex,
  type ActivityLevel,
  type GoalMode,
} from "../_shared/energyCalc.ts";
import {
  ABSOLUTE_FLOOR_KCAL,
  ALGORITHM_VERSION,
  ACTIVITY_MULTIPLIER_VERSION,
  CONFIG_VERSIONS,
} from "../_shared/scienceConfig.ts";

interface StartPhaseBody {
  mode: string;
  started_at?: string;
  starting_weight_kg?: number;
  starting_weight_source?: string;
  target_weight_kg?: number;
  target_change_kg_per_week?: number;
  // Energy calc inputs (Phase 5+)
  manual_maintenance_kcal?: number | null;
  aggressive_rate_acknowledged?: boolean;
  // Activity level override (if supplied and valid, overrides profile value for this phase).
  activity_level?: string;
  // Nutrition overrides (Phase 5: protein/carbs/fat/fibre only; calories are server-derived)
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

    // ── Reject frontend-supplied target_calories ─────────────────────────────
    if ((body as Record<string, unknown>)["target_calories"] != null) {
      return fail(
        "FORBIDDEN_FIELD",
        "target_calories must not be supplied by the client. " +
        "The server derives the calorie target from your profile and official weight.",
        422,
      );
    }

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

    // Fetch latest official weight (with provenance fields for the snapshot).
    const { data: latestWeight } = await service
      .from("weight_logs")
      .select("id, weight_kg, measured_at, source")
      .eq("user_id", userId)
      .eq("is_official", true)
      .order("measured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (source === "latest_weight_log") {
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
    if (swKg < 1 || swKg > 500) {
      return fail("VALIDATION_ERROR", "starting_weight_kg must be between 1 and 500");
    }

    // ── Validate target_weight_kg ────────────────────────────────────────────
    if (body.target_weight_kg != null) {
      const tw = Number(body.target_weight_kg);
      if (isNaN(tw) || tw < 1 || tw > 500) {
        return fail("VALIDATION_ERROR", "target_weight_kg must be between 1 and 500");
      }
      if (body.mode === "bulk" && tw <= swKg) {
        return fail("VALIDATION_ERROR", "Bulk phase target weight must be greater than starting weight.");
      }
      if (body.mode === "cut" && tw >= swKg) {
        return fail("VALIDATION_ERROR", "Cut phase target weight must be less than starting weight.");
      }
    }

    // ── Validate target_change_kg_per_week ───────────────────────────────────
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
      }
    }

    // ── Validate transition ──────────────────────────────────────────────────
    if (body.transition != null && !["supersede", "cancel"].includes(body.transition)) {
      return fail("VALIDATION_ERROR", "transition must be 'supersede' or 'cancel'");
    }

    // ── Fetch profile ────────────────────────────────────────────────────────
    const { data: profile } = await service
      .from("profiles")
      .select("birth_date, sex, height_cm, activity_level")
      .eq("id", userId)
      .maybeSingle();

    // ── Resolve activity level (body override wins if valid) ─────────────────
    const validActivityLevels = ["sedentary", "light", "moderate", "active", "very_active"];
    const activityLevelSource =
      (body.activity_level && validActivityLevels.includes(body.activity_level))
        ? "goals_form" : "profile_field";
    const resolvedActivityLevel =
      activityLevelSource === "goals_form" ? body.activity_level : profile?.activity_level;

    // ── Check for missing profile fields required by energy calc ─────────────
    const missingFields: string[] = [];
    if (!profile?.birth_date) missingFields.push("birth_date");
    if (!profile?.sex || !["male", "female"].includes(profile.sex)) missingFields.push("equation_sex");
    if (!profile?.height_cm) missingFields.push("height_cm");
    if (!resolvedActivityLevel) missingFields.push("activity_level");
    if (!latestWeight) missingFields.push("official_weight_kg");

    if (missingFields.length > 0) {
      return fail(
        "PROFILE_INCOMPLETE",
        `Cannot start a goal phase without: ${missingFields.join(", ")}. ` +
        "Complete your profile and log an official weight first.",
        422,
      );
    }

    const officialWeightKg = Number(latestWeight!.weight_kg);
    const height_cm       = Number(profile!.height_cm);
    const equation_sex    = profile!.sex as EquationSex;
    const activity_level  = resolvedActivityLevel as ActivityLevel;
    const birth_date      = profile!.birth_date as string;
    const goalMode        = body.mode as GoalMode;
    const rate            = goalMode === "maintenance"
      ? 0
      : Number(body.target_change_kg_per_week ?? 0);

    // ── Validate energy inputs ────────────────────────────────────────────────
    const validationErrors = validateEnergyInputs({
      birth_date, equation_sex, height_cm,
      weight_kg: officialWeightKg,
      activity_level, goal_mode: goalMode,
      target_change_kg_per_week: rate,
      manual_maintenance_kcal: body.manual_maintenance_kcal ?? null,
    });
    if (validationErrors.length > 0) {
      return fail("VALIDATION_ERROR", validationErrors.map((e) => e.message).join("; "));
    }

    // ── Run server-side energy calculation ────────────────────────────────────
    const calcTimestamp  = new Date().toISOString();
    const age_years      = calculateAgeYears(birth_date);
    const bmr            = calculateBMR({ weight_kg: officialWeightKg, height_cm, age_years, equation_sex });
    const actMultiplier  = getActivityMultiplier(activity_level);
    const tdee           = bmr * actMultiplier;

    const { effective: effectiveMaintenance, source: maintenanceSource } =
      resolveMaintenanceKcal(tdee, body.manual_maintenance_kcal ?? null);

    const dailyAdj     = calculateDailyAdjustment(rate);
    const rawTarget    = effectiveMaintenance + dailyAdj;
    const finalTarget  = rawTarget; // no silent clamping

    // ── Enforce calorie floor ─────────────────────────────────────────────────
    if (finalTarget < ABSOLUTE_FLOOR_KCAL) {
      return fail(
        "TARGET_BELOW_FLOOR",
        `The calculated target (${Math.round(finalTarget)} kcal/day) is below the ` +
        `${ABSOLUTE_FLOOR_KCAL} kcal/day minimum. Reduce the goal rate or adjust the timeframe.`,
        422,
      );
    }

    // ── Aggressive rate — require acknowledgement ─────────────────────────────
    const aggressive = isAggressiveRate(rate, officialWeightKg);
    if (aggressive && !body.aggressive_rate_acknowledged) {
      return fail(
        "AGGRESSIVE_RATE_UNACKNOWLEDGED",
        `The requested rate (${Math.abs(rate)} kg/week) exceeds 1% of body weight per week ` +
        `(${(officialWeightKg * 0.01).toFixed(2)} kg/week). ` +
        "Set aggressive_rate_acknowledged=true to confirm you accept this rate.",
        422,
      );
    }

    const warningCodes: string[] = [];
    if (aggressive) warningCodes.push("aggressive_rate");

    // ── Build input provenance for the snapshot ───────────────────────────────
    const inputProvenance: Record<string, unknown> = {
      weight: {
        source_type:  "measured",
        log_source:   (latestWeight as Record<string, unknown>).source ?? "unknown",
        measured_at:  (latestWeight as Record<string, unknown>).measured_at,
      },
      activity_level: {
        source_type:  "user_selected",
        provided_via: activityLevelSource,
      },
      bmr:         { source_type: "calculated", algorithm: ALGORITHM_VERSION },
      tdee:        { source_type: "calculated", algorithm: ACTIVITY_MULTIPLIER_VERSION },
      final_target: { source_type: "calculated" },
    };
    if (body.manual_maintenance_kcal != null) {
      inputProvenance.maintenance = { source_type: "manually_estimated", provided_via: "goals_form_override" };
    }

    // ── Call v2 atomic RPC ────────────────────────────────────────────────────
    const { data: rpcResult, error: rpcErr } = await service.rpc("fn_start_goal_phase_v2", {
      p_user_id: userId,
      p_mode: body.mode,
      p_started_at: startedAt.toISOString(),
      p_starting_weight_kg: swKg,
      p_starting_weight_source: source,
      p_target_weight_kg: body.target_weight_kg ?? null,
      p_target_change_kg_per_week: body.target_change_kg_per_week ?? null,
      p_target_calories: Math.round(finalTarget),
      p_target_protein_g: body.target_protein_g ?? null,
      p_target_carbs_g: body.target_carbs_g ?? null,
      p_target_fat_g: body.target_fat_g ?? null,
      p_target_fibre_g: body.target_fibre_g ?? null,
      p_transition: body.transition ?? null,
      p_manual_maintenance_kcal: body.manual_maintenance_kcal ?? null,
      // activity_level override is handled above — resolvedActivityLevel is used in the snapshot
      // ── Snapshot fields ─────────────────────────────────────────────────────
      p_algorithm_name: "mifflin_st_jeor",
      p_algorithm_version: ALGORITHM_VERSION,
      p_activity_multiplier_version: ACTIVITY_MULTIPLIER_VERSION,
      p_calculation_timestamp: calcTimestamp,
      p_profile_birth_date: birth_date,
      p_equation_sex: equation_sex,
      p_height_cm: height_cm,
      p_official_weight_kg: officialWeightKg,
      p_weight_log_id: latestWeight!.id,
      p_weight_measured_at: (latestWeight as Record<string, unknown>).measured_at ?? null,
      p_weight_log_source: (latestWeight as Record<string, unknown>).source ?? null,
      p_input_provenance: JSON.stringify(inputProvenance),
      p_age_years: age_years,
      p_activity_level: activity_level,
      p_activity_multiplier: actMultiplier,
      p_calculated_bmr_kcal: bmr,
      p_calculated_tdee_kcal: tdee,
      p_effective_maintenance_kcal: effectiveMaintenance,
      p_maintenance_source: maintenanceSource,
      p_requested_rate_kg_per_week: rate,
      p_daily_adjustment_kcal: dailyAdj,
      p_raw_target_kcal: rawTarget,
      p_final_target_kcal: finalTarget,
      p_warning_codes: JSON.stringify(warningCodes),
      p_aggressive_rate_acknowledged: body.aggressive_rate_acknowledged ?? false,
      p_config_versions: JSON.stringify(CONFIG_VERSIONS),
    });

    if (rpcErr) {
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

    const { phase_id: phaseId, snapshot_id: snapshotId } = rpcResult as {
      phase_id: string;
      snapshot_id: string | null;
    };

    // Fetch full phase + snapshot for the response.
    const [{ data: phase }, { data: snapshot }] = await Promise.all([
      service.from("goal_phases").select("*").eq("id", phaseId).single(),
      snapshotId
        ? service.from("calorie_target_snapshots").select("*").eq("id", snapshotId).single()
        : Promise.resolve({ data: null }),
    ]);

    return ok({ phase, snapshot });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error starting goal phase", 500);
  }
});
