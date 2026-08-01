/**
 * save-maintenance-estimate
 *
 * POST /functions/v1/save-maintenance-estimate
 *
 * Persists an immutable snapshot of the current observed-maintenance estimate.
 *
 * The server ALWAYS recalculates before saving; it never trusts calculated
 * values supplied by the frontend.  The frontend must send only the goal_phase_id
 * as confirmation that the user intends to save the estimate for that phase.
 *
 * Idempotency: saving an estimate for the same (user, goal_phase, window) a
 * second time overwrites the first row rather than growing an unbounded
 * history of same-window saves.
 *
 * Saving does NOT:
 *   • change the calorie target
 *   • change the active goal phase
 *   • write a manual maintenance override
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
import type { SupabaseClient }             from "npm:@supabase/supabase-js@2";

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const PAGE_SIZE        = 500;

// ── Database helpers (duplicated from get-adaptive-maintenance) ───────────────
// These are intentionally inlined so the two functions can be deployed
// independently without shared state.

type GoalPhase = {
  id: string; mode: string; status: string; started_at: string;
  manual_maintenance_kcal: number | null; snapshot_id: string | null;
};
type SnapshotRow = {
  calculated_tdee_kcal: number; manual_maintenance_kcal: number | null;
  effective_maintenance_kcal: number; maintenance_source: string;
};
type DailyLogRow = { logged_date: string; status: string; };
type MealDayTotal = { logged_date: string; total_kcal: number; meal_count: number; item_count: number; };

async function dbLoadProfile(uid: string, svc: SupabaseClient) {
  const { data } = await svc.from("profiles").select("timezone").eq("id", uid).single();
  return { timezone: (data as { timezone?: string | null })?.timezone ?? null };
}
async function dbLoadActiveGoalPhase(uid: string, svc: SupabaseClient): Promise<GoalPhase | null> {
  const { data, error } = await svc.from("goal_phases")
    .select("id, mode, status, started_at, manual_maintenance_kcal, snapshot_id")
    .eq("user_id", uid).eq("status", "active").single();
  if (error || !data) return null;
  return data as GoalPhase;
}
async function dbLoadSnapshot(id: string, svc: SupabaseClient): Promise<SnapshotRow | null> {
  const { data, error } = await svc.from("calorie_target_snapshots")
    .select("calculated_tdee_kcal, manual_maintenance_kcal, effective_maintenance_kcal, maintenance_source")
    .eq("id", id).single();
  if (error || !data) return null;
  return data as SnapshotRow;
}
async function dbLoadWeightLogs(uid: string, since: string, svc: SupabaseClient) {
  const rows: RawEntry[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await svc.from("weight_logs")
      .select("measured_at, weight_kg, is_official")
      .eq("user_id", uid).gte("logged_date", since)
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
  const { data, error } = await svc.from("daily_log_status")
    .select("logged_date, status").eq("user_id", uid)
    .gte("logged_date", start).lte("logged_date", end)
    .order("logged_date", { ascending: true });
  if (error) throw new Error(`daily_log_status: ${error.message}`);
  return (data ?? []) as DailyLogRow[];
}
async function dbLoadMealDayTotals(uid: string, start: string, end: string, svc: SupabaseClient): Promise<MealDayTotal[]> {
  const { data, error } = await svc.rpc("fn_get_daily_meal_totals", { p_user_id: uid, p_start: start, p_end: end });
  if (error) throw new Error(`meal totals: ${error.message}`);
  return (data ?? []) as MealDayTotal[];
}

function isValidIANATimezone(tz: string): boolean {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; }
}
function toLocalDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function calendarDaysBetween(s: string, e: string): number {
  return Math.round((new Date(e + "T12:00:00Z").getTime() - new Date(s + "T12:00:00Z").getTime()) / 86_400_000) + 1;
}
function maxDate(a: string, b: string): string { return a >= b ? a : b; }

// ── Core handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    // ── 1. Authenticate ─────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

    const userClient = getUserClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid or expired session", 401);

    const userId = userData.user.id;
    const svc    = getServiceClient();
    const now    = new Date();

    // ── 2. Parse body ───────────────────────────────────────────────────────
    const body    = await req.json().catch(() => ({}));
    const phaseId = typeof body.goal_phase_id === "string" ? body.goal_phase_id : null;
    if (!phaseId) return fail("INVALID_PARAM", "goal_phase_id is required", 400);

    // ── 3. Load profile ─────────────────────────────────────────────────────
    const profile = await dbLoadProfile(userId, svc);
    const rawTz   = profile.timezone ?? DEFAULT_TIMEZONE;
    const tz      = isValidIANATimezone(rawTz) ? rawTz : DEFAULT_TIMEZONE;

    // ── 4. Load and validate goal phase ─────────────────────────────────────
    const phase = await dbLoadActiveGoalPhase(userId, svc);
    if (!phase)              return fail("NO_ACTIVE_PHASE", "No active goal phase.", 422);
    if (phase.id !== phaseId) return fail("PHASE_MISMATCH", "goal_phase_id does not match the current active phase.", 422);

    const phaseStartDate = toLocalDate(new Date(phase.started_at), tz);

    // ── 5. Load Phase 5 equation/override values ────────────────────────────
    let snapshot: SnapshotRow | null = null;
    if (phase.snapshot_id) snapshot = await dbLoadSnapshot(phase.snapshot_id, svc);

    const equationEstimatedTdeeKcal     = snapshot?.calculated_tdee_kcal ?? null;
    const manualMaintenanceOverrideKcal = phase.manual_maintenance_kcal ?? snapshot?.manual_maintenance_kcal ?? null;
    const effectiveMaintenanceKcal      = snapshot?.effective_maintenance_kcal ?? null;
    const effectiveMaintenanceSource    = snapshot?.maintenance_source ?? null;

    // ── 6. Re-run the full Phase 7 calculation ──────────────────────────────
    const weightRows = await dbLoadWeightLogs(userId, phaseStartDate, svc);
    if (weightRows.length === 0) return fail("INSUFFICIENT_WEIGHT_DATA", "No weight data in current goal phase.", 422);

    const nowIso   = now.toISOString();
    const p6Result = p6Calculate(weightRows, nowIso, tz);

    if (p6Result.status === "insufficient") return fail("INSUFFICIENT_WEIGHT_DATA", "Not enough weight data.", 422);
    if (p6Result.status === "stale")         return fail("STALE_WEIGHT_DATA", "Weight data is stale.", 422);

    const weeklyRate = p6Result.weekly_rate;
    if (!weeklyRate || weeklyRate.estimate_kg === null) return fail("INSUFFICIENT_WEIGHT_DATA", "No rate estimate.", 422);

    const selectedWindow = p6Result.measurements.selected_rate_window_days;
    if (!selectedWindow) return fail("INSUFFICIENT_WEIGHT_DATA", "Phase 6 did not select a rate window.", 422);

    const todayStr     = toLocalDate(now, tz);
    const yesterdayStr = shiftDate(todayStr, -1);
    const rawWinStart  = shiftDate(yesterdayStr, -(selectedWindow - 1));
    const windowStart  = maxDate(rawWinStart, phaseStartDate);
    const windowEnd    = yesterdayStr;
    const calDays      = calendarDaysBetween(windowStart, windowEnd);

    const logStatusRows = await dbLoadDailyLogStatus(userId, windowStart, windowEnd, svc);
    const statusMap     = new Map<string, string>();
    for (const r of logStatusRows) statusMap.set(r.logged_date, r.status);

    const mealTotals = await dbLoadMealDayTotals(userId, windowStart, windowEnd, svc);
    const mealMap    = new Map<string, MealDayTotal>();
    for (const r of mealTotals) mealMap.set(r.logged_date, r);

    let completeDays = 0, fastingDays = 0, probablyComplDays = 0, incompleteDays = 0, notLoggedDays = 0;
    const eligibleDates: string[] = [];
    const fastingDates: string[]  = [];

    let cur = windowStart;
    while (cur <= windowEnd) {
      const st = statusMap.get(cur) ?? "unknown";
      if (st === "complete") { completeDays++; eligibleDates.push(cur); }
      else if (st === "fasting") { fastingDays++; fastingDates.push(cur); eligibleDates.push(cur); }
      else if (st === "partial" || st === "probably_complete") {
        if (mealMap.has(cur)) probablyComplDays++; else incompleteDays++;
      } else { notLoggedDays++; }
      cur = shiftDate(cur, 1);
    }

    const eligibleDayCount = completeDays + fastingDays;
    let totalKcal = 0;
    for (const d of eligibleDates) {
      if (fastingDates.includes(d)) { totalKcal += 0; }
      else { totalKcal += mealMap.get(d)?.total_kcal ?? 0; }
    }
    const avgIntake = eligibleDayCount > 0 ? totalKcal / eligibleDayCount : 0;

    const nutritionWarnings: string[] = [];
    if (probablyComplDays > 0) {
      nutritionWarnings.push(`${probablyComplDays} day(s) appear partially logged but are not marked complete.`);
    }

    const p7Input: AdaptiveMaintenanceInput = {
      averageIntakeKcal: avgIntake,
      eligibleDayCount,
      analysisCalendarDays: calDays,
      probablyCompleteDayCount: probablyComplDays,
      weeklyRateKg: weeklyRate!.estimate_kg,
      rateLowerKg: weeklyRate!.lower_kg ?? null,
      rateUpperKg: weeklyRate!.upper_kg ?? null,
      weightTrendConfidence: p6Result.confidence,
      nutritionWarnings,
      goalPhaseId: phase.id,
      equationEstimatedTdeeKcal,
      manualMaintenanceOverrideKcal,
      effectiveMaintenanceKcal,
      effectiveMaintenanceSource,
    };

    const p7Result = p7Calculate(p7Input);
    if (!p7Result) return fail("INSUFFICIENT_NUTRITION_DAYS", `${eligibleDayCount} eligible days in ${calDays}-day window is below the minimum.`, 422);

    // ── 7. Upsert the snapshot ───────────────────────────────────────────────
    const snapshotRow = {
      user_id:                         userId,
      goal_phase_id:                   phase.id,
      goal_mode:                       phase.mode,
      goal_phase_started_at:           phase.started_at,
      calculated_at:                   nowIso,
      analysis_window_start:           windowStart,
      analysis_window_end:             windowEnd,
      analysis_calendar_days:          calDays,
      selected_weight_window_days:     selectedWindow,
      timezone:                        tz,
      eligible_nutrition_day_count:    eligibleDayCount,
      probably_complete_day_count:     probablyComplDays,
      incomplete_day_count:            incompleteDays,
      not_logged_day_count:            notLoggedDays,
      eligible_nutrition_coverage:     p7Result.coverageFraction,
      average_intake_kcal:             avgIntake,
      weekly_rate_kg:                  weeklyRate!.estimate_kg,
      rate_lower_kg:                   weeklyRate!.lower_kg ?? null,
      rate_upper_kg:                   weeklyRate!.upper_kg ?? null,
      weight_trend_confidence:         p6Result.confidence,
      observed_maintenance_kcal:       p7Result.observedMaintenanceKcal,
      maintenance_lower_kcal:          p7Result.maintenanceLowerKcal,
      maintenance_upper_kcal:          p7Result.maintenanceUpperKcal,
      equation_estimated_tdee_kcal:    equationEstimatedTdeeKcal,
      manual_maintenance_override_kcal: manualMaintenanceOverrideKcal,
      effective_phase_maintenance_kcal: effectiveMaintenanceKcal,
      effective_phase_maintenance_source: effectiveMaintenanceSource,
      status:                          p7Result.status,
      confidence:                      p7Result.confidence,
      warnings:                        p7Result.warnings,
      algorithm_versions: {
        energy_balance:   ENERGY_BALANCE_VERSION,
        nutrition_quality: NUTRITION_QUALITY_VERSION,
        confidence:       CONFIDENCE_VERSION,
        weight_trend:     p6Result.algorithm_versions,
      },
      input_provenance: {
        weight_rows:      weightRows.length,
        weight_source:    "weight_logs",
        nutrition_source: "meal_items_snapshot",
        calculation_at:   nowIso,
      },
    };

    const { data: saved, error: saveErr } = await svc
      .from("maintenance_estimate_snapshots")
      .upsert(snapshotRow, {
        onConflict: "user_id,goal_phase_id,analysis_window_start,analysis_window_end",
        ignoreDuplicates: false,
      })
      .select("id, created_at")
      .single();

    if (saveErr) {
      console.error(JSON.stringify({ event: "snapshot_save_failed", error: String(saveErr) }));
      return fail("DB_ERROR", "Failed to save estimate snapshot.", 500);
    }

    return ok({
      snapshot_id:     (saved as { id: string; created_at: string }).id,
      created_at:      (saved as { id: string; created_at: string }).created_at,
      observed_maintenance_kcal: p7Result.observedMaintenanceKcal,
      confidence:      p7Result.confidence,
      status:          p7Result.status,
    });

  } catch (err) {
    console.error(JSON.stringify({ event: "top_level_error", error: String(err) }));
    return fail("INTERNAL_ERROR", "Unexpected error", 500);
  }
});
