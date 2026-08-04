// Phase 5 E2E test: full browser flow for the energy-based calorie target.
//
// Flow:
//   1. Create a test user with a complete profile (birth_date, sex, height_cm, activity_level)
//   2. Log an official weight
//   3. Navigate to /goals
//   4. Open the new-phase form
//   5. Select a rate, inspect the preview breakdown
//   6. Start the phase
//   7. Reload — verify the active phase shows a server-calculated calorie target
//   8. "How this was calculated" details section is visible and populated
//
// No stubs. All network calls go to the real local Supabase stack.
import { test, expect } from "@playwright/test";
import { SUPABASE_URL, ANON_KEY, svcClient, testEmail } from "./helpers";

// Helpers shared across this test
async function callEdgeFunction(name: string, body: unknown, token: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

const EMAIL = testEmail("phase5-e2e");
const PASSWORD = "TestPassword123!";

let userId = "";
let accessToken = "";

test.beforeAll(async () => {
  const svc = svcClient();

  // Create user.
  const { data, error } = await svc.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create user: ${error.message}`);
  userId = data.user!.id;

  // Set profile with all required energy-calc fields.
  await svc.from("profiles").upsert(
    {
      id: userId,
      timezone: "Africa/Johannesburg",
      birth_date: "1990-07-31",
      sex: "male",
      height_cm: 175,
      activity_level: "moderate",
    },
    { onConflict: "id" },
  );

  // Sign in to get access token.
  const anonRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const authData = await anonRes.json();
  accessToken = authData.access_token;

  // Log an official weight.
  await callEdgeFunction(
    "log-weight",
    { weight_kg: 80, measured_at: new Date().toISOString(), is_official: true, source: "manual" },
    accessToken,
  );
});

test.afterAll(async () => {
  const svc = svcClient();
  await svc.from("goal_phases").delete().eq("user_id", userId);
  await svc.from("calorie_target_snapshots").delete().eq("user_id", userId);
  await svc.from("weight_logs").delete().eq("user_id", userId);
  await svc.auth.admin.deleteUser(userId);
});

test.describe("Phase 5 — energy-based goal phase", () => {
  test("user can preview calculation and start a phase with server-derived calories", async ({ page }) => {
    // ── Sign in ─────────────────────────────────────────────────────────────
    await page.goto("/");
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("link", { name: "Account" })).toBeVisible({ timeout: 10_000 });

    // ── Navigate to Goals ────────────────────────────────────────────────────
    await page.goto("/goals");
    await expect(page.getByRole("heading", { name: /goals/i })).toBeVisible();

    // ── Open new phase form ──────────────────────────────────────────────────
    await page.getByRole("button", { name: /start new phase/i }).click();
    await expect(page.getByRole("button", { name: /start phase/i })).toBeVisible();

    // ── Select mode and rate ─────────────────────────────────────────────────
    await page.getByRole("button", { name: /^cut$/i }).click();
    await page.locator("input[placeholder='e.g. 0.5']").fill("0.5");

    // ── Select activity level ────────────────────────────────────────────────
    await page.selectOption("select", { value: "moderate" });

    // ── Preview calculation ──────────────────────────────────────────────────
    await page.getByRole("button", { name: /preview calorie target/i }).click();
    await expect(page.getByText(/calorie breakdown/i)).toBeVisible({ timeout: 10_000 });

    // The breakdown should show a target above 1000 kcal.
    const breakdownText = await page.getByText(/calorie target/i).last().textContent();
    const kcalMatch = breakdownText?.match(/(\d{3,5})/);
    const target = kcalMatch ? parseInt(kcalMatch[1], 10) : 0;
    expect(target).toBeGreaterThanOrEqual(1000);

    // ── Start the phase ──────────────────────────────────────────────────────
    await page.getByRole("button", { name: /^start phase$/i }).click();
    await expect(page.getByText(/cut/i)).toBeVisible({ timeout: 10_000 });

    // ── Reload and verify active phase shows calculated calories ─────────────
    await page.reload();
    await expect(page.getByText(/active phase/i)).toBeVisible({ timeout: 10_000 });
    // Server-derived target should be > 0.
    const caloriesEl = page.getByText(/kcal/i).first();
    await expect(caloriesEl).toBeVisible();
    const caloriesText = await caloriesEl.textContent();
    const caloriesVal = parseInt(caloriesText?.replace(/\D/g, "") ?? "0", 10);
    expect(caloriesVal).toBeGreaterThanOrEqual(1000);

    // ── Snapshot breakdown is expandable ─────────────────────────────────────
    const breakdownSummary = page.getByText(/how this (target )?was calculated/i);
    await expect(breakdownSummary).toBeVisible();
    await breakdownSummary.click();
    // After expanding, algorithm name should appear.
    await expect(page.getByText(/mifflin/i)).toBeVisible({ timeout: 5_000 });
  });

  test("phase preview shows ineligible when user has no official weight logged", async ({ page }) => {
    // Create a second user with profile but no weight log.
    const svc = svcClient();
    const EMAIL2 = testEmail("phase5-no-weight");
    const { data } = await svc.auth.admin.createUser({
      email: EMAIL2,
      password: PASSWORD,
      email_confirm: true,
    });
    const userId2 = data.user!.id;
    await svc.from("profiles").upsert(
      {
        id: userId2,
        timezone: "Africa/Johannesburg",
        birth_date: "1992-01-01",
        sex: "female",
        height_cm: 165,
        activity_level: "light",
      },
      { onConflict: "id" },
    );

    // Sign in as that user.
    await page.goto("/");
    await page.getByLabel(/email/i).fill(EMAIL2);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("link", { name: "Account" })).toBeVisible({ timeout: 10_000 });

    await page.goto("/goals");
    await page.getByRole("button", { name: /start new phase/i }).click();
    await page.getByRole("button", { name: /^cut$/i }).click();
    await page.locator("input[placeholder='e.g. 0.5']").fill("0.3");
    await page.getByRole("button", { name: /preview calorie target/i }).click();

    // Should show profile incomplete / missing official_weight_kg.
    await expect(page.getByText("Profile incomplete", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Cleanup.
    await svc.auth.admin.deleteUser(userId2);
  });
});
