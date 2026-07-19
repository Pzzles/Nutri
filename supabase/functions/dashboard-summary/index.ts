// dashboard-summary
// Today's totals vs. the currently-effective goal. See docs/02-prs.md
// FR-041 (goal versioning) and FR-050 (dashboard AC1: null, not 0%, when
// no goal is set).

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
    // matches the logged_date stored at insert time (also derived from profile
    // timezone in log-meal). Without this, SA users see yesterday's data for
    // the first two hours after midnight (Africa/Johannesburg is UTC+2).
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

    const { data: meals } = await service
      .from("meals")
      .select("id, meal_items(calories, protein_g, carbs_g, fat_g, fibre_g)")
      .eq("user_id", userId)
      .eq("logged_date", date);

    const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 };
    for (const meal of meals ?? []) {
      for (const item of (meal as any).meal_items ?? []) {
        totals.calories += item.calories ?? 0;
        totals.protein_g += item.protein_g ?? 0;
        totals.carbs_g += item.carbs_g ?? 0;
        totals.fat_g += item.fat_g ?? 0;
        totals.fibre_g += item.fibre_g ?? 0;
      }
    }

    // FR-041: goal-in-effect for a date = most recent row where
    // effective_from <= date.
    const { data: goal } = await service
      .from("user_goals")
      .select("target_calories, target_protein_g, target_carbs_g, target_fat_g")
      .eq("user_id", userId)
      .lte("effective_from", date)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    const percentOf = (consumed: number, target: number | null | undefined) =>
      target ? round((consumed / target) * 100) : null;

    // TODO: 7-day trend (FR-050 AC2) — query the trailing 7 logged_date
    // range and fill zero-meal days explicitly rather than leaving gaps.
    // Left as a follow-up; "today" is fully correct as implemented.

    return ok({
      date,
      totals: {
        calories: round(totals.calories),
        protein_g: round(totals.protein_g),
        carbs_g: round(totals.carbs_g),
        fat_g: round(totals.fat_g),
        fibre_g: round(totals.fibre_g),
      },
      goal: goal ?? null,
      percent_of_goal: goal
        ? {
            calories: percentOf(totals.calories, goal.target_calories),
            protein_g: percentOf(totals.protein_g, goal.target_protein_g),
            carbs_g: percentOf(totals.carbs_g, goal.target_carbs_g),
            fat_g: percentOf(totals.fat_g, goal.target_fat_g),
          }
        : null, // FR-050 AC1: null, never 0%, when no goal is set.
    });
  } catch (err) {
    console.error(err);
    return fail("INTERNAL_ERROR", "Unexpected error building dashboard summary", 500);
  }
});

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
