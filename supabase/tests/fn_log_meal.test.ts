// Integration tests for fn_log_meal.
// Requires: supabase start
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser, signInAs, deleteTestUser,
  insertGlobalFood, deleteFood, deleteUserMeals,
  makeLogMealItem, testEmail, svcClient,
} from "./helpers.js";

const EMAIL = testEmail("logmeal");
let userId = "";
let foodId = "";
let authedClient: Awaited<ReturnType<typeof signInAs>>["client"];

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  ({ client: authedClient } = await signInAs(EMAIL));
  foodId = await insertGlobalFood();
});

afterAll(async () => {
  await deleteUserMeals(userId);
  await deleteFood(foodId);
  await deleteTestUser(userId);
});

// ── Core correctness ──────────────────────────────────────────────────────────

describe("fn_log_meal — core correctness", () => {
  it("returns a valid UUID on success", async () => {
    const { data, error } = await authedClient.rpc("fn_log_meal", {
      p_user_id: userId,
      p_meal_type: "breakfast",
      p_eaten_at: new Date().toISOString(),
      p_logged_date: "2026-07-23",
      p_meal_confidence: "high",
      p_raw_input: "150g test food",
      p_parsed_json: [],
      p_items: [makeLogMealItem(foodId)],
    });

    expect(error).toBeNull();
    expect(typeof data).toBe("string");
    expect(data).toMatch(/^[0-9a-f-]{36}$/i); // UUID format
  });

  it("inserts a meal row with the correct fields", async () => {
    const eatenAt = "2026-07-23T07:00:00Z";
    const { data: mealId, error } = await authedClient.rpc("fn_log_meal", {
      p_user_id: userId,
      p_meal_type: "lunch",
      p_eaten_at: eatenAt,
      p_logged_date: "2026-07-23",
      p_meal_confidence: "medium",
      p_raw_input: "test input",
      p_parsed_json: [{ raw_phrase: "test" }],
      p_items: [makeLogMealItem(foodId)],
    });

    expect(error).toBeNull();

    const { data: meal } = await svcClient()
      .from("meals")
      .select("*")
      .eq("id", mealId)
      .single();

    expect(meal).not.toBeNull();
    expect(meal.user_id).toBe(userId);
    expect(meal.meal_type).toBe("lunch");
    expect(meal.meal_confidence).toBe("medium");
    expect(meal.logged_date).toBe("2026-07-23");
    expect(meal.raw_input).toBe("test input");
  });

  it("stores weight_g correctly from portion_g field in item JSON", async () => {
    const { data: mealId } = await authedClient.rpc("fn_log_meal", {
      p_user_id: userId,
      p_meal_type: "snack",
      p_eaten_at: new Date().toISOString(),
      p_logged_date: "2026-07-23",
      p_meal_confidence: "high",
      p_raw_input: "test",
      p_parsed_json: [],
      p_items: [makeLogMealItem(foodId, { portion_g: 250, calories: 250 })],
    });

    const { data: items } = await svcClient()
      .from("meal_items")
      .select("weight_g, calories")
      .eq("meal_id", mealId);

    expect(items).toHaveLength(1);
    expect(Number(items![0].weight_g)).toBe(250);
    expect(Number(items![0].calories)).toBe(250);
  });

  it("inserts all items when multiple are provided", async () => {
    const { data: mealId } = await authedClient.rpc("fn_log_meal", {
      p_user_id: userId,
      p_meal_type: "dinner",
      p_eaten_at: new Date().toISOString(),
      p_logged_date: "2026-07-23",
      p_meal_confidence: "high",
      p_raw_input: "two items",
      p_parsed_json: [],
      p_items: [
        makeLogMealItem(foodId, { portion_g: 100, calories: 100 }),
        makeLogMealItem(foodId, { portion_g: 200, calories: 200 }),
      ],
    });

    const { data: items } = await svcClient()
      .from("meal_items")
      .select("weight_g")
      .eq("meal_id", mealId)
      .order("weight_g");

    expect(items).toHaveLength(2);
    expect(Number(items![0].weight_g)).toBe(100);
    expect(Number(items![1].weight_g)).toBe(200);
  });

  it("stores item_confidence in the 'confidence' column", async () => {
    const { data: mealId } = await authedClient.rpc("fn_log_meal", {
      p_user_id: userId,
      p_meal_type: "breakfast",
      p_eaten_at: new Date().toISOString(),
      p_logged_date: "2026-07-23",
      p_meal_confidence: "high",
      p_raw_input: "test",
      p_parsed_json: [],
      p_items: [makeLogMealItem(foodId, { item_confidence: "low" })],
    });

    const { data: items } = await svcClient()
      .from("meal_items")
      .select("confidence")
      .eq("meal_id", mealId);

    expect(items![0].confidence).toBe("low");
  });
});

// ── Atomicity ─────────────────────────────────────────────────────────────────

describe("fn_log_meal — atomicity", () => {
  it("rolls back the entire transaction when one item has an invalid food_id", async () => {
    const INVALID_FOOD_ID = "00000000-0000-0000-0000-000000000099";

    const beforeCount = await svcClient()
      .from("meals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .then((r) => r.count ?? 0);

    const { error } = await authedClient.rpc("fn_log_meal", {
      p_user_id: userId,
      p_meal_type: "breakfast",
      p_eaten_at: new Date().toISOString(),
      p_logged_date: "2026-07-23",
      p_meal_confidence: "high",
      p_raw_input: "partial fail",
      p_parsed_json: [],
      p_items: [
        makeLogMealItem(foodId),                      // valid
        makeLogMealItem(INVALID_FOOD_ID),             // FK violation → rolls back all
      ],
    });

    expect(error).not.toBeNull();

    const afterCount = await svcClient()
      .from("meals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .then((r) => r.count ?? 0);

    expect(afterCount).toBe(beforeCount); // no new meal was created
  });
});

// ── User isolation ────────────────────────────────────────────────────────────

describe("fn_log_meal — user isolation", () => {
  it("raises an error when p_user_id does not match auth.uid()", async () => {
    const EMAIL_B = testEmail("logmeal-other");
    const userBId = await createTestUser(EMAIL_B);

    try {
      const { error } = await authedClient.rpc("fn_log_meal", {
        p_user_id: userBId, // wrong user
        p_meal_type: "breakfast",
        p_eaten_at: new Date().toISOString(),
        p_logged_date: "2026-07-23",
        p_meal_confidence: "high",
        p_raw_input: "test",
        p_parsed_json: [],
        p_items: [makeLogMealItem(foodId)],
      });

      expect(error).not.toBeNull();
    } finally {
      await deleteTestUser(userBId);
    }
  });
});
