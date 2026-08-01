// Playwright integration tests for the weight-trend UI.
// All calls go to the real local Supabase stack — no network interception.
// Requires: supabase start (with edge functions running).

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL,
  ANON_KEY,
  SERVICE_ROLE_KEY,
  svcClient,
  testEmail,
} from "./helpers";

// ── Fixture data ──────────────────────────────────────────────────────────────

// Fixture A: 26 entries, daily-ish, 2026-07-04 → 2026-07-31
// Oracle frozen values (now_iso = 2026-08-01T05:00:00Z):
//   latest_raw = 102.6 kg
//   latest_trend ≈ 103.5 kg
//   weekly_rate ≈ −0.70 kg/week
//   range: −0.82 to −0.61 kg/week
//   confidence: high
const FIXTURE_A_ENTRIES = [
  { measured_at: "2026-07-04T05:00:00Z", weight_kg: 105.4, is_official: true },
  { measured_at: "2026-07-05T05:30:00Z", weight_kg: 104.9, is_official: true },
  { measured_at: "2026-07-06T06:00:00Z", weight_kg: 105.6, is_official: true },
  { measured_at: "2026-07-08T05:00:00Z", weight_kg: 105.1, is_official: true },
  { measured_at: "2026-07-09T05:15:00Z", weight_kg: 104.7, is_official: true },
  { measured_at: "2026-07-10T04:45:00Z", weight_kg: 105.2, is_official: true },
  { measured_at: "2026-07-11T05:00:00Z", weight_kg: 104.3, is_official: true },
  { measured_at: "2026-07-11T17:00:00Z", weight_kg: 105.0, is_official: false },
  { measured_at: "2026-07-12T05:30:00Z", weight_kg: 104.8, is_official: true },
  { measured_at: "2026-07-14T05:00:00Z", weight_kg: 104.2, is_official: true },
  { measured_at: "2026-07-15T06:00:00Z", weight_kg: 104.6, is_official: true },
  { measured_at: "2026-07-16T05:00:00Z", weight_kg: 103.9, is_official: true },
  { measured_at: "2026-07-17T05:15:00Z", weight_kg: 104.4, is_official: true },
  { measured_at: "2026-07-18T05:00:00Z", weight_kg: 103.7, is_official: true },
  { measured_at: "2026-07-19T06:00:00Z", weight_kg: 104.1, is_official: true },
  { measured_at: "2026-07-21T05:00:00Z", weight_kg: 103.5, is_official: true },
  { measured_at: "2026-07-22T05:00:00Z", weight_kg: 103.8, is_official: true },
  { measured_at: "2026-07-22T20:00:00Z", weight_kg: 103.8, is_official: false },
  { measured_at: "2026-07-23T05:00:00Z", weight_kg: 103.3, is_official: true },
  { measured_at: "2026-07-24T08:00:00Z", weight_kg: 103.6, is_official: true },
  { measured_at: "2026-07-25T05:00:00Z", weight_kg: 103.2, is_official: true },
  { measured_at: "2026-07-26T05:00:00Z", weight_kg: 103.5, is_official: true },
  { measured_at: "2026-07-27T05:15:00Z", weight_kg: 102.9, is_official: true },
  { measured_at: "2026-07-28T08:00:00Z", weight_kg: 103.1, is_official: true },
  { measured_at: "2026-07-30T05:30:00Z", weight_kg: 103.0, is_official: true },
  { measured_at: "2026-07-31T05:00:00Z", weight_kg: 102.6, is_official: true },
];

