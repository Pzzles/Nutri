/**
 * get-adaptive-maintenance
 *
 * GET /functions/v1/get-adaptive-maintenance
 *
 * Returns a Phase 7 observed-maintenance estimate for the authenticated user.
 *
 * Calling sequence:
 *   authenticate
 *   → load active goal phase + snapshot (equation estimate / manual override)
 *   → load user timezone
 *   → load weight logs since goal-phase start
 *   → run canonical Phase 6 calculate() on goal-phase weight data
 *   → derive aligned analysis window (same calendar period as weight rate)
 *   → load daily_log_status for the window
 *   → aggregate meal calories for eligible (complete + fasting) days
 *   → classify nutrition quality
 *   → call pure adaptiveMaintenance.calculate()
 *   → return canonical response
 *
 * Authentication: Authorization: Bearer <jwt> — required.
 * User ID is derived from the verified JWT only; never from query params.
 * This endpoint is read-only. No rows are mutated.
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

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const PAGE_SIZE        = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

type GoalPhase = {
  id: string;
  mode: string;
  status: string;
  started_at: string;
  manual_maintenance_kcal: number | null;
  snapshot_id: string | null;
};

type SnapshotRow = {
  calculated_tdee_kcal: number;
  manual_maintenance_kcal: number | null;
  effective_maintenance_kcal: number;
  maintenance_source: string;
};

type DailyLogRow = {
  logged_date: string;  // "YYYY-MM-DD"
  status: string;
};

type MealDayTotal = {
  logged_date: string;
  total_kcal: number;
  meal_count: number;
  item_count: number;
};

// ── Injected deps for testability ─────────────────────────────────────────────

type MaintenanceDeps = {
  now: () => Date;
  loadProfile:          (uid: string) => Promise<{ timezone: string | null }>;
  loadActiveGoalPhase:  (uid: string) => Promise<GoalPhase | null>;
  loadSnapshot:         (snapshotId: string) => Promise<SnapshotRow | null>;
  loadWeightLogs:       (uid: string, since: string) => Promise<{ rows: RawEntry[] }>;
  loadDailyLogStatus:   (uid: string, start: string, end: string) => Promise<DailyLogRow[]>;
  loadMealDayTotals:    (uid: string, start: string, end: string) => Promise<MealDayTotal[]>;
};

// ── Database helpers ──────────────────────────────────────────────────────────

async function dbLoadProfile(uid: string, svc: SupabaseClient) {
  const { data } = await svc
    .from("profiles")
    .select("timezone")
    .eq("id", uid)
    .single();
  return { timezone: (data as { timezone?: string | null })?.timezone ?? null };
}

async function dbLoadActiveGoalPhase(uid: string, svc: SupabaseClient): Promise<GoalPhase | null> {
  const { data, error } = await svc
    .from("goal_phases")
    .select("id, mode, status, started_at, manual_maintenance_kcal, snapshot_id")
    .eq("user_id", uid)
    .eq("status", "active")
    .single();
  if (error || !data) return null;
  return data as GoalPhase;
}

async function dbLoadSnapshot(snapshotId: string, svc: SupabaseClient): Promise<SnapshotRow | null> {
  const { data, error } = await svc
    .from("calorie_target_snapshots")
    .select("calculated_tdee_kcal, manual_maintenance_kcal, effective_maintenance_kcal, maintenance_source")
    .eq("id", snapshotId)
    .single();
  if (error || !data) return null;
  return data as SnapshotRow;
}

async function dbLoadWeightLogs(
  uid: string,
  since: string,
  svc: SupabaseClient,
): Promise<{ rows: RawEntry[] }> {
  const rows: RawEntry[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await svc
      .from("weight_logs")
      .select("measured_at, weight_kg, is_official")
      .eq("user_id", uid)
      .gte("logged_date", since)
      .order("measured_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`weight_logs load failed: ${error.message}`);
    for (const r of (data ?? [])) {
      rows.push({
        measured_at: r.measured_at as string,
        weight_kg:   Number(r.weight_kg),
        is_official: r.is_official as boolean,
      });
    }
    if ((data?.length ?? 0) < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { rows };
}

async function dbLoadDailyLogStatus(
  uid: string,
  start: string,
  end: string,
  svc: SupabaseClient,
): Promise<DailyLogRow[]> {
  const { data, error } = await svc
    .from("daily_log_status")
    .select("logged_date, status")
    .eq("user_id", uid)
    .gte("logged_date", start)
    .lte("logged_date", end)
    .order("logged_date", { ascending: true });
  if (error) throw new Error(`daily_log_status load failed: ${error.message}`);
  return (data ?? []) as DailyLogRow[];
}

async function dbLoadMealDayTotals(
  uid: string,
  start: string,
  end: string,
  svc: SupabaseClient,
): Promise<MealDayTotal[]> {
  // Aggregate meal_item calories per day using a PostgREST RPC call.
  // We do it as a raw join via rpc to avoid N+1 queries.
  const { data, error } = await svc.rpc("fn_get_daily_meal_totals", {
    p_user_id:  uid,
    p_start:    start,
    p_end:      end,
  });
  if (error) throw new Error(`meal totals load failed: ${error.message}`);
  return (data ?? []) as MealDayTotal[];
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

function isValidIANATimezone(tz: string): boolean {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; }
  catch { return false; }
}

/** Return the local calendar date string ("YYYY-MM-DD") for a given Date. */
function toLocalDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone:   tz,
    year:       "numeric",
    month:      "2-digit",
    day:        "2-digit",
  }).format(d);
}

