import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pg from "pg";
import { runEnergyCalc } from "../../functions/_shared/energyCalc.ts";
import { calculate as calculateWeightTrend } from "../../functions/_shared/weightTrend.ts";
import { calculate as calculateMaintenance } from "../../functions/_shared/adaptiveMaintenance.ts";
import { assess, type GoalProgressInput } from "../../functions/_shared/goalProgressAssessment.ts";
import { buildAnthropometryProgress, type AnthropometryProgressInputPoint } from "../../functions/_shared/anthropometryProgress.ts";
import { ANON_KEY, SUPABASE_URL, createTestUser, deleteTestUser, signInAs, svcClient, testEmail } from "../helpers.js";

const asOf = "2026-08-01T06:00:00Z";
const weights = Array.from({ length: 12 }, (_, index) => ({
  id: `weight-${index}`,
  measured_at: new Date(Date.parse("2026-06-01T06:00:00Z") + index * 5 * 86_400_000).toISOString(),
  weight_kg: 82 - index * 0.2,
  is_official: true,
}));

function canonicalPhaseOutputs() {
  const phase5 = runEnergyCalc({
    weight_kg: 80, height_cm: 175, birth_date: "1990-01-01", equation_sex: "male",
    activity_level: "moderate", goal_mode: "cut", target_change_kg_per_week: -0.4,
    calc_date: "2026-08-01",
  });
  const phase6 = calculateWeightTrend(weights, asOf, "Africa/Johannesburg", 84);
  const phase7 = calculateMaintenance({
    averageIntakeKcal: 2200, eligibleDayCount: 24, analysisCalendarDays: 28,
    probablyCompleteDayCount: 2, weeklyRateKg: phase6.weekly_rate!.estimate_kg,
    rateLowerKg: phase6.weekly_rate!.lower_kg, rateUpperKg: phase6.weekly_rate!.upper_kg,
    weightTrendConfidence: phase6.confidence, nutritionWarnings: [], goalPhaseId: "phase-fixture",
    equationEstimatedTdeeKcal: phase5.estimated_tdee_kcal,
    manualMaintenanceOverrideKcal: null,
    effectiveMaintenanceKcal: phase5.effective_maintenance_kcal,
    effectiveMaintenanceSource: phase5.maintenance_source,
  });
  const phase8Input: GoalProgressInput = {
    goalMode: "cut", goalTargetRateKgPerWeek: -0.4,
    goalPhaseStartedAt: "2026-06-01T06:00:00Z", assessedAt: asOf,
    currentP6Status: phase6.status, currentP6Confidence: phase6.confidence,
    currentP6WeeklyRateKg: phase6.weekly_rate?.estimate_kg ?? null,
    currentP6RateLowerKg: phase6.weekly_rate?.lower_kg ?? null,
    currentP6RateUpperKg: phase6.weekly_rate?.upper_kg ?? null,
    currentP7Status: phase7?.status ?? "insufficient",
    currentP7Confidence: phase7?.confidence ?? null,
    currentP7CoverageFraction: phase7?.coverageFraction ?? null,
    currentP7ObservedMaintenanceKcal: phase7?.observedMaintenanceKcal ?? null,
    currentP7ObservedMaintenanceLowerKcal: phase7?.maintenanceLowerKcal ?? null,
    currentP7ObservedMaintenanceUpperKcal: phase7?.maintenanceUpperKcal ?? null,
    currentP7Warnings: phase7?.warnings ?? [],
    historicalP6Status: null, historicalP6Confidence: null,
    historicalP6WeeklyRateKg: null, historicalP6RateLowerKg: null,
    historicalP6RateUpperKg: null, historicalP7Status: null,
    historicalP7Confidence: null, historicalP7CoverageFraction: null,
    currentOfficialWeightKg: 80, currentTargetCalories: phase5.recommended_target_kcal,
    hasUnresolvedAggressiveRateWarning: false,
  };
  return { phase5, phase6, phase7, phase8: assess(phase8Input) };
}