// Fixture L: 12 entries, weekly cadence, 2026-07-10 → 2026-09-25
const FIXTURE_L_ENTRIES = [
  { measured_at: "2026-07-10T05:00:00Z", weight_kg: 105.0, is_official: true },
  { measured_at: "2026-07-17T05:00:00Z", weight_kg: 104.6, is_official: true },
  { measured_at: "2026-07-24T05:00:00Z", weight_kg: 104.3, is_official: true },
  { measured_at: "2026-07-31T05:00:00Z", weight_kg: 104.0, is_official: true },
  { measured_at: "2026-08-07T05:00:00Z", weight_kg: 103.7, is_official: true },
  { measured_at: "2026-08-14T05:00:00Z", weight_kg: 103.4, is_official: true },
  { measured_at: "2026-08-21T05:00:00Z", weight_kg: 103.1, is_official: true },
  { measured_at: "2026-08-28T05:00:00Z", weight_kg: 102.8, is_official: true },
  { measured_at: "2026-09-04T05:00:00Z", weight_kg: 102.5, is_official: true },
  { measured_at: "2026-09-11T05:00:00Z", weight_kg: 102.3, is_official: true },
  { measured_at: "2026-09-18T05:00:00Z", weight_kg: 102.1, is_official: true },
  { measured_at: "2026-09-25T05:00:00Z", weight_kg: 101.9, is_official: true },
];

// Sporadic fixture: 6 widely-spaced entries
const FIXTURE_SPORADIC_ENTRIES = [
  { measured_at: "2026-06-01T07:00:00Z", weight_kg: 88.0, is_official: true },
  { measured_at: "2026-06-15T07:00:00Z", weight_kg: 87.5, is_official: true },
  { measured_at: "2026-07-01T07:00:00Z", weight_kg: 87.0, is_official: true },
  { measured_at: "2026-07-20T07:00:00Z", weight_kg: 86.5, is_official: true },
  { measured_at: "2026-07-28T07:00:00Z", weight_kg: 86.2, is_official: true },
  { measured_at: "2026-07-31T07:00:00Z", weight_kg: 86.0, is_official: true },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTH_STORAGE_KEY = "sb-localhost-auth-token";
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

  // Get session token via REST
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const auth = await resp.json() as { access_token: string; refresh_token: string };
  if (!auth.access_token) throw new Error("Sign-in failed: " + JSON.stringify(auth));

  return {
    userId,
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token,
    email,
  };
}

async function seedWeightLogs(
  userId: string,
  entries: Array<{ measured_at: string; weight_kg: number; is_official: boolean }>,
) {
  const svc = svcClient();
  const rows = entries.map((e) => ({
    user_id: userId,
    weight_kg: e.weight_kg,
    measured_at: e.measured_at,
    logged_date: e.measured_at.split("T")[0],
    is_official: e.is_official,
  }));
  const { error } = await svc.from("weight_logs").insert(rows);
  if (error) throw new Error(`seedWeightLogs failed: ${error.message}`);
}

async function cleanupUser(userId: string) {
  const svc = svcClient();
  await svc.from("weight_logs").delete().eq("user_id", userId);
  await svc.auth.admin.deleteUser(userId);
}

/** Inject the auth session into localStorage before the page loads. */
async function injectSession(page: Page, setup: UserSetup) {
  await page.addInitScript(
    ([key, sessionJson]) => {
      localStorage.setItem(key, sessionJson);
    },
    [
      AUTH_STORAGE_KEY,
      JSON.stringify({
        access_token: setup.accessToken,
        refresh_token: setup.refreshToken,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: "bearer",
        user: { id: setup.userId, email: setup.email },
      }),
    ],
  );
}

// ── Fixture A: realistic daily decline ────────────────────────────────────────

test.describe("Fixture A — realistic daily decline", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-a");
    setup = await setupUser(email);
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );
    await seedWeightLogs(setup.userId, FIXTURE_A_ENTRIES);
  });

  test.afterAll(async () => {
    await cleanupUser(setup.userId);
  });

  test("shows latest measured weight", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    // Latest entry is 102.6 kg
    await expect(page.locator("text=102.6")).toBeVisible({ timeout: 10_000 });
  });

  test("shows trend weight approximately 103.5 kg", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(page.locator("text=Trend weight")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=103.5")).toBeVisible();
  });

  test("shows estimated weekly change as −0.70 kg/week", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator("text=Estimated change"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=−0.70 kg/week")).toBeVisible();
  });

  test("shows estimated uncertainty range −0.82 to −0.61 kg/week", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator("text=−0.82 to −0.61 kg/week"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows High confidence badge", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator("text=High confidence"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows chart with raw dots and trend line", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator('[data-testid="weight-trend-chart"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("shows coverage information", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator("text=28-day span"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("screenshot — desktop usable trend", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector('[data-testid="weight-trend-chart"]', { timeout: 10_000 });
    await page.screenshot({
      path: "e2e/evidence/fixture-a-desktop.png",
      fullPage: false,
    });
  });

  test("screenshot — mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector('[data-testid="weight-trend-chart"]', { timeout: 10_000 });
    await page.screenshot({
      path: "e2e/evidence/fixture-a-mobile.png",
      fullPage: false,
    });
  });
});

