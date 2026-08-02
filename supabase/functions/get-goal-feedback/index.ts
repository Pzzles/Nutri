/**
 * get-goal-feedback
 *
 * GET /functions/v1/get-goal-feedback
 *
 * Returns a Phase 8 goal-progress assessment for the authenticated user.
 *
 * Calling sequence:
 *   authenticate (JWT only — no client-supplied user ID)
 *   → load active goal phase (mode + target rate)
 *   → load user timezone and Phase 5 snapshot
 *   → computeEvidence(asOf = now)       — current P6 + P7
 *   → computeEvidence(asOf = now − 14d) — historical P6 + P7
 *   → call pure assess()
 *   → return canonical response
 *
 * Authentication: Authorization: Bearer <jwt> — required.
 * User ID is derived from the verified JWT only.
 * This endpoint is READ-ONLY. No rows are mutated.
 * Server clock only — clients must not supply a calculation time.
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

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEZONE   = "Africa/Johannesburg";
const PAGE_SIZE          = 500;
const HISTORICAL_LAG_DAYS = 14;

// ── Types ─────────────────────────────────────────────────────────────────────

type GoalPhase = {
  id: string;
  mode: string;
  status: string;
  started_at: string;
  target_change_kg_per_week: number | null;
  manual_maintenance_kcal: number | null;
  snapshot_id: string | null;
};

type SnapshotRow = {
  calculated_tdee_kcal: number;
  manual_maintenance_kcal: number | null;
  effective_maintenance_kcal: number;
  maintenance_source: string;
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
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as SnapshotRow;
}

async function dbLoadWeightLogs(
  uid: string,
  since: string,
  until: string,
  svc: SupabaseClient,
): Promise<RawEntry[]> {
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
  return rows;
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
  const { data, error } = await svc.rpc("fn_get_daily_meal_totals", {
    p_user_id: uid,
    p_start:   start,
    p_end:     end,
  });
  if (error) throw new Error(`meal totals load failed: ${error.message}`);
  return (data ?? []) as MealDayTotal[];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function isValidIANATimezone(tz: string): boolean {
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; }
  catch { return false; }
}

function toLocalDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarDaysBetween(start: string, end: string): number {
  return Math.round(
    (new Date(end + "T12:00:00Z").getTime() - new Date(start + "T12:00:00Z").getTime()) / 86_400_000,
  ) + 1;
}

function maxDate(a: string, b: string): string { return a >= b ? a : b; }

// ── P6 + P7 evidence computation ──────────────────────────────────────────────

/**
 * Run the full P6+P7 calculation pipeline with a given reference timestamp.
 * All data is filtered to the date range [phaseStart, asOf].
 */
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

  // Load weight logs up to asOf (inclusive by local date)
  const weightRows = await dbLoadWeightLogs(uid, phaseStart, asOfLocal, svc);

  if (weightRows.length === 0) {
    return {
      p6Status: "insufficient_measurements", p6Confidence: "low", p6WeeklyRateKg: null,
      p7Status: null, p7Confidence: null, p7CoverageFraction: null,
    };
  }

  // P6 calculation with asOf as the reference point
  const p6Result  = p6Calculate(weightRows, asOfIso, tz);
  const p6Status  = p6Result.status;
  const p6Conf    = p6Result.confidence;
  const p6Rate    = p6Result.weekly_rate?.estimate_kg ?? null;

  // If P6 cannot produce a useful rate, skip P7
  if (
    p6Status === "stale" ||
    p6Status === "insufficient_measurements" ||
    p6Status === "insufficient_coverage" ||
    p6Rate === null
  ) {
    return { p6Status, p6Confidence: p6Conf, p6WeeklyRateKg: p6Rate,
             p7Status: null, p7Confidence: null, p7CoverageFraction: null };
  }

  const selectedWindow = p6Result.measurements.selected_rate_window_days;
  if (!selectedWindow) {
    return { p6Status, p6Confidence: p6Conf, p6WeeklyRateKg: p6Rate,
             p7Status: null, p7Confidence: null, p7CoverageFraction: null };
  }

  // Nutrition window aligned to P6 rate window, ending at yesterday relative to asOf
  const asOfYesterday = shiftDate(asOfLocal, -1);
  const rawWinStart   = shiftDate(asOfYesterday, -(selectedWindow - 1));
  const windowStart   = maxDate(rawWinStart, phaseStart);
  const windowEnd     = asOfYesterday;

  if (windowStart > windowEnd) {
    return { p6Status, p6Confidence: p6Conf, p6WeeklyRateKg: p6Rate,
             p7Status: "insufficient", p7Confidence: null, p7CoverageFraction: null };
  }

  const calDays = calendarDaysBetween(windowStart, windowEnd);

  const logStatusRows = await dbLoadDailyLogStatus(uid, windowStart, windowEnd, svc);
  const mealTotals    = await dbLoadMealDayTotals(uid, windowStart, windowEnd, svc);

  const statusMap = new Map<string, string>();
  const mealMap   = new Map<string, MealDayTotal>();
  for (const r of logStatusRows) statusMap.set(r.logged_date, r.status);
  for (const r of mealTotals) mealMap.set(r.logged_date, r);

  let completeDays = 0, fastingDays = 0, probablyComplDays = 0;
  const eligibleDates: string[] = [];
  const fastingDates: string[]  = [];

  let cur = windowStart;
  while (cur <= windowEnd) {
    const st = statusMap.get(cur) ?? "unknown";
    if (st === "complete") { completeDays++; eligibleDates.push(cur); }
    else if (st === "fasting") { fastingDays++; fastingDates.push(cur); eligibleDates.push(cur); }
    else if (st === "partial" || st === "probably_complete") {
      if (mealMap.has(cur)) probablyComplDays++;
    }
    cur = shiftDate(cur, 1);
  }

  const eligibleDayCount = completeDays + fastingDays;
  let totalKcal = 0;
  for (const d of eligibleDates) {
    totalKcal += fastingDates.includes(d) ? 0 : (mealMap.get(d)?.total_kcal ?? 0);
  }
  const avgIntake = eligibleDayCount > 0 ? totalKcal / eligibleDayCount : 0;

  const nutritionWarnings: string[] = [];
  if (probablyComplDays > 0) {
    nutritionWarnings.push(`${probablyComplDays} day(s) appear partially logged — excluded from average.`);
  }

  const p7Input: AdaptiveMaintenanceInput = {
    averageIntakeKcal:              avgIntake,
    eligibleDayCount,
    analysisCalendarDays:           calDays,
    probablyCompleteDayCount:       probablyComplDays,
    weeklyRateKg:                   p6Result.weekly_rate!.estimate_kg,
    rateLowerKg:                    p6Result.weekly_rate!.lower_kg ?? null,
    rateUpperKg:                    p6Result.weekly_rate!.upper_kg ?? null,
    weightTrendConfidence:          p6Conf,
    nutritionWarnings,
    goalPhaseId:                    phase.id,
    equationEstimatedTdeeKcal:      snapshot?.calculated_tdee_kcal ?? null,
    manualMaintenanceOverrideKcal:  phase.manual_maintenance_kcal ?? snapshot?.manual_maintenance_kcal ?? null,
    effectiveMaintenanceKcal:       snapshot?.effective_maintenance_kcal ?? null,
    effectiveMaintenanceSource:     snapshot?.maintenance_source ?? null,
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

// ── Injected deps for testability ─────────────────────────────────────────────

type FeedbackDeps = {
  now: () => Date;
  loadProfile:         (uid: string) => Promise<{ timezone: string | null }>;
  loadActiveGoalPhase: (uid: string) => Promise<GoalPhase | null>;
  loadSnapshot:        (id: string)  => Promise<SnapshotRow | null>;
  computeCurrentEvidence:    (uid: string, phase: GoalPhase, snap: SnapshotRow | null, tz: string, asOf: Date) => Promise<P67Evidence>;
  computeHistoricalEvidence: (uid: string, phase: GoalPhase, snap: SnapshotRow | null, tz: string, asOf: Date) => Promise<P67Evidence>;
};

// ── Core handler ──────────────────────────────────────────────────────────────

export async function handleGetGoalFeedback(
  req: Request,
  deps: FeedbackDeps,
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
      progress_state:  "no_active_goal_phase",
      feedback_action: "start_goal_phase",
      reason_codes:    ["no_active_phase"],
      message:         "No active goal phase found. Start a goal phase to track your progress.",
      assessed_at:     deps.now().toISOString(),
    });
  }

  // ── 4. Load Phase 5 snapshot ──────────────────────────────────────────────
  let snapshot: SnapshotRow | null = null;
  if (phase.snapshot_id) {
    snapshot = await deps.loadSnapshot(phase.snapshot_id);
  }

  // ── 5. Compute current evidence ───────────────────────────────────────────
  const now        = deps.now();
  const currentEv  = await deps.computeCurrentEvidence(userId, phase, snapshot, tz, now);

  // ── 6. Compute historical evidence (14 days ago) ──────────────────────────
  const asOf14       = new Date(now.getTime() - HISTORICAL_LAG_DAYS * 86_400_000);
  const historicalEv = await deps.computeHistoricalEvidence(userId, phase, snapshot, tz, asOf14);

  // ── 7. Assess progress ────────────────────────────────────────────────────
  const input: GoalProgressInput = {
    goalMode:                  phase.mode as "cut" | "maintenance" | "bulk",
    goalTargetRateKgPerWeek:   phase.target_change_kg_per_week ?? null,
    goalPhaseStartedAt:        phase.started_at,
    assessedAt:                now.toISOString(),
    currentP6Status:           currentEv.p6Status,
    currentP6Confidence:       currentEv.p6Confidence,
    currentP6WeeklyRateKg:     currentEv.p6WeeklyRateKg,
    currentP7Status:           currentEv.p7Status,
    currentP7Confidence:       currentEv.p7Confidence,
    currentP7CoverageFraction: currentEv.p7CoverageFraction,
    historicalP6Status:        historicalEv.p6Status,
    historicalP6Confidence:    historicalEv.p6Confidence,
    historicalP6WeeklyRateKg:  historicalEv.p6WeeklyRateKg,
    historicalP7Status:        historicalEv.p7Status,
    historicalP7Confidence:    historicalEv.p7Confidence,
    historicalP7CoverageFraction: historicalEv.p7CoverageFraction,
  };

  const assessment = assess(input);

  // ── 8. Build response ─────────────────────────────────────────────────────
  return ok({
    progress_state:                    assessment.state,
    feedback_action:                   assessment.feedbackAction,
    reason_codes:                      assessment.reasonCodes,
    advisory_calorie_adjustment_kcal:  assessment.advisoryCalorieAdjustmentKcal,
    advisory_adjustment_direction:     assessment.advisoryAdjustmentDirection,
    goal_attainment_ratio:             assessment.goalAttainmentRatio,

    goal_phase: {
      id:                        phase.id,
      mode:                      phase.mode,
      started_at:                phase.started_at,
      target_rate_kg_per_week:   phase.target_change_kg_per_week ?? null,
    },

    evidence: {
      current: {
        p6_status:             currentEv.p6Status,
        p6_confidence:         currentEv.p6Confidence,
        p6_weekly_rate_kg:     currentEv.p6WeeklyRateKg,
        p7_status:             currentEv.p7Status,
        p7_confidence:         currentEv.p7Confidence,
        p7_coverage_fraction:  currentEv.p7CoverageFraction,
      },
      historical_14d: {
        p6_status:             historicalEv.p6Status,
        p6_confidence:         historicalEv.p6Confidence,
        p6_weekly_rate_kg:     historicalEv.p6WeeklyRateKg,
        p7_status:             historicalEv.p7Status,
        p7_confidence:         historicalEv.p7Confidence,
        p7_coverage_fraction:  historicalEv.p7CoverageFraction,
      },
    },

    assessed_at: now.toISOString(),

    algorithm_versions: {
      goal_progress:    GOAL_PROGRESS_VERSION,
      goal_thresholds:  GOAL_THRESHOLDS_VERSION,
      energy_balance:   ENERGY_BALANCE_VERSION,
      nutrition_quality: NUTRITION_QUALITY_VERSION,
      confidence:       CONFIDENCE_VERSION,
    },

    warnings:    assessment.warnings,
    limitations: assessment.limitations,
  });
}

// ── Deno entry point ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const svc  = getServiceClient();
    const deps: FeedbackDeps = {
      now:                 () => new Date(),
      loadProfile:         (uid) => dbLoadProfile(uid, svc),
      loadActiveGoalPhase: (uid) => dbLoadActiveGoalPhase(uid, svc),
      loadSnapshot:        (id)  => dbLoadSnapshot(id, svc),
      computeCurrentEvidence:    (uid, phase, snap, tz, asOf) =>
        computeEvidence(uid, phase, snap, tz, asOf, svc),
      computeHistoricalEvidence: (uid, phase, snap, tz, asOf) =>
        computeEvidence(uid, phase, snap, tz, asOf, svc),
    };
    return handleGetGoalFeedback(req, deps);
  } catch (err) {
    console.error(JSON.stringify({ event: "top_level_error", error: String(err) }));
    return fail("INTERNAL_ERROR", "Unexpected error", 500);
  }
});
