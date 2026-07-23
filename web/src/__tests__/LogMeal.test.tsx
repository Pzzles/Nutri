// React Testing Library tests for LogMeal.
// All Edge Function calls are mocked at the network boundary (callFunction).
// No business logic is duplicated here.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogMeal from "../pages/LogMeal";

// ── Module mock ────────────────────────────────────────────────────────────────
vi.mock("../lib/supabase", () => ({
  callFunction: vi.fn(),
}));

import { callFunction } from "../lib/supabase";
const mockCallFunction = vi.mocked(callFunction);

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PARSE_RESPONSE = {
  ai_parse_request_id: "req-001",
  items: [
    { raw_phrase: "150g oatmeal", normalized_name: "oatmeal", quantity: 150, unit: "g", confidence_hint: "high", ambiguous: false },
    { raw_phrase: "50g milk",     normalized_name: "milk",    quantity: 50,  unit: "g", confidence_hint: "high", ambiguous: false },
  ],
};

const RESOLVE_OK = {
  resolved_items: [
    { raw_phrase: "150g oatmeal", normalized_query: "oatmeal", food_id: "f-oat", quantity: 150, unit: "g", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" },
    { raw_phrase: "50g milk",     normalized_query: "milk",    food_id: "f-milk", quantity: 50,  unit: "g", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" },
  ],
  clarification_required: [],
};

const CALCULATE_OK = {
  items: [
    { raw_phrase: "150g oatmeal", normalized_query: "oatmeal", food_id: "f-oat",  quantity: 150, unit: "g", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high", calories: 568.5, protein_g: 19.5, carbs_g: 102.0, fat_g: 9.8, fibre_g: 15.9, nutrition_source: "usda_fdc", portion_g: 150, portion_source: "explicit", history_use_count: null },
    { raw_phrase: "50g milk",     normalized_query: "milk",    food_id: "f-milk", quantity: 50,  unit: "g", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high", calories: 30.5,  protein_g: 1.6,  carbs_g: 2.4,   fat_g: 1.7, fibre_g: 0,    nutrition_source: "usda_fdc", portion_g: 50,  portion_source: "explicit", history_use_count: null },
  ],
  clarification_required: [],
  meal_totals: { calories: 599.0, protein_g: 21.1, carbs_g: 104.4, fat_g: 11.5, fibre_g: 15.9 },
  meal_confidence: "high",
};

const LOG_MEAL_OK = { meal_id: "meal-abc", meal_confidence: "high" };

function setupHappyPath() {
  mockCallFunction
    .mockResolvedValueOnce(PARSE_RESPONSE)
    .mockResolvedValueOnce(RESOLVE_OK)
    .mockResolvedValueOnce(CALCULATE_OK);
}

async function parseAndReview() {
  const user = userEvent.setup();
  render(<LogMeal />);
  await user.type(screen.getByRole("textbox"), "150g oatmeal, 50g milk");
  await user.click(screen.getByRole("button", { name: /parse meal/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /confirm & log/i })).toBeInTheDocument());
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe("happy path", () => {
  it("shows calculated items and totals after parsing", async () => {
    setupHappyPath();
    await parseAndReview();

    expect(screen.getByText("150g oatmeal")).toBeInTheDocument();
    expect(screen.getByText("50g milk")).toBeInTheDocument();
    expect(screen.getByText(/599/)).toBeInTheDocument(); // calories total
  });

  it("confirm & log is enabled when all items resolved and no clarifications", async () => {
    setupHappyPath();
    await parseAndReview();
    expect(screen.getByRole("button", { name: /confirm & log/i })).not.toBeDisabled();
  });

  it("clicking Confirm & log calls log-meal", async () => {
    setupHappyPath();
    mockCallFunction.mockResolvedValueOnce(LOG_MEAL_OK);
    const user = await parseAndReview();
    await user.click(screen.getByRole("button", { name: /confirm & log/i }));
    await waitFor(() => expect(screen.getByText(/meal logged/i)).toBeInTheDocument());
    expect(mockCallFunction).toHaveBeenCalledWith("log-meal", expect.objectContaining({ source: "draft" }));
  });
});

// ── Confirm & log disabled state ──────────────────────────────────────────────

describe("Confirm & log disabled state", () => {
  it("is disabled initially (no items yet)", () => {
    render(<LogMeal />);
    // Confirm button only shows in reviewing step, so we verify it's not present initially
    expect(screen.queryByRole("button", { name: /confirm & log/i })).not.toBeInTheDocument();
  });

  it("is disabled while any unresolved clarification remains", async () => {
    mockCallFunction
      .mockResolvedValueOnce(PARSE_RESPONSE)
      .mockResolvedValueOnce({
        resolved_items: [RESOLVE_OK.resolved_items[0]],
        clarification_required: [{ raw_phrase: "50g milk", reason: "no_food_match" }],
      })
      .mockResolvedValueOnce({
        ...CALCULATE_OK,
        items: [CALCULATE_OK.items[0]],
        meal_totals: { calories: 568.5, protein_g: 19.5, carbs_g: 102.0, fat_g: 9.8, fibre_g: 15.9 },
      });

    await parseAndReview();
    expect(screen.getByRole("button", { name: /confirm & log/i })).toBeDisabled();
  });

  it("becomes enabled after removing the only clarification", async () => {
    mockCallFunction
      .mockResolvedValueOnce(PARSE_RESPONSE)
      .mockResolvedValueOnce({
        resolved_items: [RESOLVE_OK.resolved_items[0]],
        clarification_required: [{ raw_phrase: "50g milk", reason: "no_food_match" }],
      })
      .mockResolvedValueOnce({
        ...CALCULATE_OK,
        items: [CALCULATE_OK.items[0]],
        meal_totals: { calories: 568.5, protein_g: 19.5, carbs_g: 102.0, fat_g: 9.8, fibre_g: 15.9 },
      });

    const user = await parseAndReview();

    const removeBtn = screen.getByRole("button", { name: /remove 50g milk/i });
    await user.click(removeBtn);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /confirm & log/i })).not.toBeDisabled(),
    );
  });
});

