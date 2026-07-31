// preview-energy-calc
// Returns a full energy-calculation breakdown for the authenticated user.
// This is a READ-ONLY operation — no database mutations are performed.
// The user can call this before deciding to start a goal phase.
//
// Inputs (body JSON):
//   goal_mode:                  "cut" | "maintenance" | "bulk"
//   target_change_kg_per_week:  number (signed; negative=cut, 0=maintenance, positive=bulk)
//   manual_maintenance_kcal?:   number | null
//   aggressive_rate_acknowledged?: boolean
//
// Profile fields consumed: birth_date, sex (equation_sex), height_cm, activity_level
// Weight consumed: latest official weight log
//
// All calculated values are labelled as ESTIMATES.
// This function does not produce or store a goal phase.

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
  type WarningCode,
} from "../_shared/energyCalc.ts";
import {
  ACTIVITY_LABELS,
  ABSOLUTE_FLOOR_KCAL,
  ALGORITHM_VERSION,
  ACTIVITY_MULTIPLIER_VERSION,
  CONFIG_VERSIONS,
} from "../_shared/scienceConfig.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid session", 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { goal_mode, target_change_kg_per_week, manual_maintenance_kcal,
            aggressive_rate_acknowledged, activity_level: bodyActivityLevel } = body;

    const service = getServiceClient();

    // ── Fetch profile ──────────────────────────────────────────────────────────
    const { data: profile } = await service
      .from("profiles")
      .select("birth_date, sex, height_cm, activity_level")
      .eq("id", userId)
      .maybeSingle();

    // ── Fetch latest official weight ───────────────────────────────────────────
    const { data: weightRow } = await service
      .from("weight_logs")
      .select("id, weight_kg")
      .eq("user_id", userId)
      .eq("is_official", true)
      .order("measured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Resolve activity level (body override wins if valid) ───────────────────
    const validActivityLevels = ["sedentary", "light", "moderate", "active", "very_active"];
    const resolvedActivityLevel =
      (bodyActivityLevel && validActivityLevels.includes(bodyActivityLevel))
        ? bodyActivityLevel
        : profile?.activity_level;

    // ── Check for missing required fields ──────────────────────────────────────
    const missingFields: string[] = [];
    if (!profile?.birth_date) missingFields.push("birth_date");
    if (!profile?.sex || !["male", "female"].includes(profile.sex)) missingFields.push("equation_sex");
    if (!profile?.height_cm) missingFields.push("height_cm");
    if (!resolvedActivityLevel) missingFields.push("activity_level");
    if (!weightRow) missingFields.push("official_weight_kg");
    if (!goal_mode) missingFields.push("goal_mode");
    if (goal_mode !== "maintenance" && target_change_kg_per_week == null) {
      missingFields.push("target_change_kg_per_week");
    }

    if (missingFields.length > 0) {
      return ok({
        eligible: false,
        missing_fields: missingFields,
        instructions: buildMissingInstructions(missingFields),
      });
    }

    const weight_kg = Number(weightRow!.weight_kg);
    const height_cm = Number(profile!.height_cm);
    const equation_sex = profile!.sex as EquationSex;
    const activity_level = resolvedActivityLevel as ActivityLevel;
    const birth_date = profile!.birth_date as string;
    const mode = goal_mode as GoalMode;
    const rate = mode === "maintenance" ? 0 : Number(target_change_kg_per_week ?? 0);

    // ── Validate inputs ────────────────────────────────────────────────────────
    const validationErrors = validateEnergyInputs({
      birth_date, equation_sex, height_cm, weight_kg, activity_level,
      goal_mode: mode, target_change_kg_per_week: rate,
      manual_maintenance_kcal: manual_maintenance_kcal ?? null,
    });

    if (validationErrors.length > 0) {
      return fail("VALIDATION_ERROR", validationErrors.map((e) => e.message).join("; "));
    }

    // ── Calculate ──────────────────────────────────────────────────────────────
    const calcTimestamp = new Date().toISOString();
    const age_years = calculateAgeYears(birth_date);
    const estimated_bmr_kcal = calculateBMR({ weight_kg, height_cm, age_years, equation_sex });
    const activity_multiplier = getActivityMultiplier(activity_level);
    const estimated_tdee_kcal = estimated_bmr_kcal * activity_multiplier;

    const { effective: effective_maintenance_kcal, source: maintenance_source } =
      resolveMaintenanceKcal(estimated_tdee_kcal, manual_maintenance_kcal ?? null);

    const daily_adjustment_kcal = calculateDailyAdjustment(rate);
    const raw_target_kcal = effective_maintenance_kcal + daily_adjustment_kcal;

    const warnings: WarningCode[] = [];
    const aggressive = isAggressiveRate(rate, weight_kg);
    if (aggressive) warnings.push("aggressive_rate");
    if (raw_target_kcal < ABSOLUTE_FLOOR_KCAL) warnings.push("target_below_floor");

    // Reject infeasible targets (not silently clamped — the caller must adjust).
    if (raw_target_kcal < ABSOLUTE_FLOOR_KCAL) {
      return fail(
        "TARGET_BELOW_FLOOR",
        `The calculated target (${Math.round(raw_target_kcal)} kcal/day) falls below the ` +
        `${ABSOLUTE_FLOOR_KCAL} kcal/day minimum. Reduce the goal rate or adjust the timeframe.`,
        422,
      );
    }

    // Aggressive rate requires acknowledgement before starting a phase.
    // For the preview, we surface the warning; the start-phase call enforces acknowledgement.

    // ── Build explanation ──────────────────────────────────────────────────────
    const roundedBmr   = Math.round(estimated_bmr_kcal);
    const roundedTdee  = Math.round(estimated_tdee_kcal);
    const roundedMaint = Math.round(effective_maintenance_kcal);
    const roundedAdj   = Math.round(daily_adjustment_kcal);
    const roundedTarget = Math.round(raw_target_kcal);
    const actLabel = ACTIVITY_LABELS[activity_level] ?? activity_level;

    const explanation = [
      `Estimated resting energy (Mifflin–St Jeor, ${equation_sex}): ${roundedBmr} kcal/day`,
      `× activity multiplier (${actLabel}, ${activity_multiplier}): ${roundedTdee} kcal/day`,
      maintenance_source === "manual_override"
        ? `Maintenance: ${roundedMaint} kcal/day (manual override)`
        : `Estimated maintenance: ${roundedTdee} kcal/day`,
      rate !== 0
        ? `${mode === "cut" ? "Deficit" : "Surplus"}: ${Math.abs(roundedAdj)} kcal/day ` +
          `(${Math.abs(rate)} kg/week × 7,700 ÷ 7)`
        : "No adjustment (maintenance mode)",
      `Calorie target: ${roundedTarget} kcal/day`,
      "",
      "Note: These are estimates. Actual energy requirements vary. " +
      "This calculator is not designed for pregnancy, breastfeeding or medical nutrition treatment.",
    ].join("\n");

    return ok({
      eligible: true,
      missing_fields: [],
      calculation_timestamp: calcTimestamp,
      input_snapshot: {
        birth_date,
        equation_sex,
        height_cm,
        official_weight_kg: weight_kg,
        weight_log_id: weightRow!.id,
        age_years,
        activity_level,
        activity_multiplier,
        goal_mode: mode,
        target_change_kg_per_week: rate,
        manual_maintenance_kcal: manual_maintenance_kcal ?? null,
      },
      estimated_bmr_kcal:          roundedBmr,
      estimated_tdee_kcal:         roundedTdee,
      manual_maintenance_kcal:     manual_maintenance_kcal ?? null,
      effective_maintenance_kcal:  roundedMaint,
      maintenance_source,
      daily_adjustment_kcal:       roundedAdj,
      raw_target_kcal:             roundedTarget,
      recommended_target_kcal:     roundedTarget,
      warnings,
      is_aggressive_rate:          aggressive,
      algorithm_versions:          CONFIG_VERSIONS,
      explanation,
    });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error calculating energy estimate", 500);
  }
});

function buildMissingInstructions(missing: string[]): string {
  const instructions: string[] = [];
  if (missing.includes("birth_date") || missing.includes("equation_sex") ||
      missing.includes("height_cm") || missing.includes("activity_level")) {
    instructions.push("Complete your profile: date of birth, equation sex, height, and activity level.");
  }
  if (missing.includes("official_weight_kg")) {
    instructions.push("Log an official weight measurement before starting a goal phase.");
  }
  if (missing.includes("goal_mode")) {
    instructions.push("Select a goal mode (cut, maintenance, or bulk).");
  }
  if (missing.includes("target_change_kg_per_week")) {
    instructions.push("Enter a target weekly change rate.");
  }
  return instructions.join(" ");
}
