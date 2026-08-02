/**
 * save-goal-feedback-assessment
 *
 * POST /functions/v1/save-goal-feedback-assessment
 *
 * Persists an immutable snapshot of the current goal-progress assessment.
 *
 * The server ALWAYS recalculates before saving; it never trusts calculated
 * values supplied by the frontend. The frontend must send only goal_phase_id
 * as confirmation that the user intends to save the assessment for that phase.
 *
 * Idempotency: saving an assessment for the same (user, goal_phase, day) a
 * second time overwrites the first row rather than creating a second one.
 *
 * Saving does NOT:
 *   • change the calorie target
 *   • change the active goal phase
 *   • write a manual maintenance override
 *   • change any upstream data
 */

import { ok, fail, preflight }            from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";
import { calculate as p6Calculate, type RawEntry } from "../_shared/weightTrend.ts";
import {
  calculate as p7Calculate,
  type AdaptiveMaintenanceInput,
  ENERGY_BALANCE_VERSION,
  NUTRITION_QUALITY_VERSION,
  CONFIDENCE_VERSION,
} from "../_shared/adaptiveMaintenance.ts";
import {
  assess,
  type GoalProgressInput,
  GOAL_PROGRESS_VERSION,
  GOAL_THRESHOLDS_VERSION,
} from "../_shared/goalProgressAssessment.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_TIMEZONE    = "Africa/Johannesburg";
const PAGE_SIZE           = 500;
const HISTORICAL_LAG_DAYS = 14;

// ── Types ─────────────────────────────────────────────────────────────────────

type GoalPhase = {
  id: string; mode: string; status: string; started_at: string;
  target_change_kg_per_week: number | null;
  manual_maintenance_kcal: number | null; snapshot_id: string | null;
};
type SnapshotRow = {
  calculated_tdee_kcal: number; manual_maintenance_kcal: number | null;
  effective_maintenance_kcal: number; maintenance_source: string;
};
type DailyLogRow = { logged_date: string; status: string };
type MealDayTotal = { logged_date: string; total_kcal: number; meal_count: number; item_count: number };

type P67Evidence = {
  p6Status: string;
  p6Confidence: "low" | "medium" | "high";
  p6WeeklyRateKg: number | null;
  p7Status: "usable" | "provisional" | "insufficient" | null;
  p7Confidence: "low" | "medium" | "high" | null;
  p7CoverageFraction: number | null;
};

// ── Database helpers ──────────────────────────────────────────────────────────

async function dbLoadProfile(uid: string, svc: SupabaseClient) {
  const { data } = await svc.from("profiles").select("timezone").eq("id", uid).single();
  return { timezone: (data as { timezone?: string | null })?.timezone ?? null };
}

async function dbLoadActiveGoalPhase(uid: string, svc: SupabaseClient): Promise<GoalPhase | null> {
  const { data, error } = await svc
    .from("goal_phases")
    .select("id, mode, status, started_at, target_change_kg_per_week, manual_maintenance_kcal, snapshot_id")
    .eq("user_id", uid)
    .eq("status", "active")
    .single();
  if (error || !data) return null;
  return data as GoalPhase;
}

async function dbLoadSnapshot(id: string, svc: SupabaseClient): Promise<SnapshotRow | null> {
  const { data, error } = await svc
    .from("calorie_target_snapshots")
    .select("calculated_tdee_kcal, manual_maintenance_kcal, effective_maintenance_kcal, maintenance_source")
    .eq("id", id).single();
  if (error || !data) return null;
  return data as SnapshotRow;
}