// ── Clarification rendering ───────────────────────────────────────────────────

describe("UNSUPPORTED_PORTION_UNIT clarification", () => {
  it("displays the raw unsupported unit", async () => {
    mockCallFunction
      .mockResolvedValueOnce({ ai_parse_request_id: "r", items: [{ raw_phrase: "2 oz chicken", normalized_name: "chicken", quantity: 2, unit: "oz", confidence_hint: "high", ambiguous: false }] })
      .mockResolvedValueOnce({ resolved_items: [{ raw_phrase: "2 oz chicken", normalized_query: "chicken", food_id: "f-chk", quantity: 2, unit: "oz", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" }], clarification_required: [] })
      .mockResolvedValueOnce({ items: [], clarification_required: [{ raw_phrase: "2 oz chicken", food_id: "f-chk", code: "UNSUPPORTED_PORTION_UNIT", raw_unit: "oz", message: '"oz" is not a recognised portion unit.' }], meal_totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, meal_confidence: "low" });

    const user = userEvent.setup();
    render(<LogMeal />);
    await user.type(screen.getByRole("textbox"), "2 oz chicken");
    await user.click(screen.getByRole("button", { name: /parse meal/i }));
    await waitFor(() => screen.getByText(/"oz" is not a recognised portion unit\./));

    expect(screen.getByText(/"oz" is not a recognised portion unit\./)).toBeInTheDocument();
  });
});

describe("LIKELY_UNIT_ERROR clarification", () => {
  it("displays the suggested grams", async () => {
    mockCallFunction
      .mockResolvedValueOnce({ ai_parse_request_id: "r", items: [{ raw_phrase: "150mg oatmeal", normalized_name: "oatmeal", quantity: 150, unit: "mg", confidence_hint: "high", ambiguous: false }] })
      .mockResolvedValueOnce({ resolved_items: [{ raw_phrase: "150mg oatmeal", normalized_query: "oatmeal", food_id: "f-oat", quantity: 150, unit: "mg", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" }], clarification_required: [] })
      .mockResolvedValueOnce({ items: [], clarification_required: [{ raw_phrase: "150mg oatmeal", food_id: "f-oat", code: "LIKELY_UNIT_ERROR", raw_unit: "mg", message: "Did you mean 150 g?", suggested_unit: "g", suggested_qty: 150 }], meal_totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, meal_confidence: "low" });

    const user = userEvent.setup();
    render(<LogMeal />);
    await user.type(screen.getByRole("textbox"), "150mg oatmeal");
    await user.click(screen.getByRole("button", { name: /parse meal/i }));
    await waitFor(() => expect(screen.getAllByText(/Did you mean 150 g\?/).length).toBeGreaterThan(0));

    expect(screen.getAllByText(/Did you mean 150 g\?/)[0]).toBeInTheDocument();
  });
});

describe("EXTREME_PORTION clarification", () => {
  it("shows the Confirm amount button", async () => {
    mockCallFunction
      .mockResolvedValueOnce({ ai_parse_request_id: "r", items: [{ raw_phrase: "3kg chicken", normalized_name: "chicken", quantity: 3, unit: "kg", confidence_hint: "high", ambiguous: false }] })
      .mockResolvedValueOnce({ resolved_items: [{ raw_phrase: "3kg chicken", normalized_query: "chicken", food_id: "f-chk", quantity: 3, unit: "kg", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" }], clarification_required: [] })
      .mockResolvedValueOnce({ items: [], clarification_required: [{ raw_phrase: "3kg chicken", food_id: "f-chk", code: "EXTREME_PORTION", raw_unit: "kg", message: "3000 g is above the 2000 g safety threshold." }], meal_totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, meal_confidence: "low" });

    const user = userEvent.setup();
    render(<LogMeal />);
    await user.type(screen.getByRole("textbox"), "3kg chicken");
    await user.click(screen.getByRole("button", { name: /parse meal/i }));
    await waitFor(() => screen.getByRole("button", { name: /confirm amount/i }));

    expect(screen.getByRole("button", { name: /confirm amount/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm & log/i })).toBeDisabled();
  });

  it("clicking Confirm amount re-runs calculate-meal and enables logging", async () => {
    const extremeCalculated = { items: [{ ...CALCULATE_OK.items[0], raw_phrase: "3kg chicken", grams: 3000, calories: 4950, food_id: "f-chk", portion_g: 3000 }], clarification_required: [], meal_totals: { calories: 4950, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, meal_confidence: "high" };

    mockCallFunction
      .mockResolvedValueOnce({ ai_parse_request_id: "r", items: [{ raw_phrase: "3kg chicken", normalized_name: "chicken", quantity: 3, unit: "kg", confidence_hint: "high", ambiguous: false }] })
      .mockResolvedValueOnce({ resolved_items: [{ raw_phrase: "3kg chicken", normalized_query: "chicken", food_id: "f-chk", quantity: 3, unit: "kg", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" }], clarification_required: [] })
      .mockResolvedValueOnce({ items: [], clarification_required: [{ raw_phrase: "3kg chicken", food_id: "f-chk", code: "EXTREME_PORTION", raw_unit: "kg", message: "3000 g is above the 2000 g safety threshold." }], meal_totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, meal_confidence: "low" })
      .mockResolvedValueOnce(extremeCalculated); // re-run with confirmed

    const user = userEvent.setup();
    render(<LogMeal />);
    await user.type(screen.getByRole("textbox"), "3kg chicken");
    await user.click(screen.getByRole("button", { name: /parse meal/i }));
    await waitFor(() => screen.getByRole("button", { name: /confirm amount/i }));
    await user.click(screen.getByRole("button", { name: /confirm amount/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /confirm & log/i })).not.toBeDisabled());
    // Verify the re-run was called with extreme_confirmed_ids
    expect(mockCallFunction).toHaveBeenCalledWith("calculate-meal", expect.objectContaining({
      extreme_confirmed_ids: expect.arrayContaining(["f-chk"]),
    }));
  });
});

describe("food_form_ambiguous clarification", () => {
  it("displays all candidate options", async () => {
    mockCallFunction
      .mockResolvedValueOnce({ ai_parse_request_id: "r", items: [{ raw_phrase: "oatmeal", normalized_name: "oatmeal", quantity: null, unit: null, confidence_hint: "low", ambiguous: false }] })
      .mockResolvedValueOnce({
        resolved_items: [],
        clarification_required: [{
          raw_phrase: "oatmeal",
          reason: "food_form_ambiguous",
          options: [
            { food_id: "f1", name: "Oats, dry", calories_100g: 380, serving_size_g: 40 },
            { food_id: "f2", name: "Oatmeal, cooked", calories_100g: 71, serving_size_g: null },
          ],
        }],
      })
      // No calculate-meal call since no resolved items

    const user = userEvent.setup();
    render(<LogMeal />);
    await user.type(screen.getByRole("textbox"), "oatmeal");
    await user.click(screen.getByRole("button", { name: /parse meal/i }));
    await waitFor(() => screen.getByText(/Oats, dry/));

    expect(screen.getByText(/Oats, dry/)).toBeInTheDocument();
    expect(screen.getByText(/Oatmeal, cooked/)).toBeInTheDocument();
    expect(screen.getByText(/380 kcal\/100g/)).toBeInTheDocument();
    expect(screen.getByText(/71 kcal\/100g/)).toBeInTheDocument();
  });
});

// ── Totals exclude unresolved items ──────────────────────────────────────────

describe("Totals exclude unresolved items", () => {
  it("totals reflect only resolved items when some have clarifications", async () => {
    mockCallFunction
      .mockResolvedValueOnce(PARSE_RESPONSE)
      .mockResolvedValueOnce({
        resolved_items: [RESOLVE_OK.resolved_items[0]], // only oatmeal resolved
        clarification_required: [{ raw_phrase: "50g milk", reason: "no_food_match" }],
      })
      .mockResolvedValueOnce({
        items: [CALCULATE_OK.items[0]],
        clarification_required: [],
        meal_totals: { calories: 568.5, protein_g: 19.5, carbs_g: 102.0, fat_g: 9.8, fibre_g: 15.9 },
        meal_confidence: "high",
      });

    await parseAndReview();
    expect(screen.getAllByText(/568/).length).toBeGreaterThan(0); // oatmeal only (may appear in item + totals)
    expect(screen.queryByText(/599/)).not.toBeInTheDocument(); // not full total
  });
});

// ── Start over ────────────────────────────────────────────────────────────────

describe("Start over", () => {
  it("clears items, totals and clarifications", async () => {
    setupHappyPath();
    const user = await parseAndReview();

    await user.click(screen.getByRole("button", { name: /start over/i }));

    expect(screen.queryByText("150g oatmeal")).not.toBeInTheDocument();
    expect(screen.queryByText(/confirm & log/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});

// ── Failed recalculation ──────────────────────────────────────────────────────

describe("Failed recalculation", () => {
  it("a failed recalculation does not accidentally enable Confirm & log", async () => {
    // Setup: initial parse returns an extreme portion
    mockCallFunction
      .mockResolvedValueOnce({ ai_parse_request_id: "r", items: [{ raw_phrase: "3kg chicken", normalized_name: "chicken", quantity: 3, unit: "kg", confidence_hint: "high", ambiguous: false }] })
      .mockResolvedValueOnce({ resolved_items: [{ raw_phrase: "3kg chicken", normalized_query: "chicken", food_id: "f-chk", quantity: 3, unit: "kg", match_confidence: "exact", portion_confidence: "exact", item_confidence: "high" }], clarification_required: [] })
      .mockResolvedValueOnce({ items: [], clarification_required: [{ raw_phrase: "3kg chicken", food_id: "f-chk", code: "EXTREME_PORTION", raw_unit: "kg", message: "3000 g is above the 2000 g safety threshold." }], meal_totals: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fibre_g: 0 }, meal_confidence: "low" })
      .mockRejectedValueOnce(new Error("Network error on recalculation"));

    const user = userEvent.setup();
    render(<LogMeal />);
    await user.type(screen.getByRole("textbox"), "3kg chicken");
    await user.click(screen.getByRole("button", { name: /parse meal/i }));
    await waitFor(() => screen.getByRole("button", { name: /confirm amount/i }));
    await user.click(screen.getByRole("button", { name: /confirm amount/i }));

    await waitFor(() => screen.getByText(/network error on recalculation/i));
    // Button must remain disabled because the recalculation failed
    expect(screen.getByRole("button", { name: /confirm & log/i })).toBeDisabled();
  });
});

// ── Double-submit protection ──────────────────────────────────────────────────

describe("Double-submit protection", () => {
  it("rapid double-click on Confirm does not create duplicate requests", async () => {
    setupHappyPath();
    // log-meal resolves slowly
    let resolveLogMeal!: () => void;
    const logMealPromise = new Promise<typeof LOG_MEAL_OK>((resolve) => {
      resolveLogMeal = () => resolve(LOG_MEAL_OK);
    });
    mockCallFunction.mockImplementationOnce(() => logMealPromise);

    const user = await parseAndReview();
    const confirmBtn = screen.getByRole("button", { name: /confirm & log/i });

    // First click
    await user.click(confirmBtn);
    // Button is disabled while loading, so a second click should be a no-op
    await user.click(confirmBtn);

    resolveLogMeal();
    await waitFor(() => screen.getByText(/meal logged/i));

    const logMealCalls = mockCallFunction.mock.calls.filter(([name]) => name === "log-meal");
    expect(logMealCalls).toHaveLength(1);
  });
});
