import { test, expect, type Page, type Route } from "@playwright/test";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const FOOD_ID   = "00000000-0000-0000-0000-000000000001";
const FOOD_ID_2 = "00000000-0000-0000-0000-000000000002";

function ok(data: unknown): string {
  return JSON.stringify({ success: true, data });
}

const PARSED_ITEM = {
  raw_phrase: "150g chicken breast",
  normalized_name: "chicken breast",
  quantity: 150,
  unit: "g",
  confidence_hint: "high",
  ambiguous: false,
};

const RESOLVED_ITEM = {
  raw_phrase: "150g chicken breast",
  normalized_query: "chicken breast",
  food_id: FOOD_ID,
  quantity: 150,
  unit: "g",
  match_confidence: "exact",
  portion_confidence: "exact",
  item_confidence: "high",
};

const CALC_ITEM = {
  ...RESOLVED_ITEM,
  portion_g: 150,
  calories: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
  fibre_g: 0,
  nutrition_source: "usda_fdc",
  portion_source: "explicit",
  history_use_count: null,
};

const MEAL_TOTALS = { calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, fibre_g: 0 };

// Route helper: fulfill with ok(data) JSON
function fulfill(route: Route, data: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: ok(data),
  });
}

// Mount standard parse-meal and resolve-foods mocks (same in most tests).
async function mockParseAndResolve(page: Page, resolveOverrides: object = {}) {
  await page.route("**/functions/v1/parse-meal", (route) =>
    fulfill(route, {
      ai_parse_request_id: "req-001",
      items: [PARSED_ITEM],
    }),
  );
  await page.route("**/functions/v1/resolve-foods", (route) =>
    fulfill(route, {
      resolved_items: [RESOLVED_ITEM],
      clarification_required: [],
      ...resolveOverrides,
    }),
  );
}

