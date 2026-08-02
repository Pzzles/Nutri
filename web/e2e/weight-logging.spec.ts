// Playwright E2E tests for weight logging.
// All edge function calls intercepted at the network boundary.
import { test, expect, type Page, type Route } from "@playwright/test";

function ok(data: unknown) {
  return JSON.stringify({ success: true, data });
}
function fulfill(route: Route, data: unknown) {
  return route.fulfill({ status: 200, contentType: "application/json", body: ok(data) });
}

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

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
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

const WEIGHT_LOG = {
  id: "wl-001",
  user_id: "user-001",
  weight_kg: 85.5,
  measured_at: "2026-07-23T07:00:00.000Z",
  logged_date: "2026-07-23",
  is_official: true,
  notes: null,
  created_at: "2026-07-23T07:00:00.000Z",
};

const DASHBOARD_BASE = {
  date: "2026-07-23",
  totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 },
  goal: null,
  percent_of_goal: null,
  active_phase: null,
  daily_log_status: { status: "unknown", marked_complete_at: null, reopened_at: null },
  weight_change: null,
};

// ── Test 1: Dashboard shows latest weight tile ─────────────────────────────────

test("dashboard shows latest weight and links to /weight", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/dashboard-summary", (route) =>
    fulfill(route, { ...DASHBOARD_BASE, latest_weight: { weight_kg: 85.5, measured_at: "2026-07-23T07:00:00Z", logged_date: "2026-07-23" } }),
  );

  await page.goto(BASE);

  await expect(page.getByText("85.5")).toBeVisible();
  await expect(page.getByText(/log weight/i)).toBeVisible();
});

test("dashboard shows 'No weight logged yet' when no weight exists", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/dashboard-summary", (route) =>
    fulfill(route, { ...DASHBOARD_BASE, latest_weight: null }),
  );

  await page.goto(BASE);

  await expect(page.getByText(/no weight logged yet/i)).toBeVisible();
});

// ── Test 2: Weight page loads history ─────────────────────────────────────────

test("weight page displays log history", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/get-weight-logs**", (route) =>
    fulfill(route, { logs: [WEIGHT_LOG], latest_official: WEIGHT_LOG }),
  );

  await page.goto(`${BASE}/weight`);

  await expect(page.getByText("85.5")).toBeVisible();
  await expect(page.getByText("Official")).toBeVisible();
});

// ── Test 3: Log a new weight entry ────────────────────────────────────────────

test("user can log a new weight entry and see it appear", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/get-weight-logs**", (route) =>
    fulfill(route, { logs: [], latest_official: null }),
  );

  const newLog = { ...WEIGHT_LOG, weight_kg: 84.0 };
  let logCalled = false;

  await page.route("**/functions/v1/log-weight", async (route) => {
    logCalled = true;
    const body = JSON.parse(route.request().postData() ?? "{}");
    expect(body.weight_kg).toBe(84);
    await fulfill(route, newLog);
  });

  await page.goto(`${BASE}/weight`);

  await page.getByRole("spinbutton", { name: /weight/i }).fill("84");
  await page.getByRole("button", { name: /^log$/i }).click();

  await expect(page.getByText("84")).toBeVisible();
  expect(logCalled).toBe(true);
});

// ── Test 4: Validation prevents bad input ──────────────────────────────────────

test("weight page blocks submission with weight below 20", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/get-weight-logs**", (route) =>
    fulfill(route, { logs: [], latest_official: null }),
  );

  await page.route("**/functions/v1/log-weight", (route) => {
    throw new Error("log-weight should not be called for invalid input");
  });

  await page.goto(`${BASE}/weight`);

  await page.getByRole("spinbutton", { name: /weight/i }).fill("10");
  await page.getByRole("button", { name: /^log$/i }).click();

  await expect(page.getByText(/between 20 and 300/i)).toBeVisible();
});

// ── Test 5: NavBar Weight link navigates to /weight ───────────────────────────

test("Weight link in nav takes user to the weight page", async ({ page }) => {
  await stubAuth(page);

  await page.route("**/functions/v1/dashboard-summary", (route) =>
    fulfill(route, { ...DASHBOARD_BASE, latest_weight: null }),
  );
  await page.route("**/functions/v1/get-weight-logs**", (route) =>
    fulfill(route, { logs: [], latest_official: null }),
  );

  await page.goto(BASE);
  await page.getByRole("link", { name: /^weight$/i }).click();

  await expect(page).toHaveURL(/\/weight/);
  await expect(page.getByRole("heading", { name: /^weight$/i })).toBeVisible();
});
