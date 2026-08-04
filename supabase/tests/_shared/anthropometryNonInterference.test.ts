import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runEnergyCalc } from "../../functions/_shared/energyCalc.ts";
import { calculate as calculateWeightTrend } from "../../functions/_shared/weightTrend.ts";
import { calculate as calculateMaintenance } from "../../functions/_shared/adaptiveMaintenance.ts";
import { assess, type GoalProgressInput } from "../../functions/_shared/goalProgressAssessment.ts";
import { buildAnthropometryProgress, type AnthropometryProgressInputPoint } from "../../functions/_shared/anthropometryProgress.ts";

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
});