/** Add/subtract calendar days to a "YYYY-MM-DD" string. */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Number of calendar days between two "YYYY-MM-DD" strings (inclusive). */
function calendarDaysBetween(startStr: string, endStr: string): number {
  const start = new Date(startStr + "T12:00:00Z");
  const end   = new Date(endStr   + "T12:00:00Z");
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** max of two "YYYY-MM-DD" strings. */
function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

// ── Core handler ──────────────────────────────────────────────────────────────

export async function handleGetAdaptiveMaintenance(
  req: Request,
  deps: MaintenanceDeps,
): Promise<Response> {

  // ── 1. Authenticate ───────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("UNAUTHENTICATED", "Missing Authorization header", 401);

  const userClient = getUserClient(authHeader);
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return fail("UNAUTHENTICATED", "Invalid or expired session", 401);

  const userId = userData.user.id;

  // ── 2. Load user timezone ─────────────────────────────────────────────────
  const profile = await deps.loadProfile(userId);
  const rawTz   = profile.timezone ?? DEFAULT_TIMEZONE;
  const tz      = isValidIANATimezone(rawTz) ? rawTz : DEFAULT_TIMEZONE;

  // ── 3. Load active goal phase ─────────────────────────────────────────────
  const phase = await deps.loadActiveGoalPhase(userId);
  if (!phase) {
    return ok({
      status: "no_active_goal_phase",
      message: "No active goal phase found. Start a goal phase to begin tracking your observed maintenance.",
    });
  }

  // The goal-phase start date in the user's local calendar.
  const phaseStartDate = toLocalDate(new Date(phase.started_at), tz);

  // ── 4. Load Phase 5 equation estimate and manual override ─────────────────
  let snapshot: SnapshotRow | null = null;
  if (phase.snapshot_id) {
    snapshot = await deps.loadSnapshot(phase.snapshot_id);
  }

  const equationEstimatedTdeeKcal      = snapshot?.calculated_tdee_kcal ?? null;
  const manualMaintenanceOverrideKcal  = phase.manual_maintenance_kcal ?? snapshot?.manual_maintenance_kcal ?? null;
  const effectiveMaintenanceKcal       = snapshot?.effective_maintenance_kcal ?? null;
  const effectiveMaintenanceSource     = snapshot?.maintenance_source ?? null;

  // ── 5. Load weight logs since goal-phase start ────────────────────────────
  const { rows: weightRows } = await deps.loadWeightLogs(userId, phaseStartDate);
  if (weightRows.length === 0) {
    return ok({
      status: "insufficient_weight_data",
      message: "No weight measurements found in the current goal phase.",
      goal_phase: { id: phase.id, mode: phase.mode, started_at: phase.started_at },
    });
  }

  // ── 6. Run Phase 6 canonical calculate() ─────────────────────────────────
  const nowIso    = deps.now().toISOString();
  const p6Result  = p6Calculate(weightRows, nowIso, tz);

  if (p6Result.status === "insufficient") {
    return ok({
      status: "insufficient_weight_data",
      message: "Not enough weight measurements in the current goal phase to estimate a rate.",
      goal_phase: { id: phase.id, mode: phase.mode, started_at: phase.started_at },
    });
  }

  if (p6Result.status === "stale") {
    return ok({
      status: "stale_weight_data",
      message: "Your recent weight data is too old to estimate current maintenance reliably. Please log a new weight.",
      goal_phase: { id: phase.id, mode: phase.mode, started_at: phase.started_at },
    });
  }

  const weeklyRate = p6Result.weekly_rate;
  if (!weeklyRate || weeklyRate.estimate_kg === null) {
    return ok({
      status: "insufficient_weight_data",
      message: "A rate estimate could not be calculated from your current weight data.",
      goal_phase: { id: phase.id, mode: phase.mode, started_at: phase.started_at },
    });
  }

  const selectedWindow = p6Result.measurements.selected_rate_window_days;
  if (!selectedWindow) {
    return ok({
      status: "insufficient_weight_data",
      message: "Phase 6 did not select a rate window.",
      goal_phase: { id: phase.id, mode: phase.mode, started_at: phase.started_at },
    });
  }

  // ── 7. Derive aligned analysis window ────────────────────────────────────
  // Window end = yesterday in user's timezone (exclude current partial day).
  const todayStr     = toLocalDate(deps.now(), tz);
  const yesterdayStr = shiftDate(todayStr, -1);

  // Window start = yesterday − (selectedWindow − 1 days), clipped to goal phase start.
  const rawWindowStart  = shiftDate(yesterdayStr, -(selectedWindow - 1));
  const windowStartStr  = maxDate(rawWindowStart, phaseStartDate);
  const windowEndStr    = yesterdayStr;
  const calendarDays    = calendarDaysBetween(windowStartStr, windowEndStr);

  // ── 8. Load daily log status for the window ───────────────────────────────
  const logStatusRows = await deps.loadDailyLogStatus(userId, windowStartStr, windowEndStr);

  // Build a map date → status for O(1) lookup.
  const statusMap = new Map<string, string>();
  for (const row of logStatusRows) {
    statusMap.set(row.logged_date, row.status);
  }

  // Classify each day in the window.
  let completeDays         = 0;
  let fastingDays          = 0;
  let probablyCompleteDays = 0;
  let incompleteDays       = 0;
  let notLoggedDays        = 0;

  const eligibleDates: string[]    = [];
  const fastingDates: string[]     = [];

  let current = windowStartStr;
  while (current <= windowEndStr) {
    const status = statusMap.get(current) ?? "unknown";
    if (status === "complete") {
      completeDays++;
      eligibleDates.push(current);
    } else if (status === "fasting") {
      fastingDays++;
      fastingDates.push(current);
      eligibleDates.push(current);
    } else if (status === "probably_complete" || status === "partial") {
      // We'll refine after loading meal totals (partial + has meals = probably_complete)
      probablyCompleteDays++;
    } else {
      notLoggedDays++;
    }
    current = shiftDate(current, 1);
  }

  // ── 9. Load meal day totals for complete days ─────────────────────────────
  const mealTotals = await deps.loadMealDayTotals(userId, windowStartStr, windowEndStr);
  const mealMap = new Map<string, MealDayTotal>();
  for (const row of mealTotals) {
    mealMap.set(row.logged_date, row);
  }

  // Refine probably_complete count: partial days with actual meals logged.
  // (Reset and recount to avoid double-counting.)
  probablyCompleteDays = 0;
  incompleteDays       = 0;

  current = windowStartStr;
  while (current <= windowEndStr) {
    const status = statusMap.get(current) ?? "unknown";
    if (status === "partial" || status === "probably_complete") {
      if (mealMap.has(current)) {
        probablyCompleteDays++;
      } else {
        incompleteDays++;
      }
    }
    current = shiftDate(current, 1);
  }

  // ── 10. Compute average eligible intake ───────────────────────────────────
  const eligibleDayCount = completeDays + fastingDays;

  let totalEligibleKcal = 0;
  for (const date of eligibleDates) {
    if (fastingDates.includes(date)) {
      // Explicit fasting = zero calories.
      totalEligibleKcal += 0;
    } else {
      const meal = mealMap.get(date);
      totalEligibleKcal += meal?.total_kcal ?? 0;
    }
  }
  const averageIntakeKcal =
    eligibleDayCount > 0 ? totalEligibleKcal / eligibleDayCount : 0;

  // ── 11. Build nutrition warnings ──────────────────────────────────────────
  const nutritionWarnings: string[] = [];
  if (probablyCompleteDays > 0) {
    nutritionWarnings.push(
      `${probablyCompleteDays} day(s) appear partially logged but are not marked complete — they are excluded from the average.`,
    );
  }

  // ── 12. Call pure adaptive-maintenance calculation ────────────────────────
  const p7Input: AdaptiveMaintenanceInput = {
    averageIntakeKcal,
    eligibleDayCount,
    analysisCalendarDays: calendarDays,
    probablyCompleteDayCount: probablyCompleteDays,
    weeklyRateKg:           weeklyRate.estimate_kg,
    rateLowerKg:            weeklyRate.lower_kg ?? null,
    rateUpperKg:            weeklyRate.upper_kg ?? null,
    weightTrendConfidence:  p6Result.confidence,
    nutritionWarnings,
    goalPhaseId:            phase.id,
    equationEstimatedTdeeKcal,
    manualMaintenanceOverrideKcal,
    effectiveMaintenanceKcal,
    effectiveMaintenanceSource,
  };

  const p7Result = p7Calculate(p7Input);

  // No authoritative estimate possible.
  if (!p7Result) {
    return ok({
      status: "insufficient_nutrition_days",
      message: `More complete food-log days are needed before your observed maintenance can be estimated. ${eligibleDayCount} of ${calendarDays} days confirmed complete.`,
      goal_phase:       { id: phase.id, mode: phase.mode, started_at: phase.started_at },
      analysis_window:  { start: windowStartStr, end: windowEndStr, calendar_days: calendarDays },
      nutrition: {
        eligible_days:         eligibleDayCount,
        probably_complete_days: probablyCompleteDays,
        incomplete_days:       incompleteDays,
        not_logged_days:       notLoggedDays,
        coverage_fraction:     eligibleDayCount / calendarDays,
      },
    });
  }

  // ── 13. Build structured response ────────────────────────────────────────
  return ok({
    status:     p7Result.status,
    confidence: p7Result.confidence,
    timezone:   tz,

    goal_phase: {
      id:         phase.id,
      mode:       phase.mode,
      started_at: phase.started_at,
    },

    analysis_window: {
      start:                      windowStartStr,
      end:                        windowEndStr,
      calendar_days:              calendarDays,
      selected_weight_window_days: selectedWindow,
    },

    nutrition: {
      eligible_days:          eligibleDayCount,
      probably_complete_days: probablyCompleteDays,
      incomplete_days:        incompleteDays,
      not_logged_days:        notLoggedDays,
      coverage_fraction:      p7Result.coverageFraction,
      average_intake_kcal:    averageIntakeKcal,
    },

    weight_trend: {
      weekly_rate_kg: weeklyRate.estimate_kg,
      lower_kg:       weeklyRate.lower_kg ?? null,
      upper_kg:       weeklyRate.upper_kg ?? null,
      confidence:     p6Result.confidence,
    },

    maintenance: {
      equation_estimate_kcal:      equationEstimatedTdeeKcal,
      manual_override_kcal:        manualMaintenanceOverrideKcal,
      effective_phase_value_kcal:  effectiveMaintenanceKcal,
      effective_phase_source:      effectiveMaintenanceSource,
      observed_estimate_kcal:      p7Result.observedMaintenanceKcal,
      lower_kcal:                  p7Result.maintenanceLowerKcal,
      upper_kcal:                  p7Result.maintenanceUpperKcal,
      observed_minus_equation_kcal:  p7Result.observedMinusEquationKcal,
      observed_minus_effective_kcal: p7Result.observedMinusEffectiveKcal,
    },

    algorithm_versions: {
      weight_trend:    p6Result.algorithm_versions,
      energy_balance:  ENERGY_BALANCE_VERSION,
      nutrition_quality: NUTRITION_QUALITY_VERSION,
      confidence:      CONFIDENCE_VERSION,
    },

    warnings:    p7Result.warnings,
    limitations: p7Result.limitations,
  });
}

// ── Deno entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const svc  = getServiceClient();
    const deps: MaintenanceDeps = {
      now:                () => new Date(),
      loadProfile:        (uid) => dbLoadProfile(uid, svc),
      loadActiveGoalPhase:(uid) => dbLoadActiveGoalPhase(uid, svc),
      loadSnapshot:       (id)  => dbLoadSnapshot(id, svc),
      loadWeightLogs:     (uid, since) => dbLoadWeightLogs(uid, since, svc),
      loadDailyLogStatus: (uid, s, e)  => dbLoadDailyLogStatus(uid, s, e, svc),
      loadMealDayTotals:  (uid, s, e)  => dbLoadMealDayTotals(uid, s, e, svc),
    };
    return handleGetAdaptiveMaintenance(req, deps);
  } catch (err) {
    console.error(JSON.stringify({ event: "top_level_error", error: String(err) }));
    return fail("INTERNAL_ERROR", "Unexpected error", 500);
  }
});
