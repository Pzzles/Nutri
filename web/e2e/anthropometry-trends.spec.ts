import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

async function stubAuth(page: Page) {
  const session = {
    access_token: "stub-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "stub-refresh",
    user: { id: "user-trends", email: "trends@test.local", aud: "authenticated" },
  };
  await page.addInitScript((storedSession) => {
    localStorage.setItem("sb-ipdrzvqhprboqqjhjldj-auth-token", JSON.stringify(storedSession));
    localStorage.setItem("sb-127-auth-token", JSON.stringify(storedSession));
  }, session);
  await page.route("**/auth/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: route.request().url().includes("/user")
      ? JSON.stringify(session.user)
      : "{}",
  }));
}

test("mobile history shows real points and a cautious server-authored comparison", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubAuth(page);
  await page.route("**/functions/v1/get-anthropometric-progress**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      success: true,
      data: {
        series: [
          {
            site_code: "waist",
            points: [
              { session_id: "w1", site_code: "waist", measured_at: "2026-06-07T05:00:00Z", logged_date: "2026-06-07", representative_cm: 92.1, quality: "within_repeatability_threshold" },
              { session_id: "w2", site_code: "waist", measured_at: "2026-08-02T05:00:00Z", logged_date: "2026-08-02", representative_cm: 88.7, quality: "within_repeatability_threshold" },
            ],
            previous_change: { start_session_id: "w1", end_session_id: "w2", change_cm: -3.4, elapsed_days: 56 },
            since_first_change: { start_session_id: "w1", end_session_id: "w2", change_cm: -3.4, elapsed_days: 56 },
          },
          {
            site_code: "abdomen_navel",
            points: [
              { session_id: "n1", site_code: "abdomen_navel", measured_at: "2026-07-01T05:00:00Z", logged_date: "2026-07-01", representative_cm: 99, quality: "within_repeatability_threshold" },
            ],
            previous_change: null,
            since_first_change: null,
          },
        ],
        weight_comparison: {
          eligible: true,
          site_code: "waist",
          circumference: { start_session_id: "w1", end_session_id: "w2", change_cm: -3.4, direction: "decreased" },
          weight_trend: { start_point_measured_at: "2026-06-07T05:15:00Z", end_point_measured_at: "2026-08-02T04:50:00Z", start_kg: 80.2, end_kg: 80.3, change_kg: 0.1, stable_band_kg: 0.5, direction: "broadly_stable" },
          description: "Weight trend was broadly stable while waist circumference decreased.",
        },
        algorithm_versions: {
          change: "anthropometry_change_v1",
          weight_comparison: "anthropometry_weight_comparison_v1",
          weight_trend: "weight_trend_v1",
        },
        limitations: [
          "Circumference changes can reflect combinations of fat, muscle, glycogen, fluid, digestion, breathing, posture, and measurement technique.",
          "This feature does not measure body-fat percentage, muscle mass, visceral fat, or body recomposition.",
          "The weight comparison is descriptive and does not alter calorie targets or goal feedback.",
        ],
      },
      error: null,
    }),
  }));

  await page.goto(`${BASE}/measurements`);
  await page.getByRole("tab", { name: /history & trends/i }).click();
  await expect(page.getByRole("heading", { name: /circumference trend/i })).toBeVisible();
  await expect(page.getByRole("img", { name: /2 recorded points.*no smoothing or interpolated values/i })).toBeVisible();
  await expect(page.getByText("Weight trend was broadly stable while waist circumference decreased.")).toBeVisible();
  await expect(page.getByText(/does not infer fat loss, muscle gain or body recomposition/i)).toBeVisible();
  await expect(page.getByText("−3.4 cm").first()).toBeVisible();

  await page.getByRole("combobox", { name: /measurement site/i }).selectOption("abdomen_navel");
  await expect(page.getByText(/not the WHO waist measurement/i)).toBeVisible();
  await expect(page.getByText(/not enough data/i).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