// ── Fixture L: weekly user ────────────────────────────────────────────────────

test.describe("Fixture L — weekly user, no daily-weighing requirement", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-l");
    setup = await setupUser(email);
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );
    await seedWeightLogs(setup.userId, FIXTURE_L_ENTRIES);
  });

  test.afterAll(async () => {
    await cleanupUser(setup.userId);
  });

  test("page loads with trend data", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    // Should show some trend weight — the exact value depends on server time
    await expect(
      page.locator("text=Trend weight"),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows coverage and measurement info", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(page.locator("text=measurement day")).toBeVisible({ timeout: 10_000 });
  });

  test("does NOT demand daily weighing", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=Trend weight", { timeout: 10_000 });
    // Explicitly forbidden language
    await expect(page.locator("text=/missed.*daily/i")).not.toBeVisible();
    await expect(page.locator("text=/You should weigh daily/i")).not.toBeVisible();
  });

  test("screenshot — weekly user state", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=Trend weight", { timeout: 10_000 });
    await page.screenshot({ path: "e2e/evidence/fixture-l-weekly.png" });
  });
});

// ── Sporadic user ─────────────────────────────────────────────────────────────

test.describe("Sporadic fixture — irregular measurements", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-sporadic");
    setup = await setupUser(email);
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );
    await seedWeightLogs(setup.userId, FIXTURE_SPORADIC_ENTRIES);
  });

  test.afterAll(async () => {
    await cleanupUser(setup.userId);
  });

  test("page is useful and explains actual coverage", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=measurement day", { timeout: 10_000 });
    // Should show factual coverage, not punishment language
    await expect(page.locator("text=/failed|missed|poor/i")).not.toBeVisible();
  });

  test("screenshot — insufficient or provisional state", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForTimeout(3_000);
    await page.screenshot({ path: "e2e/evidence/sporadic-state.png" });
  });
});

// ── Empty history ─────────────────────────────────────────────────────────────

test.describe("Empty history — first weight state", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-empty");
    setup = await setupUser(email);
  });

  test.afterAll(async () => {
    await cleanupUser(setup.userId);
  });

  test("shows empty state not broken chart", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator("text=No weight entries yet"),
    ).toBeVisible({ timeout: 10_000 });
    // No broken chart
    await expect(
      page.locator('[data-testid="weight-trend-chart"]'),
    ).not.toBeVisible();
    // No zero or NaN weight
    await expect(page.locator("text=0 kg")).not.toBeVisible();
  });

  test("retains the form to log first weight", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator("input[aria-label='Weight in kilograms']"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("screenshot — empty state", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=No weight entries yet", { timeout: 10_000 });
    await page.screenshot({ path: "e2e/evidence/empty-state.png" });
  });
});

// ── Invalid timezone ─────────────────────────────────────────────────────────

test.describe("API error — invalid profile timezone", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-tz");
    setup = await setupUser(email);
    // Set an invalid timezone in the profile
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Not/AValidTimezone" },
      { onConflict: "id" },
    );
    await seedWeightLogs(setup.userId, [FIXTURE_A_ENTRIES[0]]);
  });

  test.afterAll(async () => {
    await cleanupUser(setup.userId);
  });

  test("shows timezone configuration error without crashing", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(
      page.locator("text=Timezone configuration issue"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("raw weight history remains visible despite trend error", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=Timezone configuration issue", { timeout: 10_000 });
    // The weight log entry should still show
    await expect(page.locator("text=105.4")).toBeVisible();
  });
});