// Navigate to /log and wait until the textarea is visible (auth complete).
async function goToLogMeal(page: Page) {
  await page.goto("/log");
  await expect(page.getByRole("textbox")).toBeVisible({ timeout: 15_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test("standard logging flow: parse → review → confirm → logged", async ({ page }) => {
  await mockParseAndResolve(page);

  await page.route("**/functions/v1/calculate-meal", (route) =>
    fulfill(route, {
      items: [CALC_ITEM],
      clarification_required: [],
      meal_totals: MEAL_TOTALS,
      meal_confidence: "high",
    }),
  );

  await page.route("**/functions/v1/log-meal", (route) =>
    fulfill(route, { meal_id: "meal-uuid-001", meal_confidence: "high" }),
  );

  await goToLogMeal(page);
  await page.getByRole("textbox").fill("150g chicken breast");
  await page.getByRole("button", { name: /parse meal/i }).click();

  // Items panel appears
  await expect(page.getByText("150g chicken breast")).toBeVisible();

  // Totals shown
  await expect(page.getByText(/165 kcal total/)).toBeVisible();

  // Confirm & log is enabled
  const confirmBtn = page.getByRole("button", { name: /confirm & log/i });
  await expect(confirmBtn).toBeEnabled();

  await confirmBtn.click();

  // Success state
  await expect(page.getByText(/meal logged/i)).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────

test("LIKELY_UNIT_ERROR: suggestion shown, confirm disabled", async ({ page }) => {
  await mockParseAndResolve(page);

  await page.route("**/functions/v1/calculate-meal", (route) =>
    fulfill(route, {
      items: [],
      clarification_required: [
        {
          raw_phrase: "150mg chicken breast",
          food_id: FOOD_ID,
          code: "LIKELY_UNIT_ERROR",
          raw_unit: "mg",
          message: "150mg is an unusual amount.",
          suggested_unit: "g",
          suggested_qty: 150,
        },
      ],
      meal_totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 },
      meal_confidence: "low",
    }),
  );

  await goToLogMeal(page);
  await page.getByRole("textbox").fill("150mg chicken breast");
  await page.getByRole("button", { name: /parse meal/i }).click();

  // "Did you mean X g?" hint is shown
  await expect(page.getByText(/Did you mean 150 g\?/)).toBeVisible();

  // Confirm & log is disabled — items.length === 0 and there are clarifications
  const confirmBtn = page.getByRole("button", { name: /confirm & log/i });
  await expect(confirmBtn).toBeDisabled();
});

// ─────────────────────────────────────────────────────────────────────────────

test("unsupported unit: error message shown, Remove button dismisses it", async ({ page }) => {
  await page.route("**/functions/v1/parse-meal", (route) =>
    fulfill(route, {
      ai_parse_request_id: "req-002",
      items: [
        PARSED_ITEM,
        {
          raw_phrase: "1 tsp olive oil",
          normalized_name: "olive oil",
          quantity: 1,
          unit: "tsp",
          confidence_hint: "low",
          ambiguous: false,
        },
      ],
    }),
  );

  await page.route("**/functions/v1/resolve-foods", (route) =>
    fulfill(route, {
      resolved_items: [
        RESOLVED_ITEM,
        {
          raw_phrase: "1 tsp olive oil",
          normalized_query: "olive oil",
          food_id: FOOD_ID_2,
          quantity: 1,
          unit: "tsp",
          match_confidence: "exact",
          portion_confidence: "exact",
          item_confidence: "medium",
        },
      ],
      clarification_required: [],
    }),
  );

  await page.route("**/functions/v1/calculate-meal", (route) =>
    fulfill(route, {
      items: [CALC_ITEM],
      clarification_required: [
        {
          raw_phrase: "1 tsp olive oil",
          food_id: FOOD_ID_2,
          code: "UNSUPPORTED_PORTION_UNIT",
          raw_unit: "tsp",
          message: "Teaspoons are not supported; enter an amount in grams.",
          suggested_unit: null,
          suggested_qty: null,
        },
      ],
      meal_totals: MEAL_TOTALS,
      meal_confidence: "high",
    }),
  );

  await goToLogMeal(page);
  await page.getByRole("textbox").fill("150g chicken breast, 1 tsp olive oil");
  await page.getByRole("button", { name: /parse meal/i }).click();

  // Clarification message is shown
  await expect(page.getByText(/Teaspoons are not supported/)).toBeVisible();

  // Confirm & log disabled while there is a clarification
  const confirmBtn = page.getByRole("button", { name: /confirm & log/i });
  await expect(confirmBtn).toBeDisabled();

  // Remove the clarification
  await page.getByRole("button", { name: /Remove 1 tsp olive oil/i }).click();

  // Confirm & log is now enabled (1 item remains, 0 clarifications)
  await expect(confirmBtn).toBeEnabled();
});

// ─────────────────────────────────────────────────────────────────────────────

test("EXTREME_PORTION: Confirm amount re-runs calculate-meal, then confirm enabled", async ({
  page,
}) => {
  await mockParseAndResolve(page);

  let calcCallCount = 0;
  await page.route("**/functions/v1/calculate-meal", (route) => {
    calcCallCount++;
    if (calcCallCount === 1) {
      // First call: extreme portion flagged
      fulfill(route, {
        items: [],
        clarification_required: [
          {
            raw_phrase: "150g chicken breast",
            food_id: FOOD_ID,
            code: "EXTREME_PORTION",
            raw_unit: "g",
            message: "150g is flagged as an unusually large portion.",
            suggested_unit: null,
            suggested_qty: null,
          },
        ],
        meal_totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 },
        meal_confidence: "low",
      });
    } else {
      // Second call (after user confirms extreme): return items normally
      fulfill(route, {
        items: [CALC_ITEM],
        clarification_required: [],
        meal_totals: MEAL_TOTALS,
        meal_confidence: "high",
      });
    }
  });

  await page.route("**/functions/v1/log-meal", (route) =>
    fulfill(route, { meal_id: "meal-uuid-002", meal_confidence: "high" }),
  );

  await goToLogMeal(page);
  await page.getByRole("textbox").fill("150g chicken breast");
  await page.getByRole("button", { name: /parse meal/i }).click();

  // EXTREME_PORTION clarification shown with "Confirm amount" button
  await expect(page.getByText(/flagged as an unusually large portion/)).toBeVisible();
  await expect(page.getByRole("button", { name: /confirm amount/i })).toBeVisible();

  const confirmLogBtn = page.getByRole("button", { name: /confirm & log/i });
  await expect(confirmLogBtn).toBeDisabled();

  // User confirms the extreme portion
  await page.getByRole("button", { name: /confirm amount/i }).click();

  // calculate-meal runs a second time; items appear
  await expect(page.getByText("150g chicken breast")).toBeVisible();
  await expect(page.getByText(/165 kcal total/)).toBeVisible();

  // Confirm & log is now enabled
  await expect(confirmLogBtn).toBeEnabled();

  // Can log successfully
  await confirmLogBtn.click();
  await expect(page.getByText(/meal logged/i)).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────

test("idempotency: clicking Confirm & log twice only calls log-meal once", async ({ page }) => {
  await mockParseAndResolve(page);

  await page.route("**/functions/v1/calculate-meal", (route) =>
    fulfill(route, {
      items: [CALC_ITEM],
      clarification_required: [],
      meal_totals: MEAL_TOTALS,
      meal_confidence: "high",
    }),
  );

  let logMealCalls = 0;
  await page.route("**/functions/v1/log-meal", (route) => {
    logMealCalls++;
    return fulfill(route, { meal_id: "meal-uuid-003", meal_confidence: "high" });
  });

  await goToLogMeal(page);
  await page.getByRole("textbox").fill("150g chicken breast");
  await page.getByRole("button", { name: /parse meal/i }).click();

  await expect(page.getByText(/165 kcal total/)).toBeVisible();

  const confirmBtn = page.getByRole("button", { name: /confirm & log/i });
  await expect(confirmBtn).toBeEnabled();

  // Click twice in quick succession
  await confirmBtn.click();
  // The button becomes disabled (loading=true) before the second click can fire.
  // Force-clicking a disabled button has no effect in the browser.
  await confirmBtn.click({ force: true });

  await expect(page.getByText(/meal logged/i)).toBeVisible();

  expect(logMealCalls).toBe(1);
});
