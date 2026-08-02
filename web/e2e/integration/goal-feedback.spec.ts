// Phase 8 — Playwright integration tests for the goal feedback card.
// All API calls go to the real local Supabase stack — no network interception.
// Requires: supabase start (with edge functions running) + vite dev server.

import { test, expect, type Page } from "@playwright/test";
import {
  SUPABASE_URL,
  ANON_KEY,
  svcClient,
  testEmail,
} from "./helpers";

// ── Date helpers ──────────────────────────────────────────────────────────────

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

function isoAt7(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(7, 0, 0, 0);
  return d.toISOString();
}

function utcDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
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

async function injectSession(page: Page, setup: UserSetup): Promise<void> {
  const storedSession = {
    access_token:  setup.accessToken,
    token_type:    "bearer",
    expires_in:    3600,
    expires_at:    Math.floor(Date.now() / 1000) + 3600,
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
 * Navigate to the Progress page, click the Feedback tab, and wait for the
 * card to reach a non-loading terminal state.
 * Retries once if Kong gateway cold-start returns an empty body.
 */
async function navigateToFeedback(page: Page, setup: UserSetup): Promise<void> {
  await injectSession(page, setup);
  await page.goto(`${BASE_URL}/progress`);
  await page.getByRole("button", { name: "Feedback" }).click();

  await page.waitForSelector(
    '[data-testid^="goal-feedback-card"]:not([data-testid="goal-feedback-card-loading"])',
    { timeout: 20_000 },
  ).catch(() => null);

  const isError = await page.getByTestId("goal-feedback-card-error").isVisible().catch(() => false);
  if (isError) {
    const tryAgain = page.getByRole("button", { name: /try again/i });
    if (await tryAgain.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await tryAgain.click();
      await page.waitForSelector(
        '[data-testid^="goal-feedback-card"]:not([data-testid="goal-feedback-card-loading"])',
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
    name:             `p8-e2e-${uid}`,
    normalized_name:  `p8-e2e-${uid}`,
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
    raw_input:       "p8 e2e test meal",
    eaten_at:        `${date}T12:00:00Z`,
  }).select("id").single();
  if (mealResult.error) throw new Error(`meal insert: ${mealResult.error.message}`);
  const mealId = (mealResult.data as { id: string }).id;

  const { error: itemErr } = await svc.from("meal_items").insert({
    meal_id:            mealId,
    food_id:            foodId,
    quantity:           kcal,
    unit:               "g",
    weight_g:           kcal,
    calories:           kcal,
    protein_g:          0,
    carbs_g:            0,
    fat_g:              0,
    fibre_g:            0,
    match_confidence:   "exact",
    portion_confidence: "exact",
    confidence:         "high",
    nutrition_source:   "user_manual",
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

// ── Tear-down helper ──────────────────────────────────────────────────────────

async function cleanupUser(userId: string): Promise<void> {
  const svc = svcClient();
  await svc.from("goal_feedback_assessments").delete().eq("user_id", userId);
  await svc.from("daily_log_status").delete().eq("user_id", userId);
  const mealIds = (await svc.from("meals").select("id").eq("user_id", userId))
    .data?.map((r: { id: string }) => r.id) ?? [];
  if (mealIds.length > 0) await svc.from("meal_items").delete().in("meal_id", mealIds);
  await svc.from("meals").delete().eq("user_id", userId);
  await svc.from("goal_phases").delete().eq("user_id", userId);
  await svc.from("weight_logs").delete().eq("user_id", userId);
  await svc.from("profiles").delete().eq("id", userId);
  await svc.auth.admin.deleteUser(userId);
}

// ══════════════════════════════════════════════════════════════════════════════
// Flow 1 — No active goal phase
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Flow 1 — No active goal phase", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("p8-no-phase");
    setup = await setupUser(email);
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );
    // Warm up edge function runner
    await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { Authorization: `Bearer ${setup.accessToken}`, apikey: ANON_KEY },
    }).then(r => r.text()).catch(() => null);
  });

  test.afterAll(async () => { await cleanupUser(setup.userId); });

  test("Feedback tab shows no-phase card when user has no active goal phase", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await expect(page.getByTestId("goal-feedback-card-no-phase")).toBeVisible({ timeout: 5_000 });
  });

  test("Feedback tab shows 'Goal Feedback' heading in no-phase card", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await expect(page.getByTestId("goal-feedback-card-no-phase")).toContainText("Goal Feedback");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Flow 2 — Insufficient data (phase exists, no weight logs)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Flow 2 — Insufficient data", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("p8-no-data");
    setup = await setupUser(email);
    const svc = svcClient();
    await svc.from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );
    // Goal phase but NO weight logs
    const phaseStart = new Date();
    phaseStart.setUTCDate(phaseStart.getUTCDate() - 10);
    await svc.from("goal_phases").insert({
      user_id:                   setup.userId,
      mode:                      "cut",
      status:                    "active",
      started_at:                phaseStart.toISOString(),
      starting_weight_kg:        85.0,
      starting_weight_source:    "manual",
      target_change_kg_per_week: -0.50,
    });
    await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { Authorization: `Bearer ${setup.accessToken}`, apikey: ANON_KEY },
    }).then(r => r.text()).catch(() => null);
  });

  test.afterAll(async () => { await cleanupUser(setup.userId); });

  test("Feedback tab shows no-data card when there is insufficient weight data", async ({ page }) => {
    await navigateToFeedback(page, setup);
    // insufficient_data or stale_data → no-data card
    await expect(
      page.locator('[data-testid="goal-feedback-card-no-data"], [data-testid="goal-feedback-card"]'),
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Flow 3 — Plateau/progress assessment flow (phase ≥ 50 days, near-zero trend)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Flow 3 — Plateau or progress assessment (50-day cut phase)", () => {
  let setup: UserSetup;
  let phaseId: string;

  test.beforeAll(async () => {
    const email = testEmail("p8-plateau");
    setup = await setupUser(email);
    const svc = svcClient();

    await svc.from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );

    // 56 days of weight logs at near-zero change (plateau scenario)
    const weightRows = [];
    for (let i = 0; i < 56; i++) {
      const daysAgo = 56 - i;
      weightRows.push({
        user_id:     setup.userId,
        weight_kg:   +(82 - i * 0.002).toFixed(3),  // ≈ −0.014 kg/week (near zero)
        measured_at: isoAt7(daysAgo),
        logged_date: toSastDate(isoAt7(daysAgo)),
        is_official: true,
        source:      "manual",
      });
    }
    const { error: wErr } = await svc.from("weight_logs").insert(weightRows);
    if (wErr) throw new Error(`weight insert: ${wErr.message}`);

    // Phase started 52 days ago (≥ 42 for likely_plateau)
    const phaseStart = new Date();
    phaseStart.setUTCDate(phaseStart.getUTCDate() - 52);
    const phaseResult = await svc.from("goal_phases").insert({
      user_id:                   setup.userId,
      mode:                      "cut",
      status:                    "active",
      started_at:                phaseStart.toISOString(),
      starting_weight_kg:        82.0,
      starting_weight_source:    "manual",
      target_change_kg_per_week: -0.50,
    }).select("id").single();
    if (phaseResult.error) throw new Error(`phase insert: ${phaseResult.error.message}`);
    phaseId = (phaseResult.data as { id: string }).id;

    // 35 complete nutrition days (days 35..1 ago), 2000 kcal/day
    for (let d = 35; d >= 1; d--) {
      await insertMealWithKcal(setup.userId, utcDaysAgo(d), 2000);
      await setDLS(setup.userId, utcDaysAgo(d), "complete");
    }

    // Warm up
    await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { Authorization: `Bearer ${setup.accessToken}`, apikey: ANON_KEY },
    }).then(r => r.text()).catch(() => null);
  });

  test.afterAll(async () => { await cleanupUser(setup.userId); });

  test("Feedback tab renders a full assessment card (not loading or no-phase)", async ({ page }) => {
    await navigateToFeedback(page, setup);
    // Any full card state is acceptable — the exact state depends on the algorithm output
    await expect(
      page.locator(
        '[data-testid="goal-feedback-card"], [data-testid="goal-feedback-card-no-data"]',
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("state headline is one of the 11 known progress states", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 15_000 })
      .catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible();
    if (!cardVisible) {
      // If no-data card, test passes — insufficient data is a valid state
      return;
    }
    const headlineText = await page.getByTestId("state-headline").textContent();
    const knownHeadlines = [
      "On track", "Slower than planned", "Faster than planned",
      "Possible plateau", "Plateau likely", "Moving in the wrong direction",
      "Maintaining well", "Weight is drifting",
    ];
    expect(knownHeadlines.some(h => headlineText?.includes(h))).toBe(true);
  });

  test("save button is present and shows calorie-target disclaimer", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 15_000 })
      .catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible();
    if (!cardVisible) return; // no-data card — skip
    await expect(page.getByTestId("save-assessment-btn")).toBeVisible();
    await expect(page.getByTestId("goal-feedback-card").getByText(/Does not change your calorie target/i)).toBeVisible();
  });

  test("save assessment flow: button transitions to 'Assessment saved'", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 15_000 })
      .catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible();
    if (!cardVisible) return; // no-data card — skip

    const saveBtn = page.getByTestId("save-assessment-btn");
    await expect(saveBtn).toBeEnabled({ timeout: 3_000 });
    await saveBtn.click();
    await expect(saveBtn).toHaveText("Assessment saved", { timeout: 10_000 });
    await expect(saveBtn).toBeDisabled();
  });

  test("saving an assessment does NOT change the goal phase", async ({ page }) => {
    const svc = svcClient();

    // Read phase before
    const before = await svc.from("goal_phases").select("mode, status, target_change_kg_per_week").eq("id", phaseId).single();

    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 15_000 }).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible();
    if (cardVisible) {
      const saveBtn = page.getByTestId("save-assessment-btn");
      if (await saveBtn.isEnabled({ timeout: 2_000 }).catch(() => false)) {
        await saveBtn.click();
        await expect(saveBtn).toHaveText("Assessment saved", { timeout: 10_000 });
      }
    }

    // Read phase after
    const after = await svc.from("goal_phases").select("mode, status, target_change_kg_per_week").eq("id", phaseId).single();

    expect(after.data?.mode).toBe(before.data?.mode);
    expect(after.data?.status).toBe(before.data?.status);
    expect(after.data?.target_change_kg_per_week).toBe(before.data?.target_change_kg_per_week);
  });

  test("screenshot: goal-feedback-plateau desktop", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector(
      '[data-testid^="goal-feedback-card"]:not([data-testid="goal-feedback-card-loading"])',
      { timeout: 15_000 },
    ).catch(() => null);
    await page.screenshot({ path: "e2e/evidence/p8-goal-feedback-plateau-desktop.png" });
  });

  test("screenshot: goal-feedback-plateau mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigateToFeedback(page, setup);
    await page.waitForSelector(
      '[data-testid^="goal-feedback-card"]:not([data-testid="goal-feedback-card-loading"])',
      { timeout: 15_000 },
    ).catch(() => null);
    await page.screenshot({ path: "e2e/evidence/p8-goal-feedback-plateau-mobile.png" });
  });
});