describe("Phase 10 non-interference with canonical Phase 5-8 outputs", () => {
  it("produces byte-equivalent before/after results", () => {
    const before = canonicalPhaseOutputs();
    const points: AnthropometryProgressInputPoint[] = [
      {
        session_id: "anthro-before", site_code: "waist", measured_at: "2026-06-01T06:00:00Z",
        logged_date: "2026-06-01", protocol_version: "anthropometry_protocol_v1",
        representative_cm: 92, quality: "pair_agree", eligible_for_interpretation: true,
        algorithm_version: "anthropometry_representative_v3",
        measurement_context: { version: "anthropometry_measurement_context_v1", local_time: "08:00:00", meal_timing: "before_food", after_bathroom: true, exercise_within_previous_12_hours: false, measurement_assistance: "self", clothing_level: "minimal" },
      },
      {
        session_id: "anthro-after", site_code: "waist", measured_at: asOf,
        logged_date: "2026-08-01", protocol_version: "anthropometry_protocol_v1",
        representative_cm: 89, quality: "pair_agree", eligible_for_interpretation: true,
        algorithm_version: "anthropometry_representative_v3",
        measurement_context: { version: "anthropometry_measurement_context_v1", local_time: "08:00:00", meal_timing: "before_food", after_bathroom: true, exercise_within_previous_12_hours: false, measurement_assistance: "self", clothing_level: "minimal" },
      },
    ];
    const anthropometry = buildAnthropometryProgress(points, before.phase6, true, asOf);
    expect(anthropometry.weight_comparison?.algorithm_version).toBe("anthropometry_weight_comparison_v2");
    const after = canonicalPhaseOutputs();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("proves Phase 5-8 production modules do not import or query anthropometry", () => {
    const files = [
      "energyCalc.ts", "weightTrend.ts", "adaptiveMaintenance.ts", "goalProgressAssessment.ts",
    ];
    for (const file of files) {
      const path = fileURLToPath(new URL(`../../functions/_shared/${file}`, import.meta.url));
      expect(readFileSync(path, "utf8").toLowerCase(), file).not.toContain("anthropometr");
    }
    const endpoints = [
      "preview-energy-calc", "get-weight-trend", "get-adaptive-maintenance", "get-goal-feedback",
    ];
    for (const endpoint of endpoints) {
      const path = fileURLToPath(new URL(`../../functions/${endpoint}/index.ts`, import.meta.url));
      expect(readFileSync(path, "utf8").toLowerCase(), endpoint).not.toContain("anthropometr");
    }
  });

  it("keeps a real user's Phase 5-8 records and canonical outputs byte-equivalent", async () => {
    const email = testEmail("anthropometry-non-interference-real");
    const userId = await createTestUser(email);
    const service = svcClient();
    const dbUrl = process.env.SUPABASE_DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
    try {
      await service.from("profiles").upsert({
        id: userId, timezone: "Africa/Johannesburg", birth_date: "1990-01-01",
        sex: "male", height_cm: 175, activity_level: "moderate",
      }, { onConflict: "id" });
      const weightRows = weights.map((weight) => ({
        user_id: userId, weight_kg: weight.weight_kg, measured_at: weight.measured_at,
        logged_date: weight.measured_at.slice(0, 10), is_official: true, source: "manual",
      }));
      const weightResult = await service.from("weight_logs").insert(weightRows).select("id");
      if (weightResult.error) throw weightResult.error;
      const phaseResult = await service.from("goal_phases").insert({
        user_id: userId, mode: "cut", status: "active", started_at: "2026-06-01T06:00:00Z",
        starting_weight_kg: 82, starting_weight_source: "manual",
        target_change_kg_per_week: -0.4, target_calories: 2200,
      }).select("id").single();
      if (phaseResult.error) throw phaseResult.error;
      const phaseId = phaseResult.data.id;
      const targetResult = await service.from("calorie_target_snapshots").insert({
        user_id: userId, goal_phase_id: phaseId, algorithm_name: "mifflin_st_jeor",
        algorithm_version: "v1", activity_multiplier_version: "v1", profile_birth_date: "1990-01-01",
        equation_sex: "male", height_cm: 175, official_weight_kg: 80,
        weight_log_id: weightResult.data.at(-1)!.id, age_years: 36, activity_level: "moderate",
        activity_multiplier: 1.55, calculated_bmr_kcal: 1700, calculated_tdee_kcal: 2635,
        effective_maintenance_kcal: 2635, maintenance_source: "equation_estimate", goal_mode: "cut",
        raw_target_kcal: 2195, final_target_kcal: 2200,
      }).select("id").single();
      if (targetResult.error) throw targetResult.error;
      const maintenanceResult = await service.from("maintenance_estimate_snapshots").insert({
        user_id: userId, goal_phase_id: phaseId, goal_mode: "cut",
        goal_phase_started_at: "2026-06-01T06:00:00Z", analysis_window_start: "2026-07-05",
        analysis_window_end: "2026-08-01", analysis_calendar_days: 28, selected_weight_window_days: 28,
        timezone: "Africa/Johannesburg", eligible_nutrition_day_count: 3,
        probably_complete_day_count: 0, incomplete_day_count: 0, not_logged_day_count: 25,
        eligible_nutrition_coverage: 0.1071, average_intake_kcal: 2200, weekly_rate_kg: -0.28,
        weight_trend_confidence: "medium", observed_maintenance_kcal: 2508,
        maintenance_lower_kcal: 2400, maintenance_upper_kcal: 2616,
        status: "provisional", confidence: "medium",
      });
      if (maintenanceResult.error) throw maintenanceResult.error;
      const feedbackResult = await service.from("goal_feedback_assessments").insert({
        user_id: userId, goal_phase_id: phaseId, goal_mode: "cut",
        goal_phase_started_at: "2026-06-01T06:00:00Z", assessed_at: asOf,
        progress_state: "on_track", feedback_action: "keep_current_plan",
        current_p6_status: "usable", current_p6_confidence: "medium",
        current_target_calories: 2200,
      });
      if (feedbackResult.error) throw feedbackResult.error;
      const nutritionRows = ["2026-07-29", "2026-07-30", "2026-07-31"].map((date) => ({
        user_id: userId, raw_input: "fixed nutrition fixture", meal_type: "dinner",
        meal_confidence: "high", eaten_at: `${date}T18:00:00Z`, logged_date: date,
      }));
      const nutritionResult = await service.from("meals").insert(nutritionRows);
      if (nutritionResult.error) throw nutritionResult.error;
      const statusResult = await service.from("daily_log_status").insert(
        nutritionRows.map((row) => ({
          user_id: userId, logged_date: row.logged_date, status: "complete",
          marked_complete_at: `${row.logged_date}T23:00:00Z`,
        })),
      );
      if (statusResult.error) throw statusResult.error;

      async function productSnapshot() {
        const [phase, target, maintenance, feedback, profile, weightHistory, nutritionHistory] = await Promise.all([
          service.from("goal_phases").select("mode,status,target_calories,target_change_kg_per_week").eq("id", phaseId).single(),
          service.from("calorie_target_snapshots").select("final_target_kcal,maintenance_source,effective_maintenance_kcal").eq("id", targetResult.data.id).single(),
          service.from("maintenance_estimate_snapshots").select("observed_maintenance_kcal,maintenance_lower_kcal,maintenance_upper_kcal,confidence").eq("goal_phase_id", phaseId).single(),
          service.from("goal_feedback_assessments").select("progress_state,feedback_action,suggested_adjustment_kcal,proposed_target_kcal").eq("goal_phase_id", phaseId).single(),
          service.from("profiles").select("birth_date,sex,height_cm,activity_level,timezone").eq("id", userId).single(),
          service.from("weight_logs").select("weight_kg,measured_at").eq("user_id", userId).order("measured_at"),
          service.from("daily_log_status").select("logged_date,status").eq("user_id", userId).order("logged_date"),
        ]);
        for (const result of [phase, target, maintenance, feedback, profile, weightHistory, nutritionHistory]) {
          if (result.error) throw result.error;
        }
        return {
          canonical: canonicalPhaseOutputs(), phase: phase.data, target: target.data,
          maintenance: maintenance.data, feedback: feedback.data, profile: profile.data,
          weight_history: weightHistory.data, nutrition_history: nutritionHistory.data,
        };
      }

      const before = productSnapshot();
      const { client } = await signInAs(email);
      const token = (await client.auth.getSession()).data.session!.access_token;
      async function saveSession(body: Record<string, unknown>) {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/save-anthropometric-session`, {
          method: "POST",
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`anthropometry fixture failed: ${response.status} ${await response.text()}`);
      }
      await saveSession({ status: "finalized", measured_at: "2026-06-01T06:00:00Z",
        protocol_version: "anthropometry_protocol_v1", idempotency_key: `non-interference-1-${userId}`,
        measurement_context: { meal_timing: "before_food", after_bathroom: true,
          exercise_within_previous_12_hours: false, measurement_assistance: "self", clothing_level: "minimal" },
        sites: [{ site_code: "waist", readings_cm: [92, 92.4] }] });
      await saveSession({ status: "finalized", measured_at: asOf,
        protocol_version: "anthropometry_protocol_v1", idempotency_key: `non-interference-2-${userId}`,
        measurement_context: { meal_timing: "after_food", after_bathroom: false,
          exercise_within_previous_12_hours: true, measurement_assistance: "assisted", clothing_level: "normal" },
        sites: [{ site_code: "waist", readings_cm: [89, 89.4] }] });
      await saveSession({ status: "finalized", measured_at: "2026-07-15T06:00:00Z",
        protocol_version: "anthropometry_protocol_v1", idempotency_key: `non-interference-low-${userId}`,
        high_variability_acknowledgements: [{ site_code: "chest", acknowledged: true }],
        sites: [{ site_code: "chest", readings_cm: [100, 103, 106] }] });

      const db = new pg.Client({ connectionString: dbUrl });
      await db.connect();
      try {
        await db.query("BEGIN");
        const inserted = await db.query(
          `INSERT INTO public.anthropometric_sessions
            (user_id,status,measured_at,data_contract_version,protocol_version)
           VALUES ($1,'draft','2026-05-01T06:00:00Z','anthropometry_data_contract_v2','anthropometry_protocol_future_v2') RETURNING id`,
          [userId],
        );
        const sessionId = inserted.rows[0].id;
        await db.query(
          `INSERT INTO public.anthropometric_readings (session_id,user_id,site_code,reading_number,value_cm)
           VALUES ($1,$2,'chest',1,101),($1,$2,'chest',2,101.4)`, [sessionId, userId],
        );
        await db.query(
          `UPDATE public.anthropometric_sessions SET status='finalized',logged_date='2026-05-01',timezone='UTC',
             representative_algorithm_version='anthropometry_representative_v2',thresholds_version='anthropometry_repeatability_thresholds_v2',
             idempotency_key=$2,payload_hash='non-interference-future',finalized_at=now() WHERE id=$1`,
          [sessionId, `non-interference-future-${userId}`],
        );
        await db.query("SELECT set_config('app.anthropometry_finalizing_session',$1,true)", [sessionId]);
        await db.query(
          `INSERT INTO public.anthropometric_representatives
            (session_id,user_id,site_code,representative_cm,method,reading_count,initial_pair_difference_cm,
             all_readings_range_cm,quality,quality_flags,algorithm_version)
           VALUES ($1,$2,'chest',101.2,'mean_of_two',2,0.4,0.4,'within_repeatability_threshold','[]','anthropometry_representative_v2')`,
          [sessionId, userId],
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        await db.end();
      }

      const after = productSnapshot();
      expect(JSON.stringify(await after)).toBe(JSON.stringify(await before));
    } finally {
      await deleteTestUser(userId);
    }
  }, 60_000);
});
