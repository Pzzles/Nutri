// Playwright integration tests for the weight-trend UI.
// All calls go to the real local Supabase stack — no network interception.
// Requires: supabase start (with edge functions running).

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

/**
 * Returns the Africa/Johannesburg calendar date for a UTC ISO timestamp.
 * Correct for any time-of-day including midnight crossings (e.g. 22:30 UTC).
 */
function toSastDate(isoUtc: string): string {
  const sastMs = new Date(isoUtc).getTime() + SAST_OFFSET_MS;
  const d = new Date(sastMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ── Fixture translation ───────────────────────────────────────────────────────

type FixtureEntry = { measured_at: string; weight_kg: number; is_official: boolean };

/**
 * Shift every entry by a whole-day offset so the latest measured_at lands
 * on yesterday (UTC calendar day). Preserves all weight values and
 * inter-measurement intervals — EWMA, Theil-Sen rate, uncertainty range,
 * modelling-day count, and gap sizes are unchanged.
 */
function anchorToYesterday(entries: FixtureEntry[]): FixtureEntry[] {
  const latestMs = Math.max(...entries.map((e) => new Date(e.measured_at).getTime()));
  const latestDay = new Date(
    new Date(latestMs).toISOString().split("T")[0] + "T00:00:00Z",
  );
  const yesterday = new Date(Date.now() - 86_400_000);
  yesterday.setUTCHours(0, 0, 0, 0);
  const offsetDays = Math.round(
    (yesterday.getTime() - latestDay.getTime()) / 86_400_000,
  );
  if (offsetDays === 0) return entries;
  return entries.map((e) => ({
    ...e,
    measured_at: new Date(
      new Date(e.measured_at).getTime() + offsetDays * 86_400_000,
    ).toISOString(),
  }));
}

/**
 * Shift every entry so the latest measured_at lands exactly N days ago
 * (UTC calendar day). Used to construct stale-data scenarios.
 */
function anchorToDaysAgo(entries: FixtureEntry[], daysAgo: number): FixtureEntry[] {
  const latestMs = Math.max(...entries.map((e) => new Date(e.measured_at).getTime()));
  const latestDay = new Date(
    new Date(latestMs).toISOString().split("T")[0] + "T00:00:00Z",
  );
  const target = new Date(Date.now() - daysAgo * 86_400_000);
  target.setUTCHours(0, 0, 0, 0);
  const offsetDays = Math.round(
    (target.getTime() - latestDay.getTime()) / 86_400_000,
  );
  return entries.map((e) => ({
    ...e,
    measured_at: new Date(
      new Date(e.measured_at).getTime() + offsetDays * 86_400_000,
    ).toISOString(),
  }));
}

// ── Fixture data ──────────────────────────────────────────────────────────────

// Fixture A base: 26 entries, daily-ish, with two same-day pairs.
// Oracle frozen values (translation-invariant — depend only on intervals):
//   latest_raw   = 102.6 kg
//   latest_trend ≈ 103.5–103.6 kg  (varies by ≤0.1 kg near the 28-day window boundary)
//   weekly_rate  ≈ −0.70 kg/week
//   range        : −0.82 to −0.61 kg/week (approx; shifts slightly near boundary)
//   confidence   : high
//   inclusive_calendar_days : 27–28   distinct_modelling_days : 23–24
// Note: the earliest entry (July 4) sits right on the 28-day cutoff boundary, so exact
// values for distinct days, span, trend weight, and range vary by time-of-day.
const FIXTURE_A_BASE: FixtureEntry[] = [
  { measured_at: "2026-07-04T05:00:00Z", weight_kg: 105.4, is_official: true },
  { measured_at: "2026-07-05T05:30:00Z", weight_kg: 104.9, is_official: true },
  { measured_at: "2026-07-06T06:00:00Z", weight_kg: 105.6, is_official: true },
  { measured_at: "2026-07-08T05:00:00Z", weight_kg: 105.1, is_official: true },
  { measured_at: "2026-07-09T05:15:00Z", weight_kg: 104.7, is_official: true },
  { measured_at: "2026-07-10T04:45:00Z", weight_kg: 105.2, is_official: true },
  { measured_at: "2026-07-11T05:00:00Z", weight_kg: 104.3, is_official: true },
  { measured_at: "2026-07-11T17:00:00Z", weight_kg: 105.0, is_official: false }, // same SAST day
  { measured_at: "2026-07-12T05:30:00Z", weight_kg: 104.8, is_official: true },
  { measured_at: "2026-07-14T05:00:00Z", weight_kg: 104.2, is_official: true },
  { measured_at: "2026-07-15T06:00:00Z", weight_kg: 104.6, is_official: true },
  { measured_at: "2026-07-16T05:00:00Z", weight_kg: 103.9, is_official: true },
  { measured_at: "2026-07-17T05:15:00Z", weight_kg: 104.4, is_official: true },
  { measured_at: "2026-07-18T05:00:00Z", weight_kg: 103.7, is_official: true },
  { measured_at: "2026-07-19T06:00:00Z", weight_kg: 104.1, is_official: true },
  { measured_at: "2026-07-21T05:00:00Z", weight_kg: 103.5, is_official: true },
  { measured_at: "2026-07-22T05:00:00Z", weight_kg: 103.8, is_official: true },
  { measured_at: "2026-07-22T20:00:00Z", weight_kg: 103.8, is_official: false }, // same SAST day; 20:00 UTC = 22:00 SAST
  { measured_at: "2026-07-23T05:00:00Z", weight_kg: 103.3, is_official: true },
  { measured_at: "2026-07-24T08:00:00Z", weight_kg: 103.6, is_official: true },
  { measured_at: "2026-07-25T05:00:00Z", weight_kg: 103.2, is_official: true },
  { measured_at: "2026-07-26T05:00:00Z", weight_kg: 103.5, is_official: true },
  { measured_at: "2026-07-27T05:15:00Z", weight_kg: 102.9, is_official: true },
  { measured_at: "2026-07-28T08:00:00Z", weight_kg: 103.1, is_official: true },
  { measured_at: "2026-07-30T05:30:00Z", weight_kg: 103.0, is_official: true },
  { measured_at: "2026-07-31T05:00:00Z", weight_kg: 102.6, is_official: true },
];
// Runtime-anchored: latest entry always lands on yesterday.
const FIXTURE_A_ENTRIES = anchorToYesterday(FIXTURE_A_BASE);

// Fixture L base: 12 entries, strict 7-day cadence.
// Base ends 2026-09-25 — future-dated without translation.
const FIXTURE_L_BASE: FixtureEntry[] = [
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
// Runtime-anchored: latest entry always lands on yesterday.
const FIXTURE_L_ENTRIES = anchorToYesterday(FIXTURE_L_BASE);

// Sporadic fixture base: 6 widely-spaced entries.
const FIXTURE_SPORADIC_BASE: FixtureEntry[] = [
  { measured_at: "2026-06-01T07:00:00Z", weight_kg: 88.0, is_official: true },
  { measured_at: "2026-06-15T07:00:00Z", weight_kg: 87.5, is_official: true },
  { measured_at: "2026-07-01T07:00:00Z", weight_kg: 87.0, is_official: true },
  { measured_at: "2026-07-20T07:00:00Z", weight_kg: 86.5, is_official: true },
  { measured_at: "2026-07-28T07:00:00Z", weight_kg: 86.2, is_official: true },
  { measured_at: "2026-07-31T07:00:00Z", weight_kg: 86.0, is_official: true },
];
// Runtime-anchored: latest entry always lands on yesterday.
const FIXTURE_SPORADIC_ENTRIES = anchorToYesterday(FIXTURE_SPORADIC_BASE);

// Stale fixture: Fixture A shifted so the latest is 16 days ago.
// Server returns status:"stale" when latest > 14 days from now.
// 16 days gives a ~10-day in-window span (well above the 7-day minimum), so
// determineStatus(~10, ~10, 16) → "stale". Anchoring to 20 days produced only
// 6.9 days of in-window span, hitting the insufficient_coverage check first.
const FIXTURE_STALE_ENTRIES = anchorToDaysAgo(FIXTURE_A_BASE, 16);

// Fixture G: single entry at 22:30 UTC — crosses midnight in SAST (UTC+2 = 00:30 next day).
// Proves that logged_date is stored as the Africa/Johannesburg calendar day, not the UTC day.
const _gBase = new Date(Date.now() - 5 * 86_400_000);
_gBase.setUTCHours(22, 30, 0, 0);
const FIXTURE_G_MEASURED_AT = _gBase.toISOString();
const FIXTURE_G_SAST_DATE = toSastDate(FIXTURE_G_MEASURED_AT); // next SAST day
const FIXTURE_G_UTC_DATE = FIXTURE_G_MEASURED_AT.split("T")[0]; // UTC day (different)
const FIXTURE_G_ENTRY: FixtureEntry = {
  measured_at: FIXTURE_G_MEASURED_AT,
  weight_kg: 90.0,
  is_official: true,
};

// ── Page helpers ──────────────────────────────────────────────────────────────

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
  const auth = (await resp.json()) as {
    access_token: string;
    refresh_token: string;
  };
  if (!auth.access_token)
    throw new Error("Sign-in failed: " + JSON.stringify(auth));

  return {
    userId,
    accessToken: auth.access_token,
    refreshToken: auth.refresh_token,
    email,
  };
}

async function seedWeightLogs(userId: string, entries: FixtureEntry[]) {
  const svc = svcClient();
  const rows = entries.map((e) => ({
    user_id: userId,
    weight_kg: e.weight_kg,
    measured_at: e.measured_at,
    // Use the Africa/Johannesburg calendar date, not the raw UTC date string.
    logged_date: toSastDate(e.measured_at),
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

/**
 * Pre-populate localStorage before the page loads so getSession() returns a
 * valid session immediately on mount, avoiding the race condition where
 * fetchLogs/fetchTrend fire before signInAnonymously() resolves.
 *
 * Key derivation: supabase-js uses `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
 * For http://127.0.0.1:54421 → hostname="127.0.0.1" → split(".")[0]="127" → "sb-127-auth-token"
 */
async function injectSession(page: Page, setup: UserSetup) {
  const storedSession = {
    access_token: setup.accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
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
    // "102.6 kg" appears in multiple elements (sr-only, display, summary, history);
    // .first() avoids strict-mode violation while still confirming it's rendered.
    await expect(page.locator("text=102.6 kg").first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows trend weight approximately 103.5 kg", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    // Scope to trend-summary to avoid matching the sr-only live region or the info-panel <strong>.
    await expect(page.getByTestId("trend-summary").getByText("Trend weight", { exact: true })).toBeVisible({ timeout: 10_000 });
    // Anchored regex matches only the <p> with exact text, not the sr-only live region.
    await expect(page.getByTestId("trend-summary").getByText(/^103\.[56] kg$/)).toBeVisible();
  });

  test("shows estimated weekly change as −0.70 kg/week", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(page.getByTestId("trend-summary").getByText("Estimated change", { exact: true })).toBeVisible({ timeout: 10_000 });
    // Anchored regex: matches only the <p> with exact rate text, not sr-only or parent containers.
    await expect(page.getByTestId("trend-summary").getByText(/^−0\.70 kg\/week$/)).toBeVisible();
  });

  test("shows estimated uncertainty range −0.82 to −0.61 kg/week", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    // Anchored regex: exact bounds shift near 28-day boundary; match pattern, not value.
    await expect(
      page.getByTestId("trend-summary").getByText(/^−0\.\d+ to −0\.\d+ kg\/week$/),
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

  test("shows coverage: 24 measurement days and 28-day span", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    // Anchored regex matches the exact <p> text, NOT the sr-only live region
    // (which appends " over X days." making it longer than the anchored pattern).
    await expect(page.getByText(/^Based on 2[34] measurement days$/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/^Span: 2[78] days$/)).toBeVisible();
  });

  test("trend refreshes after logging a new weight", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector('[data-testid="weight-trend-chart"]', {
      timeout: 10_000,
    });

    await page.fill('input[aria-label="Weight in kilograms"]', "102.4");
    await page.click('button[type="submit"]');

    // Chart remains visible after the trend refresh completes.
    await expect(
      page.locator('[data-testid="weight-trend-chart"]'),
    ).toBeVisible({ timeout: 15_000 });
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

// ── Stale history ─────────────────────────────────────────────────────────────

test.describe("Stale fixture — latest measurement ~16 days ago", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-stale");
    setup = await setupUser(email);
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );
    await seedWeightLogs(setup.userId, FIXTURE_STALE_ENTRIES);
  });

  test.afterAll(async () => {
    await cleanupUser(setup.userId);
  });

  test("shows stale status explanation", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await expect(page.locator("text=Stale data")).toBeVisible({ timeout: 10_000 });
    // Two elements contain "over two weeks old" (status detail + warning banner); .first() is fine.
    await expect(page.locator("text=over two weeks old").first()).toBeVisible();
  });

  test("historical chart still renders despite stale status", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=Stale data", { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="weight-trend-chart"]'),
    ).toBeVisible();
  });

  test("screenshot — stale state", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=Stale data", { timeout: 10_000 });
    await page.screenshot({ path: "e2e/evidence/stale-state.png" });
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
    // Scope to trend-summary to avoid sr-only and info-panel <strong> strict-mode violations.
    await expect(
      page.getByTestId("trend-summary").getByText("Trend weight", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows coverage and measurement info", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    // Anchored regex matches the exact <p>, not the sr-only live region (which has " over X days." suffix).
    await expect(page.getByText(/^Based on \d+ measurement days$/)).toBeVisible({ timeout: 10_000 });
  });

  test("does NOT demand daily weighing", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=Trend weight", { timeout: 10_000 });
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
    // Two elements: "No weight entries yet" (card) and "No weight entries yet." (history, with period).
    // exact: true matches only the card text (no trailing period).
    await expect(
      page.getByText("No weight entries yet", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="weight-trend-chart"]'),
    ).not.toBeVisible();
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

// ── Invalid timezone ──────────────────────────────────────────────────────────

test.describe("API error — invalid profile timezone", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-tz");
    setup = await setupUser(email);
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Not/AValidTimezone" },
      { onConflict: "id" },
    );
    // Seed one entry (timezone error still allows weight display)
    await seedWeightLogs(setup.userId, [FIXTURE_A_BASE[0]]);
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
    // "105.4 kg" appears in the big display and the history list; .first() is sufficient.
    await expect(page.locator("text=105.4 kg").first()).toBeVisible();
  });

  test("screenshot — invalid timezone error state", async ({ page }) => {
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    await page.waitForSelector("text=Timezone configuration issue", { timeout: 10_000 });
    await page.screenshot({ path: "e2e/evidence/invalid-timezone.png" });
  });
});

// ── Fixture G: SAST midnight boundary ────────────────────────────────────────

test.describe("Fixture G — SAST midnight boundary (22:30 UTC = 00:30 SAST next day)", () => {
  let setup: UserSetup;

  test.beforeAll(async () => {
    const email = testEmail("wt-e2e-sast");
    setup = await setupUser(email);
    await svcClient().from("profiles").upsert(
      { id: setup.userId, timezone: "Africa/Johannesburg" },
      { onConflict: "id" },
    );
    await seedWeightLogs(setup.userId, [FIXTURE_G_ENTRY]);
  });

  test.afterAll(async () => {
    await cleanupUser(setup.userId);
  });

  test("entry at 22:30 UTC is stored with SAST next-day logged_date", async ({ page }) => {
    // Sanity: SAST date must be strictly one day after the UTC date for 22:30 UTC.
    const utcDayMs = new Date(FIXTURE_G_UTC_DATE + "T00:00:00Z").getTime();
    const sastDayMs = new Date(FIXTURE_G_SAST_DATE + "T00:00:00Z").getTime();
    expect(sastDayMs - utcDayMs).toBe(86_400_000); // exactly 1 calendar day apart

    // Verify the stored row carries the SAST date, not the UTC date.
    const { data } = await svcClient()
      .from("weight_logs")
      .select("logged_date")
      .eq("user_id", setup.userId)
      .single();
    expect(data?.logged_date).toBe(FIXTURE_G_SAST_DATE);

    // Browser: the weight entry is visible.
    await injectSession(page, setup);
    await page.goto(`${BASE_URL}/weight`);
    // "90 kg" appears in the big display and history list; .first() is sufficient.
    await expect(page.locator("text=90 kg").first()).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: "e2e/evidence/sast-boundary.png" });
  });
});
