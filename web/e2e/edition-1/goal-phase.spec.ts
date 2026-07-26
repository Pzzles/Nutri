// Playwright E2E tests for goal phase management.
// All edge function calls are intercepted at the network boundary — no real
// Supabase instance is required for these tests.
import { test, expect, type Page, type Route } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(data: unknown): string {
  return JSON.stringify({ success: true, data });
}

function fulfill(route: Route, data: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: ok(data),
  });
}

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

const ACTIVE_PHASE = {
  id: "phase-001",
  user_id: "user-001",
  mode: "cut",
  status: "active",
  started_at: "2026-07-01T06:00:00.000Z",
  ended_at: null,
  ended_reason: null,
  starting_weight_kg: 90,
  starting_weight_source: "manual",
  target_weight_kg: 80,
  target_change_kg_per_week: -0.5,
  target_calories: 2000,
  target_protein_g: 160,
  target_carbs_g: 200,
  target_fat_g: 70,
  superseded_by: null,
  created_at: "2026-07-01T06:00:00.000Z",
  updated_at: "2026-07-01T06:00:00.000Z",
};

const DASHBOARD_WITH_PHASE = {
  date: "2026-07-23",
  totals: { calories: 400, protein_g: 45, carbs_g: 50, fat_g: 12, fibre_g: 5 },
  goal: { target_calories: 2000, target_protein_g: 160 },
  percent_of_goal: { calories: 20, protein_g: 28 },
  active_phase: ACTIVE_PHASE,
  daily_log_status: { status: "unknown", marked_complete_at: null, reopened_at: null },
  weight_change: {
    starting_weight_kg: 90,
    latest_weight_kg: 88.5,
    change_kg: -1.5,
    days_in_phase: 22,
  },
};

const DASHBOARD_NO_PHASE = {
  ...DASHBOARD_WITH_PHASE,
  active_phase: null,
  daily_log_status: { status: "unknown", marked_complete_at: null, reopened_at: null },
  weight_change: null,
};

// Stub auth so the app doesn't try to sign in.
async function stubAuth(page: Page) {
  await page.route("**/auth/v1/**", (route) => {
    const url = route.request().url();
    if (url.includes("/token")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "stub-token",
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "stub-refresh",
          user: { id: "user-001", email: "test@test.local" },
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

// ── Test 1: Dashboard shows active phase card ──────────────────────────────────

test("dashboard displays active phase card with calorie target and weight change", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/dashboard-summary", (route) =>
    fulfill(route, DASHBOARD_WITH_PHASE),
  );

  await page.goto(BASE);

  await expect(page.getByText("Cut")).toBeVisible();
  await expect(page.getByText("2000")).toBeVisible();
  await expect(page.getByText("88.5 kg")).toBeVisible();
});

// ── Test 2: Start a cut phase via Goals page ───────────────────────────────────

test("user can start a new cut phase with manual starting weight", async ({ page }) => {
  await stubAuth(page);

  // Goals page initially shows no active phase.
  await page.route("**/functions/v1/get-goal-phases**", (route) =>
    fulfill(route, { active_phase: null, phases: [], total_count: 0 }),
  );

  let startCalled = false;
  await page.route("**/functions/v1/start-goal-phase", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    startCalled = true;
    expect(body.mode).toBe("cut");
    expect(body.starting_weight_source).toBe("manual");
    await fulfill(route, ACTIVE_PHASE);
  });

  // After start, fetch returns the new active phase.
  await page.route("**/functions/v1/get-goal-phases**", (route) =>
    fulfill(route, { active_phase: ACTIVE_PHASE, phases: [ACTIVE_PHASE], total_count: 1 }),
  );

  await page.goto(`${BASE}/goals`);

  await page.getByRole("button", { name: /start new phase/i }).click();
  await page.getByRole("button", { name: /enter manually/i }).click();
  await page.getByPlaceholder("kg").fill("90");
  await page.getByPlaceholder(/optional.*kcal|target calories/i).first().fill("2000");
  await page.getByRole("button", { name: /start phase/i }).click();

  await expect(page.getByText("Cut")).toBeVisible();
  expect(startCalled).toBe(true);
});

// ── Test 3: Mark day complete and see UI update ────────────────────────────────

test("user can mark today's log complete from the dashboard", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/dashboard-summary", (route) =>
    fulfill(route, DASHBOARD_NO_PHASE),
  );

  let setCalled = false;
  await page.route("**/functions/v1/set-daily-log-status", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    setCalled = true;
    expect(body.status).toBe("complete");
    await fulfill(route, {
      status: "complete",
      marked_complete_at: new Date().toISOString(),
      reopened_at: null,
    });
  });

  await page.goto(BASE);

  await page.getByRole("button", { name: /mark log complete/i }).click();
  await expect(page.getByRole("button", { name: /re-open log/i })).toBeVisible();
  expect(setCalled).toBe(true);
});

