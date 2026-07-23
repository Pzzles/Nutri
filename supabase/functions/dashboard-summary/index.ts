// dashboard-summary
// Today's totals vs. the currently-effective goal. See docs/02-prs.md
// FR-041 (goal versioning) and FR-050 (dashboard AC1: null, not 0%, when
// no goal is set).
//
// ADR-009: goal_phases is now the authoritative source for active phase data.
// user_goals is retained for backward compatibility but goal_phases takes
// precedence when an active phase exists.

import { ok, fail, preflight } from "../_shared/envelope.ts";
import { getUserClient, getServiceClient } from "../_shared/supabaseClient.ts";

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

    const service = getServiceClient();

    // Derive "today" in the user's own timezone so that the dashboard boundary
    // matches the logged_date stored at insert time.
    const { data: profile } = await service
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .single();
    const timezone = profile?.timezone ?? "UTC";
    const date =
      body?.date ??
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

    // Run independent queries in parallel.
    const [mealsResult, activePhaseResult, legacyGoalResult, dailyStatusResult] =
      await Promise.all([
        service
          .from("meals")
          .select("id, meal_items(calories, protein_g, carbs_g, fat_g, fibre_g)")
          .eq("user_id", userId)
          .eq("logged_date", date),
        // ADR-009: active goal phase (new authoritative model).
        service
          .from("goal_phases")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle(),
        // FR-041: legacy user_goals — still used as fallback when no active phase.
        service
          .from("user_goals")
          .select("target_calories, target_protein_g, target_carbs_g, target_fat_g")
          .eq("user_id", userId)
          .lte("effective_from", date)
          .order("effective_from", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Explicit daily log status for today. Never infer 'complete' from meals.
        service
          .from("daily_log_status")
          .select("status, marked_complete_at, reopened_at, updated_at")
          .eq("user_id", userId)
          .eq("logged_date", date)
          .maybeSingle(),
      ]);

    const meals = mealsResult.data ?? [];
    const activePhase = activePhaseResult.data ?? null;
    const legacyGoal = legacyGoalResult.data ?? null;

    const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
    for (const meal of meals) {
      for (const item of (meal as any).meal_items ?? []) {
        totals.calories += item.calories ?? 0;
        totals.protein_g += item.protein_g ?? 0;
        totals.carbs_g += item.carbs_g ?? 0;
        totals.fat_g += item.fat_g ?? 0;
        totals.fibre_g += item.fibre_g ?? 0;
      }
    }

    // Targets: prefer active phase, fall back to legacy user_goals.
    const targets = activePhase
      ? {
          target_calories: activePhase.target_calories,
          target_protein_g: activePhase.target_protein_g,
          target_carbs_g: activePhase.target_carbs_g,
          target_fat_g: activePhase.target_fat_g,
        }
      : legacyGoal;

    const percentOf = (consumed: number, target: number | null | undefined) =>
      target ? round((consumed / target) * 100) : null;

    // Observed weight change since phase started — no inference, no smoothing.
    // Only fetched when an active phase exists.
    let weight_change: {
      starting_weight_kg: number;
      latest_weight_kg: number | null;
      change_kg: number | null;
      days_in_phase: number;
    } | null = null;

    if (activePhase) {
      const { data: latestWeight } = await service
        .from("weight_logs")
        .select("weight_kg, measured_at")
        .eq("user_id", userId)
        .eq("is_official", true)
        .gte("measured_at", activePhase.started_at)
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const startMs = new Date(activePhase.started_at).getTime();
      const nowMs = Date.now();
      const daysInPhase = Math.floor((nowMs - startMs) / 86_400_000);

      weight_change = {
        starting_weight_kg: Number(activePhase.starting_weight_kg),
        latest_weight_kg: latestWeight ? Number(latestWeight.weight_kg) : null,
        change_kg:
          latestWeight != null
            ? round(Number(latestWeight.weight_kg) - Number(activePhase.starting_weight_kg))
            : null,
        days_in_phase: daysInPhase,
      };
    }

    // Daily log status — 'unknown' when no explicit row exists.
    // The status is NEVER inferred from meal count.
    const dailyStatus = dailyStatusResult.data
      ? {
          status: dailyStatusResult.data.status,
          marked_complete_at: dailyStatusResult.data.marked_complete_at,
          reopened_at: dailyStatusResult.data.reopened_at,
        }
      : { status: "unknown", marked_complete_at: null, reopened_at: null };

    // TODO: 7-day trend (FR-050 AC2) — query the trailing 7 logged_date
    // range and fill zero-meal days explicitly rather than leaving gaps.

    return ok({
      date,
      totals: {
        calories: round(totals.calories),
        protein_g: round(totals.protein_g),
        carbs_g: round(totals.carbs_g),
        fat_g: round(totals.fat_g),
        fibre_g: round(totals.fibre_g),
      },
      // Backward-compatible: `goal` still returned for clients using the old field.
      goal: targets ?? null,
      percent_of_goal: targets
        ? {
            calories: percentOf(totals.calories, targets.target_calories),
            protein_g: percentOf(totals.protein_g, targets.target_protein_g),
            carbs_g: percentOf(totals.carbs_g, targets.target_carbs_g),
            fat_g: percentOf(totals.fat_g, targets.target_fat_g),
          }
        : null, // FR-050 AC1: null, never 0%, when no goal is set.
      active_phase: activePhase,
      daily_log_status: dailyStatus,
      weight_change,
    });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error building dashboard summary", 500);
  }
});

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
