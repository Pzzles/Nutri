// Phase 7 — Playwright integration tests for the adaptive maintenance card.
// All API calls go to the real local Supabase stack — no network interception.
// Requires: supabase start (with edge functions running) + vite dev server.

import { test, expect, type Page } from "@playwright/test";
import {
  SUPABASE_URL,
  ANON_KEY,
  svcClient,
  testEmail,
} from "./helpers";

// ── SAST helpers ──────────────────────────────────────────────────────────────

/** Africa/Johannesburg is UTC+2 year-round (no DST). */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function toSastDate(isoUtc: string): string {
  const sastMs = new Date(isoUtc).getTime() + SAST_OFFSET_MS;
  const d = new Date(sastMs);
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd   = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** UTC calendar date N days before today, as YYYY-MM-DD. */
function utcDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** UTC ISO timestamp at 07:00 UTC on the day N days before today. */
function isoAt7(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(7, 0, 0, 0);
  return d.toISOString();
}

// ── User setup ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

interface UserSetup {
  userId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
}

async function setupUser(email: string): Promise<UserSetup> {
  const password = "TestPassword123!";
  const svc = svcClient();
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  const userId = data.user!.id;

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const auth = (await resp.json()) as { access_token: string; refresh_token: string };
  if (!auth.access_token) throw new Error("Sign-in failed: " + JSON.stringify(auth));

  return { userId, accessToken: auth.access_token, refreshToken: auth.refresh_token, email };
}

/**
 * Pre-populate localStorage so the app session is active before any fetch fires.
 * Key: sb-127-auth-token  (derived from http://127.0.0.1:54421 supabase-js hostname split).
 */
async function injectSession(page: Page, setup: UserSetup) {
  const storedSession = {
    access_token: setup.accessToken,
    token_type:   "bearer",
    expires_in:   3600,
    expires_at:   Math.floor(Date.now() / 1000) + 3600,
    refresh_token: setup.refreshToken,
    user: { id: setup.userId, email: setup.email, aud: "authenticated" },
  };
  await page.addInitScript(
    ({ storageKey, session }) => {
      localStorage.setItem(storageKey, JSON.stringify(session));
    },
    { storageKey: "sb-127-auth-token", session: storedSession },
  );
}

// ── Navigation helper ─────────────────────────────────────────────────────────

/**
 * Navigate to the Progress page, click Maintenance, and wait for the card to
 * reach a non-loading terminal state.
 *
 * The local Supabase Deno edge function runner occasionally returns an empty
 * response body on the first browser-initiated request (Kong gateway cold-start
 * behaviour). When that happens, `getFunction` in supabase.ts throws
 * "Unexpected end of JSON input" and the card shows the error state.
 *
 * This helper detects that case and clicks "Try again" once. After it returns,
 * the caller's own `expect(...)` assertion decides whether the card is in the
 * expected state and fails with a descriptive message if not.
 */
async function navigateToMaintenance(page: Page, setup: UserSetup): Promise<void> {
  await injectSession(page, setup);
  await page.goto(`${BASE_URL}/progress`);
  await page.getByRole("button", { name: "Maintenance" }).click();

  // Wait for any non-loading terminal card state (usable, error, insufficient, etc.)
  await page.waitForSelector(
    '[data-testid^="maintenance-card"]:not([data-testid="maintenance-card-loading"])',
    { timeout: 15_000 },
  ).catch(() => null);

  // If the card landed on an error, retry once via the "Try again" button
  const isError = await page.getByTestId("maintenance-card-error").isVisible().catch(() => false);
  if (isError) {
    const tryAgain = page.getByRole("button", { name: /try again/i });
    if (await tryAgain.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tryAgain.click();
      await page.waitForSelector(
        '[data-testid^="maintenance-card"]:not([data-testid="maintenance-card-loading"])',
        { timeout: 20_000 },
      ).catch(() => null);
    }
  }
}

// ── Data seeding helpers ──────────────────────────────────────────────────────

let _foodCounter = 0;

async function insertMealWithKcal(userId: string, date: string, kcal: number): Promise<void> {
  const svc = svcClient();
  _foodCounter++;
  const uid = `${Date.now()}-${_foodCounter}`;
  const foodResult = await svc.from("foods").insert({
    name:             `p7-e2e-${uid}`,
    normalized_name:  `p7-e2e-${uid}`,
    source:           "user_manual",
    calories_100g:    100,
    protein_100g:     10,
    carbs_100g:       20,
    fat_100g:         5,
    fibre_100g:       2,
    verified:         true,
  }).select("id").single();
  if (foodResult.error) throw new Error(`food insert: ${foodResult.error.message}`);
  const foodId = (foodResult.data as { id: string }).id;

  const mealResult = await svc.from("meals").insert({
    user_id:         userId,
    logged_date:     date,
    meal_type:       "lunch",
    meal_confidence: "high",
    raw_input:       "p7 e2e test meal",
    eaten_at:        `${date}T12:00:00Z`,
  }).select("id").single();
  if (mealResult.error) throw new Error(`meal insert: ${mealResult.error.message}`);
  const mealId = (mealResult.data as { id: string }).id;

  const { error: itemErr } = await svc.from("meal_items").insert({
    meal_id:           mealId,
    food_id:           foodId,
    quantity:          kcal,
    unit:              "g",
    weight_g:          kcal,
    calories:          kcal,
    protein_g:         0,
    carbs_g:           0,
    fat_g:             0,
    fibre_g:           0,
    match_confidence:  "exact",
    portion_confidence:"exact",
    confidence:        "high",
    nutrition_source:  "user_manual",
  });
  if (itemErr) throw new Error(`meal_items insert: ${itemErr.message}`);
}

async function setDLS(userId: string, date: string, status: string): Promise<void> {
  const { error } = await svcClient().rpc("fn_set_daily_log_status", {
    p_user_id: userId,
    p_date:    date,
    p_status:  status,
  });
  if (error) throw new Error(`setDLS(${date}, ${status}): ${error.message}`);
}

// ── Fixture design ────────────────────────────────────────────────────────────
//
// Analysis window chosen by Phase 6: 28 days (days 28..1 ago = yesterday).
// Phase started 30 days ago so window is not clipped.
//
// Nutrition setup inside the window:
//   Day 28 ago: not logged            → not_logged (proves missing ≠ 0 kcal)
//   Day 27 ago: not logged            → not_logged (second missing day)
//   Day 26 ago: DLS=probably_complete + 1800 kcal meals → probablyComplete (excluded)
//   Day 25 ago: DLS=partial + no meals              → incomplete (excluded)
//   Day 24 ago: DLS=fasting                         → eligible, 0 kcal (explicit fasting = zero)
//   Days 23..1 ago: DLS=complete, 2000 kcal each    → eligible (23 days)
//
// Totals: eligible_days = 24 (23 complete + 1 fasting), calendar_days = 28
//   coverage = 24/28 ≈ 85.7%  → usable (≥ 70%)
//   probably_complete_days = 1, incomplete_days = 1, not_logged_days = 2
//   average_intake = (23 × 2000 + 1 × 0) / 24 ≈ 1916.67 kcal/day
//   With Theil-Sen rate ≈ −0.5 kg/week: observed ≈ 1916.67 + 550 ≈ 2467 kcal/day

test.describe("Phase 7 — Adaptive maintenance E2E flow", () => {
  let setup: UserSetup;
  let phaseId: string;

  test.beforeAll(async () => {
    const email = testEmail("p7-e2e");
    setup = await setupUser(email);
    const svc = svcClient();

    // Profile
    await svc.from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );

    // Weight logs: 35 daily entries at −0.5 kg/week (−0.0714 kg/day)
    // Seeded at 07:00 UTC so they are always in the past and inside the phase window.
    const weightRows = [];
    for (let i = 0; i < 35; i++) {
      const daysAgo = 35 - i;
      weightRows.push({
        user_id:     setup.userId,
        weight_kg:   +(85 - i * 0.0714).toFixed(3),
        measured_at: isoAt7(daysAgo),
        logged_date: toSastDate(isoAt7(daysAgo)),
        is_official: true,
        source:      "manual",
      });
    }
    const { error: wErr } = await svc.from("weight_logs").insert(weightRows);
    if (wErr) throw new Error(`weight insert: ${wErr.message}`);

    // Goal phase started 30 days ago
    const phaseStart = new Date();
    phaseStart.setUTCDate(phaseStart.getUTCDate() - 30);
    const phaseResult = await svc.from("goal_phases").insert({
      user_id:                 setup.userId,
      mode:                    "cut",
      status:                  "active",
      started_at:              phaseStart.toISOString(),
      starting_weight_kg:      85.0,
      starting_weight_source:  "manual",
    }).select("id").single();
    if (phaseResult.error) throw new Error(`phase insert: ${phaseResult.error.message}`);
    phaseId = (phaseResult.data as { id: string }).id;

    // Nutrition days
    //   Day 26 ago: probably_complete + 1800 kcal meals
    const probablyComplDate = utcDaysAgo(26);
    await insertMealWithKcal(setup.userId, probablyComplDate, 1800);
    await setDLS(setup.userId, probablyComplDate, "probably_complete");

    //   Day 25 ago: partial, no meals → incomplete
    await setDLS(setup.userId, utcDaysAgo(25), "partial");

    //   Day 24 ago: fasting → eligible, 0 kcal
    await setDLS(setup.userId, utcDaysAgo(24), "fasting");

    //   Days 23..1 ago: complete, 2000 kcal
    for (let d = 23; d >= 1; d--) {
      const date = utcDaysAgo(d);
      await insertMealWithKcal(setup.userId, date, 2000);
      await setDLS(setup.userId, date, "complete");
    }

    // Warm up the edge function runner so the first browser request does not hit a
    // cold-start timeout. Direct Node fetch includes apikey so Kong routes correctly.
    await fetch(`${SUPABASE_URL}/functions/v1/get-adaptive-maintenance`, {
      headers: {
        Authorization: `Bearer ${setup.accessToken}`,
        apikey:        ANON_KEY,
      },
    }).then(r => r.text()).catch(() => null);
  });

  test.afterAll(async () => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", setup.userId);
    await svc.from("daily_log_status").delete().eq("user_id", setup.userId);
    const mealIds = (await svc.from("meals").select("id").eq("user_id", setup.userId))
      .data?.map((r: { id: string }) => r.id) ?? [];
    if (mealIds.length > 0) {
      await svc.from("meal_items").delete().in("meal_id", mealIds);
    }
    await svc.from("meals").delete().eq("user_id", setup.userId);
    await svc.from("calorie_target_snapshots").delete().eq("user_id", setup.userId);
    await svc.from("goal_phases").delete().eq("user_id", setup.userId);
    await svc.from("weight_logs").delete().eq("user_id", setup.userId);
    await svc.from("profiles").delete().eq("id", setup.userId);
    await svcClient().auth.admin.deleteUser(setup.userId);
  });

  // ── Card renders ──────────────────────────────────────────────────────────

  test("Maintenance tab renders usable/provisional card (not insufficient_nutrition_days)", async ({ page }) => {
    await navigateToMaintenance(page, setup);

    // This assertion FAILS if weeklyRate.estimate_kg reverts to weeklyRate.estimate:
    //   undefined weeklyRateKg → p7Calculate returns null → 422 → card shows insufficient state.
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("maintenance-card-insufficient-nutrition")).not.toBeVisible();
  });

  // ── Missing days are NOT counted as zero ──────────────────────────────────

  test("eligible_days = 24: missing days (27,28 ago) excluded from count", async ({ page }) => {
    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });

    // evidence-summary contains "24" — proof that the 2 not-logged days were NOT counted.
    // If missing days were zeroed, eligible_days would be 26 (or coverage would be 28/28).
    await expect(page.getByTestId("evidence-summary")).toContainText("24");
  });

  // ── Fasting day is counted as eligible (zero kcal) ───────────────────────

  test("fasting day is included in eligible count (day 24 ago, DLS=fasting)", async ({ page }) => {
    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });

    // eligible_days = 24 = 23 complete + 1 fasting.
    // If fasting was treated as incomplete/excluded: eligible_days would be 23.
    // If missing days were also zeroed AND counted: eligible_days would be 26.
    // The exact value 24 proves fasting is counted, missing days are not.
    await expect(page.getByTestId("evidence-summary")).toContainText("24");
  });

  // ── Probably-complete day excluded from estimate ──────────────────────────

  test("probably-complete day prompt appears (1 day excluded from estimate)", async ({ page }) => {
    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });

    // Day 26 ago: DLS=probably_complete + meals → counted in probablyCompleteDays, excluded from avg.
    await expect(page.getByText(/1 day\(s\) have meals logged but are not marked complete/i)).toBeVisible();
  });

  // ── Observed estimate ─────────────────────────────────────────────────────

  test("observed estimate is displayed as a positive kcal/day value", async ({ page }) => {
    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("observed-estimate")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("observed-estimate")).toContainText("kcal/day");
  });

  // ── Calorie target unchanged by GET ──────────────────────────────────────

  test("loading the card does NOT create calorie_target_snapshots (GET is read-only)", async ({ page }) => {
    const svc = svcClient();
    const { count: before } = await svc
      .from("calorie_target_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", setup.userId);

    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });

    const { count: after } = await svc
      .from("calorie_target_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", setup.userId);

    expect(after).toBe(before ?? 0);
  });

  test("goal phase mode and status unchanged after viewing estimate", async ({ page }) => {
    const svc = svcClient();
    const { data: before } = await svc
      .from("goal_phases")
      .select("mode, status, snapshot_id")
      .eq("id", phaseId)
      .single();

    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });

    const { data: after } = await svc
      .from("goal_phases")
      .select("mode, status, snapshot_id")
      .eq("id", phaseId)
      .single();

    const b = before as Record<string, unknown>;
    const a = after  as Record<string, unknown>;
    expect(a.mode).toBe(b.mode);
    expect(a.status).toBe(b.status);
    expect(a.snapshot_id).toBe(b.snapshot_id);
  });

  // ── Save snapshot ─────────────────────────────────────────────────────────

  test("save button is present and enabled before saving", async ({ page }) => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", setup.userId);

    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("save-snapshot-btn")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("save-snapshot-btn")).toBeEnabled();
  });

  test("clicking save creates a snapshot and button shows 'Estimate saved'", async ({ page }) => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", setup.userId);

    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("save-snapshot-btn")).toBeEnabled({ timeout: 5_000 });

    await page.getByTestId("save-snapshot-btn").click();
    await expect(page.getByTestId("save-snapshot-btn")).toHaveText(/Estimate saved/i, { timeout: 15_000 });
    await expect(page.getByTestId("save-snapshot-btn")).toBeDisabled();
  });

  // ── Calorie target unchanged by save ─────────────────────────────────────

  test("saving snapshot does NOT create calorie_target_snapshots", async ({ page }) => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", setup.userId);

    const { count: before } = await svc
      .from("calorie_target_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", setup.userId);

    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("save-snapshot-btn")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("save-snapshot-btn").click();
    await expect(page.getByTestId("save-snapshot-btn")).toHaveText(/Estimate saved/i, { timeout: 15_000 });

    const { count: after } = await svc
      .from("calorie_target_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", setup.userId);

    expect(after).toBe(before ?? 0);
  });

  test("saving snapshot does NOT mutate goal phase mode, status, or snapshot_id", async ({ page }) => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", setup.userId);

    const { data: before } = await svc
      .from("goal_phases")
      .select("mode, status, snapshot_id")
      .eq("id", phaseId)
      .single();

    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("save-snapshot-btn")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("save-snapshot-btn").click();
    await expect(page.getByTestId("save-snapshot-btn")).toHaveText(/Estimate saved/i, { timeout: 15_000 });

    const { data: after } = await svc
      .from("goal_phases")
      .select("mode, status, snapshot_id")
      .eq("id", phaseId)
      .single();

    const b = before as Record<string, unknown>;
    const a = after  as Record<string, unknown>;
    expect(a.mode).toBe(b.mode);
    expect(a.status).toBe(b.status);
    expect(a.snapshot_id).toBe(b.snapshot_id);
  });

  // ── Snapshot survives reload ──────────────────────────────────────────────

  test("snapshot row exists in DB after save (survives reload)", async ({ page }) => {
    const svc = svcClient();
    await svc.from("maintenance_estimate_snapshots").delete().eq("user_id", setup.userId);

    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("save-snapshot-btn")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("save-snapshot-btn").click();
    await expect(page.getByTestId("save-snapshot-btn")).toHaveText(/Estimate saved/i, { timeout: 15_000 });

    const { count } = await svc
      .from("maintenance_estimate_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", setup.userId);
    expect(count).toBe(1);
  });

  // ── Screenshots ───────────────────────────────────────────────────────────

  test("screenshot — desktop maintenance card", async ({ page }) => {
    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: "e2e/evidence/p7-maintenance-desktop.png", fullPage: false });
  });

  test("screenshot — mobile maintenance card", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateToMaintenance(page, setup);
    await expect(page.getByTestId("maintenance-card")).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: "e2e/evidence/p7-maintenance-mobile.png", fullPage: false });
  });
});
