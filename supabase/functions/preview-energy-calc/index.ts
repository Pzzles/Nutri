// preview-energy-calc
// Returns a full energy-calculation breakdown for the authenticated user.
// This is a READ-ONLY operation — no database mutations are performed.
//
// Response contract (Phase 5 data quality):
//   ready:          boolean — true only when all required inputs are present and
//                             the calculated target is above the floor.
//   missing_fields: { field, reason, action }[] — one entry per absent input.
//   stale_fields:   { field, recorded_at, days_old, action }[] — inputs that exist
//                   but are older than WEIGHT_FRESHNESS_WARNING_DAYS.
//   data_quality:   { profile_complete, weight_current, calculation_possible }
//   input_provenance: { weight, activity_level, maintenance?, bmr, tdee, final_target }
//                   — source-type map so callers know which values were measured,
//                     user-selected, manually-estimated, or calculated.
//
// When ready:false the calculation fields are absent.
// When ready:true  all calculation fields are present alongside the quality metadata.

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
  WEIGHT_FRESHNESS_WARNING_DAYS,
} from "../_shared/scienceConfig.ts";

// ── Per-field metadata for structured missing-field responses ──────────────────

interface MissingFieldMeta { reason: string; action: string; }

const MISSING_FIELD_META: Record<string, MissingFieldMeta> = {
  birth_date:                { reason: "Required to calculate age for the BMR formula", action: "complete_profile_birth_date" },
  equation_sex:              { reason: "Required for the Mifflin–St Jeor sex-specific constant", action: "complete_profile_sex" },
  height_cm:                 { reason: "Required for the BMR formula", action: "complete_profile_height" },
  activity_level:            { reason: "Required to estimate TDEE from BMR", action: "select_activity_level" },
  official_weight_kg:        { reason: "Required for the BMR calculation", action: "log_official_weight" },
  goal_mode:                 { reason: "Required to determine the calorie-adjustment direction", action: "select_goal_mode" },
  target_change_kg_per_week: { reason: "Required for non-maintenance goal phases", action: "enter_weekly_rate" },
};

function toMissingField(field: string) {
  const meta = MISSING_FIELD_META[field] ?? { reason: "Required input is absent", action: "provide_field" };
  return { field, ...meta };
}