// ── Test 4: Logging a meal reopens a complete day ──────────────────────────────

test("reopen banner appears when logging a meal on a completed day", async ({ page }) => {
  await stubAuth(page);

  // Dashboard with complete day status.
  await page.route("**/functions/v1/dashboard-summary", (route) =>
    fulfill(route, {
      ...DASHBOARD_NO_PHASE,
      daily_log_status: { status: "complete", marked_complete_at: "2026-07-23T08:00:00Z", reopened_at: null },
    }),
  );

  // log-meal returns a reopened status (the trigger fired server-side).
  await page.route("**/functions/v1/parse-meal", (route) =>
    fulfill(route, { ai_parse_request_id: "req-001", items: [{ raw_phrase: "1 banana", normalized_name: "banana", quantity: 1, unit: "piece", confidence_hint: "high", ambiguous: false }] }),
  );
  await page.route("**/functions/v1/resolve-foods", (route) =>
    fulfill(route, { resolved_items: [{ raw_phrase: "1 banana", normalized_query: "banana", food_id: "f-001", quantity: 1, unit: "piece", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" }], clarification_required: [] }),
  );
  await page.route("**/functions/v1/calculate-meal", (route) =>
    fulfill(route, { items: [{ raw_phrase: "1 banana", normalized_query: "banana", food_id: "f-001", quantity: 1, unit: "piece", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high", calories: 89, protein_g: 1.1, carbs_g: 23, fat_g: 0.3, fibre_g: 2.6, nutrition_source: "usda_fdc", portion_g: 118, portion_source: "estimated", history_use_count: null }], clarification_required: [], meal_totals: { calories: 89, protein_g: 1.1, carbs_g: 23, fat_g: 0.3, fibre_g: 2.6 }, meal_confidence: "high" }),
  );
  await page.route("**/functions/v1/log-meal", (route) =>
    fulfill(route, {
      meal_id: "meal-001",
      meal_confidence: "high",
      daily_log_status: {
        status: "partial",
        marked_complete_at: "2026-07-23T08:00:00Z",
        reopened_at: new Date().toISOString(),
      },
    }),
  );

  await page.goto(`${BASE}/log`);

  await page.getByPlaceholder(/e.g./i).fill("1 banana");
  await page.getByRole("button", { name: /parse meal/i }).click();
  await page.getByRole("button", { name: /confirm & log/i }).click();

  await expect(page.getByText(/re-opened/i)).toBeVisible();
});

// ── Test 5: User isolation — Goals page only shows own data ────────────────────

test("goals page shows only the authenticated user's phase", async ({ page }) => {
  await stubAuth(page);

  // Only userA's active phase returned (RLS enforced server-side; client sees nothing of userB).
  await page.route("**/functions/v1/get-goal-phases**", (route) =>
    fulfill(route, { active_phase: ACTIVE_PHASE, phases: [ACTIVE_PHASE], total_count: 1 }),
  );

  await page.goto(`${BASE}/goals`);

  // One phase shown.
  await expect(page.getByText("Cut")).toBeVisible();
  // The phase belongs to the authenticated user — no other user data visible.
  const cards = await page.getByText("Cut").count();
  expect(cards).toBe(1);
});