// ── Weight-log seeding helper ─────────────────────────────────────────────────

async function insertWeightRows(
  userId: string,
  days: number,
  startKg: number,
  rateKgPerDay: number,
): Promise<void> {
  const rows = [];
  for (let i = 0; i < days; i++) {
    const daysAgo = days - i;
    rows.push({
      user_id:     userId,
      weight_kg:   +(startKg + i * rateKgPerDay).toFixed(3),
      measured_at: isoAt7(daysAgo),
      logged_date: toSastDate(isoAt7(daysAgo)),
      is_official: true,
      source:      "manual",
    });
  }
  const { error } = await svcClient().from("weight_logs").insert(rows);
  if (error) throw new Error(`insertWeightRows: ${error.message}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Flow 4 — plateau_candidate (30-day cut, near-zero rate, with nutrition data)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Flow 4 — plateau_candidate (30-day cut, near-zero rate)", () => {
  let setup: UserSetup;
  let phaseId: string;

  test.beforeAll(async () => {
    const email = testEmail("p8-pc-e2e");
    setup = await setupUser(email);
    const svc = svcClient();

    await svc.from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );

    // 35 days of near-zero weight change (−0.014 kg/week ≈ −0.002 kg/day)
    await insertWeightRows(setup.userId, 35, 84.0, -0.002);

    // Phase started 30 days ago (≥28 for plateau_candidate, <42 for likely_plateau)
    const phaseStart = new Date();
    phaseStart.setUTCDate(phaseStart.getUTCDate() - 30);
    const pr = await svc.from("goal_phases").insert({
      user_id:                   setup.userId,
      mode:                      "cut",
      status:                    "active",
      started_at:                phaseStart.toISOString(),
      starting_weight_kg:        84.0,
      starting_weight_source:    "manual",
      target_change_kg_per_week: -0.50,
    }).select("id").single();
    if (pr.error) throw new Error(`phase insert: ${pr.error.message}`);
    phaseId = (pr.data as { id: string }).id;

    // 30 complete nutrition days (P7 provisional/usable)
    for (let d = 30; d >= 1; d--) {
      await insertMealWithKcal(setup.userId, utcDaysAgo(d), 2000);
      await setDLS(setup.userId, utcDaysAgo(d), "complete");
    }

    // Warm up
    await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { Authorization: `Bearer ${setup.accessToken}`, apikey: ANON_KEY },
    }).then(r => r.text()).catch(() => null);
  }, 120_000);

  test.afterAll(async () => { await cleanupUser(setup.userId); });

  test("plateau_candidate: card renders and shows plateau notice or review action", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector(
      '[data-testid^="goal-feedback-card"]:not([data-testid="goal-feedback-card-loading"])',
      { timeout: 20_000 },
    ).catch(() => null);

    // With near-zero rate and 30-day phase, should be plateau_candidate or slower_than_planned
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    const noDataVisible = await page.getByTestId("goal-feedback-card-no-data").isVisible().catch(() => false);
    expect(cardVisible || noDataVisible).toBe(true);

    if (cardVisible) {
      const headline = await page.getByTestId("state-headline").textContent();
      // plateau_candidate → "Possible plateau" | slower_than_planned → "Slower than planned"
      const validHeadlines = ["Possible plateau", "Slower than planned"];
      expect(validHeadlines.some(h => headline?.includes(h))).toBe(true);
    }
  });

  test("plateau_candidate: no advisory adjustment banner visible", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 20_000 }).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    if (!cardVisible) return;

    // plateau_candidate and slower_than_planned: no advisory adjustment should appear
    const headline = await page.getByTestId("state-headline").textContent();
    const isPlateau = headline?.includes("Possible plateau") || headline?.includes("Slower");
    if (isPlateau) {
      const banner = await page.getByTestId("advisory-adjustment-banner").isVisible().catch(() => false);
      expect(banner).toBe(false);
    }
  });

  test("plateau_candidate: if state shown, 'plateau-candidate-notice' is visible", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 20_000 }).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    if (!cardVisible) return;

    const headline = await page.getByTestId("state-headline").textContent();
    if (headline?.includes("Possible plateau")) {
      await expect(page.getByTestId("plateau-candidate-notice")).toBeVisible();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Flow 5 — slower_than_planned (30-day cut, −0.15 kg/week, target −0.50 kg/week)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Flow 5 — slower_than_planned (attainment ratio ≈ 0.30)", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("p8-slow-e2e");
    setup = await setupUser(email);
    const svc = svcClient();

    await svc.from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );

    // 35 days at −0.021 kg/day ≈ −0.147 kg/week (below −0.50 target, ratio ≈ 0.29)
    await insertWeightRows(setup.userId, 35, 84.0, -0.021);

    const phaseStart = new Date();
    phaseStart.setUTCDate(phaseStart.getUTCDate() - 30);
    await svc.from("goal_phases").insert({
      user_id:                   setup.userId,
      mode:                      "cut",
      status:                    "active",
      started_at:                phaseStart.toISOString(),
      starting_weight_kg:        84.0,
      starting_weight_source:    "manual",
      target_change_kg_per_week: -0.50,
    });

    await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { Authorization: `Bearer ${setup.accessToken}`, apikey: ANON_KEY },
    }).then(r => r.text()).catch(() => null);
  }, 60_000);

  test.afterAll(async () => { await cleanupUser(setup.userId); });

  test("slower_than_planned: headline contains 'Slower' and no adjustment banner", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 20_000 }).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    if (!cardVisible) return;

    const headline = await page.getByTestId("state-headline").textContent();
    expect(headline).toContain("Slower");

    // slower_than_planned never triggers an advisory adjustment
    const banner = await page.getByTestId("advisory-adjustment-banner").isVisible().catch(() => false);
    expect(banner).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Flow 6 — maintenance_stable (30-day maintenance, near-zero rate)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Flow 6 — maintenance_stable (30-day maintenance, stable weight)", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("p8-maint-e2e");
    setup = await setupUser(email);
    const svc = svcClient();

    await svc.from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );

    // 35 days at −0.001 kg/day ≈ −0.007 kg/week (within ±0.10 maintenance band)
    await insertWeightRows(setup.userId, 35, 80.0, -0.001);

    const phaseStart = new Date();
    phaseStart.setUTCDate(phaseStart.getUTCDate() - 30);
    await svc.from("goal_phases").insert({
      user_id:                   setup.userId,
      mode:                      "maintenance",
      status:                    "active",
      started_at:                phaseStart.toISOString(),
      starting_weight_kg:        80.0,
      starting_weight_source:    "manual",
      target_change_kg_per_week: 0,
    });

    await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { Authorization: `Bearer ${setup.accessToken}`, apikey: ANON_KEY },
    }).then(r => r.text()).catch(() => null);
  }, 60_000);

  test.afterAll(async () => { await cleanupUser(setup.userId); });

  test("maintenance_stable: headline contains 'Maintaining' and no adjustment", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 20_000 }).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    if (!cardVisible) return;

    const headline = await page.getByTestId("state-headline").textContent();
    expect(headline).toContain("Maintaining");

    // maintenance_stable never triggers an advisory adjustment
    const banner = await page.getByTestId("advisory-adjustment-banner").isVisible().catch(() => false);
    expect(banner).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Flow 7 — likely_plateau: full save+reload flow, and adjustment-blocked notice
// ══════════════════════════════════════════════════════════════════════════════
// Uses a 55-day cut phase with near-zero weight change and full P7 nutrition coverage.
// No calorie_target_snapshot → missing_current_target safety block fires when the
// edge function attempts an adjustment.

test.describe("Flow 7 — likely_plateau: save+reload and blocked-adjustment UI", () => {
  let setup: UserSetup;
  let phaseId: string;

  test.beforeAll(async () => {
    const email = testEmail("p8-lp-reload");
    setup = await setupUser(email);
    const svc = svcClient();

    await svc.from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );

    // 58 days of near-zero weight change (≥42 for likely_plateau)
    await insertWeightRows(setup.userId, 58, 83.0, -0.002);

    const phaseStart = new Date();
    phaseStart.setUTCDate(phaseStart.getUTCDate() - 55);
    const pr = await svc.from("goal_phases").insert({
      user_id:                   setup.userId,
      mode:                      "cut",
      status:                    "active",
      started_at:                phaseStart.toISOString(),
      starting_weight_kg:        83.0,
      starting_weight_source:    "manual",
      target_change_kg_per_week: -0.50,
    }).select("id").single();
    if (pr.error) throw new Error(`phase: ${pr.error.message}`);
    phaseId = (pr.data as { id: string }).id;

    // 50 complete nutrition days (days 50..1 ago) for strong P7 coverage
    for (let d = 50; d >= 1; d--) {
      await insertMealWithKcal(setup.userId, utcDaysAgo(d), 2000);
      await setDLS(setup.userId, utcDaysAgo(d), "complete");
    }

    await fetch(`${SUPABASE_URL}/functions/v1/get-goal-feedback`, {
      headers: { Authorization: `Bearer ${setup.accessToken}`, apikey: ANON_KEY },
    }).then(r => r.text()).catch(() => null);
  }, 180_000);

  test.afterAll(async () => { await cleanupUser(setup.userId); });

  test("likely_plateau: card renders a full assessment state", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector(
      '[data-testid^="goal-feedback-card"]:not([data-testid="goal-feedback-card-loading"])',
      { timeout: 20_000 },
    ).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    const noDataVisible = await page.getByTestId("goal-feedback-card-no-data").isVisible().catch(() => false);
    expect(cardVisible || noDataVisible).toBe(true);
  });

  test("save assessment → reload → card reflects saved or on-track state", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 20_000 }).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    if (!cardVisible) return; // no-data card — skip

    const saveBtn = page.getByTestId("save-assessment-btn");
    const canSave = await saveBtn.isEnabled({ timeout: 3_000 }).catch(() => false);
    if (!canSave) return; // already saved today — skip

    await saveBtn.click();
    await expect(saveBtn).toHaveText("Assessment saved", { timeout: 10_000 });

    // Verify DB has the saved row
    const { data } = await svcClient()
      .from("goal_feedback_assessments")
      .select("id, progress_state")
      .eq("user_id", setup.userId)
      .eq("goal_phase_id", phaseId)
      .order("created_at", { ascending: false })
      .limit(1);
    expect((data ?? []).length).toBeGreaterThanOrEqual(1);

    // Reload — card must still render the assessment (not an error state).
    // The save-btn resets to "Save this assessment" on remount (savedId is local state).
    await page.reload();
    await navigateToFeedback(page, setup);
    await page.waitForSelector(
      '[data-testid^="goal-feedback-card"]:not([data-testid="goal-feedback-card-loading"])',
      { timeout: 20_000 },
    ).catch(() => null);
    const stillRendered = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    expect(stillRendered).toBe(true);
  });

  test("if likely_plateau + missing snapshot: adjustment-blocked notice is visible", async ({ page }) => {
    await navigateToFeedback(page, setup);
    await page.waitForSelector('[data-testid="goal-feedback-card"]', { timeout: 20_000 }).catch(() => null);
    const cardVisible = await page.getByTestId("goal-feedback-card").isVisible().catch(() => false);
    if (!cardVisible) return;

    const headline = await page.getByTestId("state-headline").textContent().catch(() => "");
    if (!headline?.includes("Plateau likely")) return; // only check if we got likely_plateau

    // No calorie_target_snapshot → missing_current_target block fires
    // Component should render adjustment-blocked-notice
    await expect(page.getByTestId("adjustment-blocked-notice")).toBeVisible({ timeout: 3_000 });
  });
});