// ─────────────────────────────────────────────────────────────────────────────

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
    const { goal_mode, target_change_kg_per_week, manual_maintenance_kcal, starting_weight_kg,
            aggressive_rate_acknowledged, activity_level: bodyActivityLevel } = body;

    const service = getServiceClient();

    // ── Fetch profile ──────────────────────────────────────────────────────────
    const { data: profile } = await service
      .from("profiles")
      .select("birth_date, sex, height_cm, activity_level")
      .eq("id", userId)
      .maybeSingle();

    // ── Fetch latest official weight (with provenance fields) ──────────────────
    const { data: weightRow } = await service
      .from("weight_logs")
      .select("id, weight_kg, measured_at, source")
      .eq("user_id", userId)
      .eq("is_official", true)
      .order("measured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasManualWeight = starting_weight_kg !== undefined && starting_weight_kg !== null && starting_weight_kg !== "";
    const resolvedWeightKg = hasManualWeight ? Number(starting_weight_kg) : Number(weightRow?.weight_kg);

    // ── Resolve activity level (body override wins if valid) ───────────────────
    const validActivityLevels = ["sedentary", "light", "moderate", "active", "very_active"];
    const activityLevelSource = (bodyActivityLevel && validActivityLevels.includes(bodyActivityLevel))
      ? "goals_form" : "profile_field";
    const resolvedActivityLevel =
      activityLevelSource === "goals_form" ? bodyActivityLevel : profile?.activity_level;

    // ── Build missing_fields (structured) ─────────────────────────────────────
    const missingFieldNames: string[] = [];
    if (!profile?.birth_date)                                             missingFieldNames.push("birth_date");
    if (!profile?.sex || !["male", "female"].includes(profile.sex))      missingFieldNames.push("equation_sex");
    if (!profile?.height_cm)                                              missingFieldNames.push("height_cm");
    if (!resolvedActivityLevel)                                           missingFieldNames.push("activity_level");
    if (!hasManualWeight && !weightRow)                                   missingFieldNames.push("official_weight_kg");
    if (!goal_mode)                                                       missingFieldNames.push("goal_mode");
    if (goal_mode !== "maintenance" && target_change_kg_per_week == null) missingFieldNames.push("target_change_kg_per_week");

    const missingFields = missingFieldNames.map(toMissingField);

    // ── Weight freshness check ─────────────────────────────────────────────────
    const staleFields: { field: string; recorded_at: string; days_old: number; action: string }[] = [];
    let daysOld = 0;
    if (weightRow && !hasManualWeight) {
      const measuredAt = new Date(weightRow.measured_at as string);
      daysOld = (Date.now() - measuredAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld > WEIGHT_FRESHNESS_WARNING_DAYS) {
        staleFields.push({
          field:       "official_weight",
          recorded_at: weightRow.measured_at as string,
          days_old:    Math.floor(daysOld),
          action:      "log_current_weight",
        });
      }
    }

    // ── Data quality object ────────────────────────────────────────────────────
    const profileFieldNames = ["birth_date", "equation_sex", "height_cm", "activity_level"];
    const profileComplete   = missingFieldNames.filter(f => profileFieldNames.includes(f)).length === 0;
    const weightCurrent     = hasManualWeight || !!(weightRow && daysOld <= WEIGHT_FRESHNESS_WARNING_DAYS);
    const calculationPossible = missingFields.length === 0;

    const dataQuality = { profile_complete: profileComplete, weight_current: weightCurrent, calculation_possible: calculationPossible };

    if (missingFields.length > 0) {
      return ok({
        ready:          false,
        missing_fields: missingFields,
        stale_fields:   staleFields,
        data_quality:   dataQuality,
      });
    }

    const weight_kg      = resolvedWeightKg;
    const height_cm      = Number(profile!.height_cm);
    const equation_sex   = profile!.sex as EquationSex;
    const activity_level = resolvedActivityLevel as ActivityLevel;
    const birth_date     = profile!.birth_date as string;
    const mode           = goal_mode as GoalMode;
    const rate           = mode === "maintenance" ? 0 : Number(target_change_kg_per_week ?? 0);

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
    const calcTimestamp       = new Date().toISOString();
    const age_years           = calculateAgeYears(birth_date);
    const estimated_bmr_kcal  = calculateBMR({ weight_kg, height_cm, age_years, equation_sex });
    const activity_multiplier = getActivityMultiplier(activity_level);
    const estimated_tdee_kcal = estimated_bmr_kcal * activity_multiplier;

    const { effective: effective_maintenance_kcal, source: maintenance_source } =
      resolveMaintenanceKcal(estimated_tdee_kcal, manual_maintenance_kcal ?? null);

    const daily_adjustment_kcal = calculateDailyAdjustment(rate);
    const raw_target_kcal       = effective_maintenance_kcal + daily_adjustment_kcal;

    const warnings: WarningCode[] = [];
    const aggressive = isAggressiveRate(rate, weight_kg);
    if (aggressive) warnings.push("aggressive_rate");
    if (raw_target_kcal < ABSOLUTE_FLOOR_KCAL) warnings.push("target_below_floor");

    if (raw_target_kcal < ABSOLUTE_FLOOR_KCAL) {
      return fail(
        "TARGET_BELOW_FLOOR",
        `The calculated target (${Math.round(raw_target_kcal)} kcal/day) falls below the ` +
        `${ABSOLUTE_FLOOR_KCAL} kcal/day minimum. Reduce the goal rate or adjust the timeframe.`,
        422,
      );
    }

    // ── Input provenance map ───────────────────────────────────────────────────
    const inputProvenance: Record<string, unknown> = {
      weight: {
        source_type:  "measured",
        log_source:   hasManualWeight ? "goals_form" : (weightRow!.source ?? "unknown"),
        measured_at:  hasManualWeight ? calcTimestamp : weightRow!.measured_at,
      },
      activity_level: {
        source_type:  "user_selected",
        provided_via: activityLevelSource,
      },
      bmr: {
        source_type: "calculated",
        algorithm:   ALGORITHM_VERSION,
      },
      tdee: {
        source_type: "calculated",
        algorithm:   ACTIVITY_MULTIPLIER_VERSION,
      },
      final_target: {
        source_type: "calculated",
      },
    };
    if (manual_maintenance_kcal != null) {
      inputProvenance.maintenance = {
        source_type:  "manually_estimated",
        provided_via: "goals_form_override",
      };
    }

    // ── Build explanation ──────────────────────────────────────────────────────
    const roundedBmr    = Math.round(estimated_bmr_kcal);
    const roundedTdee   = Math.round(estimated_tdee_kcal);
    const roundedMaint  = Math.round(effective_maintenance_kcal);
    const roundedAdj    = Math.round(daily_adjustment_kcal);
    const roundedTarget = Math.round(raw_target_kcal);
    const actLabel      = ACTIVITY_LABELS[activity_level] ?? activity_level;

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
      ready:            true,
      missing_fields:   [],
      stale_fields:     staleFields,
      data_quality:     dataQuality,
      calculation_timestamp: calcTimestamp,
      input_snapshot: {
        birth_date,
        equation_sex,
        height_cm,
        official_weight_kg:        weight_kg,
        weight_log_id:             hasManualWeight ? null : weightRow!.id,
        weight_measured_at:        hasManualWeight ? calcTimestamp : weightRow!.measured_at,
        age_years,
        activity_level,
        activity_multiplier,
        goal_mode: mode,
        target_change_kg_per_week: rate,
        manual_maintenance_kcal:   manual_maintenance_kcal ?? null,
      },
      input_provenance:            inputProvenance,
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
