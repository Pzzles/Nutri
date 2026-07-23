// Integration tests for trg_reopen_daily_log_on_meal.
// Verifies that inserting a meal on a completed day automatically reopens
// the daily_log_status via the AFTER INSERT trigger.
// Requires: supabase start (migration 0009 applied)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser, signInAs, deleteTestUser,
  insertGlobalFood, deleteFood, deleteUserMeals,
  makeLogMealItem, svcClient, testEmail,
} from "./helpers.js";

const EMAIL = testEmail("meal-dls");
let userId = "";
let foodId = "";
const TEST_DATE = "2026-07-22";

async function setStatus(date: string, status: string) {
  return svcClient().rpc("fn_set_daily_log_status", {
    p_user_id: userId,
    p_date: date,
    p_status: status,
  });
}

async function getStatusRow(date: string) {
  const { data } = await svcClient()
    .from("daily_log_status")
    .select("*")
    .eq("user_id", userId)
    .eq("logged_date", date)
    .maybeSingle();
  return data;
}

async function logMeal(date: string) {
  const { data, error } = await svcClient().rpc("fn_log_meal", {
    p_user_id: userId,
    p_meal_type: "lunch",
    p_eaten_at: new Date().toISOString(),
    p_logged_date: date,
    p_meal_confidence: "high",
    p_raw_input: "test meal",
    p_parsed_json: [],
    p_items: [makeLogMealItem(foodId)],
  });
  if (error) throw new Error(`fn_log_meal failed: ${error.message}`);
  return data as string;
}

beforeAll(async () => {
  userId = await createTestUser(EMAIL);
  foodId = await insertGlobalFood();
  await svcClient().from("daily_log_status").delete().eq("user_id", userId);
  await deleteUserMeals(userId);
});

afterAll(async () => {
  await deleteUserMeals(userId);
  await svcClient().from("daily_log_status").delete().eq("user_id", userId);
  await deleteFood(foodId);
  await deleteTestUser(userId);
});

// ── Trigger: reopen on meal insert ────────────────────────────────────────────

describe("trg_reopen_daily_log_on_meal", () => {
  it("does NOT create a daily_log_status row when logging a meal on an unknown day", async () => {
    await logMeal(TEST_DATE);
    const row = await getStatusRow(TEST_DATE);
    expect(row).toBeNull();
  });

  it("reopens a complete day when a meal is logged", async () => {
    // Mark the day complete.
    const { data: statusBefore } = await setStatus(TEST_DATE, "complete");
    expect(statusBefore.status).toBe("complete");
    const completedAt = statusBefore.marked_complete_at;
    expect(completedAt).toBeTruthy();

    // Log a meal — trigger should fire.
    await logMeal(TEST_DATE);

    const row = await getStatusRow(TEST_DATE);
    expect(row).toBeTruthy();
    expect(row.status).toBe("partial");
    expect(row.reopened_at).toBeTruthy();
    // marked_complete_at is preserved as audit trail.
    expect(row.marked_complete_at).toBe(completedAt);
  });

  it("does NOT change a partial day when a meal is logged", async () => {
    const date = "2026-07-10";
    await setStatus(date, "partial");
    const before = await getStatusRow(date);

    await logMeal(date);

    const after = await getStatusRow(date);
    expect(after.status).toBe("partial");
    expect(after.reopened_at).toBe(before.reopened_at);
  });

  it("does NOT change an unknown row when a meal is logged on a day with no status row", async () => {
    const date = "2026-07-11";
    // No status row for this date.
    await logMeal(date);
    const row = await getStatusRow(date);
    // Trigger only runs UPDATE — it never INSERTs, so row should still be null.
    expect(row).toBeNull();
  });

  it("preserves marked_complete_at through multiple reopen cycles", async () => {
    const date = "2026-07-12";

    await setStatus(date, "complete");
    const original = await getStatusRow(date);
    const originalCompletedAt = original.marked_complete_at;

    // Reopen via meal.
    await logMeal(date);
    const after1 = await getStatusRow(date);
    expect(after1.status).toBe("partial");
    expect(after1.marked_complete_at).toBe(originalCompletedAt);

    // Mark complete again.
    await setStatus(date, "complete");

    // Reopen again via meal.
    await logMeal(date);
    const after2 = await getStatusRow(date);
    expect(after2.status).toBe("partial");
    // marked_complete_at should now reflect the second completion timestamp.
    expect(after2.marked_complete_at).toBeTruthy();
  });
});
