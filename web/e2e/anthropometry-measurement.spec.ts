import { expect, test, type Page, type Route } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

function envelope(data: unknown) {
  return JSON.stringify({ success: true, data, error: null });
}

async function stubAuth(page: Page) {
  const session = {
    access_token: "stub-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "stub-refresh",
    user: { id: "user-001", email: "test@test.local", aud: "authenticated" },
  };
  await page.addInitScript((storedSession) => {
    localStorage.setItem("sb-ipdrzvqhprboqqjhjldj-auth-token", JSON.stringify(storedSession));
    localStorage.setItem("sb-127-auth-token", JSON.stringify(storedSession));
  }, session);
  await page.route("**/auth/v1/**", (route) => {
    if (route.request().url().includes("/user")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session.user),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

function savedResponse(status: "draft" | "finalized", sites: unknown[] = []) {
  return {
    session: {
      id: "session-mobile-001",
      status,
      measured_at: new Date().toISOString(),
      notes: null,
      finalized_at: status === "finalized" ? new Date().toISOString() : null,
      measurement_context: {
        version: "anthropometry_measurement_context_v1", local_time: "07:00:00",
        meal_timing: "after_food", after_bathroom: true,
        exercise_within_previous_12_hours: false,
        measurement_assistance: "assisted", clothing_level: "light",
      },
    },
    sites,
    replayed: false,
    algorithm_versions: {
      data_contract: "anthropometry_data_contract_v4",
      protocol: "anthropometry_protocol_v1",
      representative: status === "finalized" ? "anthropometry_representative_v3" : null,
      repeatability_thresholds:
        status === "finalized" ? "anthropometry_repeatability_thresholds_v2" : null,
      measurement_context: "anthropometry_measurement_context_v1",
    },
  };
}

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: envelope(data) });
}

test("mobile guided circuit completes with an accessible third-reading warning", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubAuth(page);

  const draftBodies: Array<Record<string, unknown>> = [];
  await page.route("**/functions/v1/save-anthropometric-session", async (route) => {
    draftBodies.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    await fulfill(route, savedResponse("draft"));
  });
  await page.route("**/functions/v1/finalize-anthropometric-session", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      sites: Array<{ site_code: string; readings_cm: number[] }>;
      measurement_context: Record<string, unknown>;
    };
    expect(body.sites).toEqual([{ site_code: "waist", readings_cm: [80, 81.2, 80.5] }]);
    expect(body.measurement_context).toEqual({
      meal_timing: "after_food", after_bathroom: true,
      exercise_within_previous_12_hours: false,
      measurement_assistance: "assisted", clothing_level: "light",
    });
    await fulfill(route, savedResponse("finalized", [{
      site_code: "waist",
      readings_cm: [80, 81.2, 80.5],
      representative_cm: 80.25,
      method: "mean_of_closest_pair",
      reading_count: 3,
      initial_pair_difference_cm: 1.2,
      all_readings_range_cm: 1.2,
      quality: "pair_agree",
      quality_flags: [],
      selected_reading_indices: [1, 3],
      selected_pair_spread_cm: 0.5,
      warning_codes: [],
      eligible_for_interpretation: true,
    }]));
  });

  await page.goto(`${BASE}/measurements`);
  await expect(page.getByRole("heading", { name: /guided measurement session/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("checkbox", { name: /^Waist \(WHO midpoint\)/i }).check();
  await page.getByRole("combobox", { name: /food timing/i }).selectOption("after_food");
  await page.getByRole("combobox", { name: /measurement help/i }).selectOption("assisted");
  await page.getByRole("combobox", { name: /clothing level/i }).selectOption("light");
  await page.getByRole("combobox", { name: /after using the bathroom/i }).selectOption("true");
  await page.getByRole("combobox", { name: /exercise in the previous 12 hours/i }).selectOption("false");
  await page.getByRole("checkbox", { name: /reviewed the preparation/i }).check();
  await page.getByRole("button", { name: /Begin with 1 site/i }).click();

  const first = page.getByRole("spinbutton", { name: /Reading 1 in centimetres/i });
  await expect(first).toBeFocused();
  await first.fill("80.0");
  await first.press("Enter");
  const second = page.getByRole("spinbutton", { name: /Reading 2 in centimetres/i });
  await second.fill("81.2");
  await second.press("Enter");

  await expect(page.getByText("Resolution circuit")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Tape position, posture, breathing");
  const third = page.getByRole("spinbutton", { name: /Reading 3 in centimetres/i });
  await third.fill("80.5");
  await third.press("Enter");

  await expect(page.getByRole("heading", { name: /check your raw readings/i })).toBeVisible();
  await page.getByRole("button", { name: /Finalize session/i }).click();
  await expect(page.getByRole("heading", { name: /session finalized/i })).toBeVisible();
  await expect(page.getByText("80.3 cm")).toBeVisible();
  expect(draftBodies.length).toBe(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