async function dbLoadWeightLogs(uid: string, since: string, until: string, svc: SupabaseClient): Promise<RawEntry[]> {
  const rows: RawEntry[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await svc
      .from("weight_logs")
      .select("measured_at, weight_kg, is_official")
      .eq("user_id", uid)
      .gte("logged_date", since)
      .lte("logged_date", until)
      .order("measured_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`weight_logs: ${error.message}`);
    for (const r of (data ?? [])) {
      rows.push({ measured_at: r.measured_at as string, weight_kg: Number(r.weight_kg), is_official: r.is_official as boolean });
    }
    if ((data?.length ?? 0) < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function dbLoadDailyLogStatus(uid: string, start: string, end: string, svc: SupabaseClient): Promise<DailyLogRow[]> {
  const { data, error } = await svc
    .from("daily_log_status")
    .select("logged_date, status")
    .eq("user_id", uid)
    .gte("logged_date", start)
    .lte("logged_date", end)
    .order("logged_date", { ascending: true });
  if (error) throw new Error(`daily_log_status: ${error.message}`);
  return (data ?? []) as DailyLogRow[];
}

async function dbLoadMealDayTotals(uid: string, start: string, end: string, svc: SupabaseClient): Promise<MealDayTotal[]> {
  const { data, error } = await svc.rpc("fn_get_daily_meal_totals", { p_user_id: uid, p_start: start, p_end: end });
  if (error) throw new Error(`meal totals: ${error.message}`);
  return (data ?? []) as MealDayTotal[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isValidIANATimezone(tz: string): boolean {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}
function toLocalDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function shiftDate(s: string, days: number): string {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function calendarDaysBetween(s: string, e: string): number {
  return Math.round((new Date(e + "T12:00:00Z").getTime() - new Date(s + "T12:00:00Z").getTime()) / 86_400_000) + 1;
}
function maxDate(a: string, b: string): string { return a >= b ? a : b; }

// ── Evidence computation (identical logic to get-goal-feedback) ───────────────

async function computeEvidence(
  uid: string,
  phase: GoalPhase,
  snapshot: SnapshotRow | null,
  tz: string,
  asOf: Date,
  svc: SupabaseClient,
): Promise<P67Evidence> {
  const asOfIso    = asOf.toISOString();
  const asOfLocal  = toLocalDate(asOf, tz);
  const phaseStart = toLocalDate(new Date(phase.started_at), tz);

  const weightRows = await dbLoadWeightLogs(uid, phaseStart, asOfLocal, svc);
  if (weightRows.length === 0) {
    return { p6Status: "insufficient_measurements", p6Confidence: "low", p6WeeklyRateKg: null,
             p7Status: null, p7Confidence: null, p7CoverageFraction: null };
  }

  const p6Result  = p6Calculate(weightRows, asOfIso, tz);
  const p6Status  = p6Result.status;
  const p6Conf    = p6Result.confidence;
  const p6Rate    = p6Result.weekly_rate?.estimate_kg ?? null;

  if (p6Status === "stale" || p6Status === "insufficient_measurements" ||
      p6Status === "insufficient_coverage" || p6Rate === null) {
    return { p6Status, p6Confidence: p6Conf, p6WeeklyRateKg: p6Rate,
             p7Status: null, p7Confidence: null, p7CoverageFraction: null };
  }

  const selectedWindow = p6Result.measurements.selected_rate_window_days;
  if (!selectedWindow) {
    return { p6Status, p6Confidence: p6Conf, p6WeeklyRateKg: p6Rate,
             p7Status: null, p7Confidence: null, p7CoverageFraction: null };
  }

  const asOfYesterday = shiftDate(asOfLocal, -1);
  const windowStart   = maxDate(shiftDate(asOfYesterday, -(selectedWindow - 1)), phaseStart);
  const windowEnd     = asOfYesterday;

  if (windowStart > windowEnd) {
    return { p6Status, p6Confidence: p6Conf, p6WeeklyRateKg: p6Rate,
             p7Status: "insufficient", p7Confidence: null, p7CoverageFraction: null };
  }

  const calDays = calendarDaysBetween(windowStart, windowEnd);
  const logStatus  = await dbLoadDailyLogStatus(uid, windowStart, windowEnd, svc);
  const mealTotals = await dbLoadMealDayTotals(uid, windowStart, windowEnd, svc);

  const statusMap = new Map<string, string>();
  const mealMap   = new Map<string, MealDayTotal>();
  for (const r of logStatus) statusMap.set(r.logged_date, r.status);
  for (const r of mealTotals) mealMap.set(r.logged_date, r);

  let completeDays = 0, fastingDays = 0, probablyComplDays = 0;
  const eligibleDates: string[] = [];
  const fastingDates: string[]  = [];
  let cur = windowStart;
  while (cur <= windowEnd) {
    const st = statusMap.get(cur) ?? "unknown";
    if (st === "complete") { completeDays++; eligibleDates.push(cur); }
    else if (st === "fasting") { fastingDays++; fastingDates.push(cur); eligibleDates.push(cur); }
    else if ((st === "partial" || st === "probably_complete") && mealMap.has(cur)) probablyComplDays++;
    cur = shiftDate(cur, 1);
  }

  const eligibleDayCount = completeDays + fastingDays;
  let totalKcal = 0;
  for (const d of eligibleDates) totalKcal += fastingDates.includes(d) ? 0 : (mealMap.get(d)?.total_kcal ?? 0);
  const avgIntake = eligibleDayCount > 0 ? totalKcal / eligibleDayCount : 0;

  const nutritionWarnings: string[] = [];
  if (probablyComplDays > 0) nutritionWarnings.push(`${probablyComplDays} day(s) appear partially logged.`);

  const p7Input: AdaptiveMaintenanceInput = {
    averageIntakeKcal:             avgIntake,
    eligibleDayCount,
    analysisCalendarDays:          calDays,
    probablyCompleteDayCount:      probablyComplDays,
    weeklyRateKg:                  p6Result.weekly_rate!.estimate_kg,
    rateLowerKg:                   p6Result.weekly_rate!.lower_kg ?? null,
    rateUpperKg:                   p6Result.weekly_rate!.upper_kg ?? null,
    weightTrendConfidence:         p6Conf,
    nutritionWarnings,
    goalPhaseId:                   phase.id,
    equationEstimatedTdeeKcal:     snapshot?.calculated_tdee_kcal ?? null,
    manualMaintenanceOverrideKcal: phase.manual_maintenance_kcal ?? snapshot?.manual_maintenance_kcal ?? null,
    effectiveMaintenanceKcal:      snapshot?.effective_maintenance_kcal ?? null,
    effectiveMaintenanceSource:    snapshot?.maintenance_source ?? null,
  };

  const p7Result = p7Calculate(p7Input);
  return {
    p6Status,
    p6Confidence:       p6Conf,
    p6WeeklyRateKg:     p6Rate,
    p7Status:           p7Result?.status ?? "insufficient",
    p7Confidence:       p7Result?.confidence ?? null,
    p7CoverageFraction: p7Result?.coverageFraction ?? null,
  };
}

// ── Deno entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    // ── 1. Authenticate ───────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid or expired session", 401);

    const userId = userData.user.id;
    const svc    = getServiceClient();
    const now    = new Date();

    // ── 2. Parse body ─────────────────────────────────────────────────────
    const body    = await req.json().catch(() => ({}));
    const phaseId = typeof body.goal_phase_id === "string" ? body.goal_phase_id : null;
    if (!phaseId) return fail("INVALID_PARAM", "goal_phase_id is required", 400);

    // ── 3. Load profile ───────────────────────────────────────────────────
    const profile = await dbLoadProfile(userId, svc);
    const rawTz   = profile.timezone ?? DEFAULT_TIMEZONE;
    const tz      = isValidIANATimezone(rawTz) ? rawTz : DEFAULT_TIMEZONE;

    // ── 4. Load and validate goal phase ───────────────────────────────────
    const phase = await dbLoadActiveGoalPhase(userId, svc);
    if (!phase)               return fail("NO_ACTIVE_PHASE", "No active goal phase.", 422);
    if (phase.id !== phaseId) return fail("PHASE_MISMATCH", "goal_phase_id does not match active phase.", 422);

    // ── 5. Load snapshot ──────────────────────────────────────────────────
    let snapshot: SnapshotRow | null = null;
    if (phase.snapshot_id) snapshot = await dbLoadSnapshot(phase.snapshot_id, svc);

    // ── 6. Recalculate evidence (server always recalculates; never trusts frontend) ──
    const currentEv    = await computeEvidence(userId, phase, snapshot, tz, now, svc);
    const asOf14       = new Date(now.getTime() - HISTORICAL_LAG_DAYS * 86_400_000);
    const historicalEv = await computeEvidence(userId, phase, snapshot, tz, asOf14, svc);

    // ── 7. Assess progress ────────────────────────────────────────────────
    const assessInput: GoalProgressInput = {
      goalMode:                     phase.mode as "cut" | "maintenance" | "bulk",
      goalTargetRateKgPerWeek:      phase.target_change_kg_per_week ?? null,
      goalPhaseStartedAt:           phase.started_at,
      assessedAt:                   now.toISOString(),
      currentP6Status:              currentEv.p6Status,
      currentP6Confidence:          currentEv.p6Confidence,
      currentP6WeeklyRateKg:        currentEv.p6WeeklyRateKg,
      currentP7Status:              currentEv.p7Status,
      currentP7Confidence:          currentEv.p7Confidence,
      currentP7CoverageFraction:    currentEv.p7CoverageFraction,
      historicalP6Status:           historicalEv.p6Status,
      historicalP6Confidence:       historicalEv.p6Confidence,
      historicalP6WeeklyRateKg:     historicalEv.p6WeeklyRateKg,
      historicalP7Status:           historicalEv.p7Status,
      historicalP7Confidence:       historicalEv.p7Confidence,
      historicalP7CoverageFraction: historicalEv.p7CoverageFraction,
    };

    const result = assess(assessInput);

    // ── 8. Save assessment snapshot ───────────────────────────────────────
    const assessedDate = toLocalDate(now, tz);

    const row = {
      user_id:                         userId,
      goal_phase_id:                   phase.id,
      goal_mode:                       phase.mode,
      goal_phase_started_at:           phase.started_at,
      goal_target_rate_kg_per_week:    phase.target_change_kg_per_week ?? null,
      assessed_at:                     now.toISOString(),
      progress_state:                  result.state,
      reason_codes:                    result.reasonCodes,
      feedback_action:                 result.feedbackAction,
      advisory_calorie_adjustment_kcal: result.advisoryCalorieAdjustmentKcal ?? null,
      advisory_adjustment_direction:   result.advisoryAdjustmentDirection ?? null,
      goal_attainment_ratio:           result.goalAttainmentRatio ?? null,
      current_p6_status:               currentEv.p6Status,
      current_p6_confidence:           currentEv.p6Confidence,
      current_p6_weekly_rate_kg:       currentEv.p6WeeklyRateKg ?? null,
      current_p7_status:               currentEv.p7Status ?? null,
      current_p7_confidence:           currentEv.p7Confidence ?? null,
      current_p7_coverage_fraction:    currentEv.p7CoverageFraction ?? null,
      historical_p6_status:            historicalEv.p6Status,
      historical_p6_confidence:        historicalEv.p6Confidence,
      historical_p6_weekly_rate_kg:    historicalEv.p6WeeklyRateKg ?? null,
      historical_p7_status:            historicalEv.p7Status ?? null,
      historical_p7_confidence:        historicalEv.p7Confidence ?? null,
      historical_p7_coverage_fraction: historicalEv.p7CoverageFraction ?? null,
      algorithm_versions: {
        goal_progress:    GOAL_PROGRESS_VERSION,
        goal_thresholds:  GOAL_THRESHOLDS_VERSION,
        energy_balance:   ENERGY_BALANCE_VERSION,
        nutrition_quality: NUTRITION_QUALITY_VERSION,
        confidence:       CONFIDENCE_VERSION,
      },
      warnings:    result.warnings,
      limitations: result.limitations,
    };

    const { data: saved, error: saveErr } = await svc
      .from("goal_feedback_assessments")
      .upsert(row, {
        onConflict:       "user_id,goal_phase_id,assessed_date",
        ignoreDuplicates: false,
      })
      .select("id, created_at")
      .single();

    if (saveErr) {
      console.error(JSON.stringify({ event: "assessment_save_failed", error: String(saveErr) }));
      return fail("DB_ERROR", "Failed to save assessment.", 500);
    }

    return ok({
      assessment_id:                   (saved as { id: string; created_at: string }).id,
      created_at:                      (saved as { id: string; created_at: string }).created_at,
      progress_state:                  result.state,
      feedback_action:                 result.feedbackAction,
      advisory_calorie_adjustment_kcal: result.advisoryCalorieAdjustmentKcal ?? null,
      advisory_adjustment_direction:   result.advisoryAdjustmentDirection ?? null,
      goal_attainment_ratio:           result.goalAttainmentRatio ?? null,
    });

  } catch (err) {
    console.error(JSON.stringify({ event: "top_level_error", error: String(err) }));
    return fail("INTERNAL_ERROR", "Unexpected error", 500);
  }
});
